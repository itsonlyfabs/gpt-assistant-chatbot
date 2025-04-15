export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);

  try {
    const body = await readBody(event);
    const { email: userEmail, message: userMessage } = body;
    const now = new Date();

    if (!userEmail || !userMessage) {
      throw createError({ statusCode: 400, statusMessage: 'Missing email or message in request body' });
    }

    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('email', userEmail)
      .single();

    if (user) {
      const lastChat = new Date(user.last_chat_time);
      const diffHours = (now.getTime() - lastChat.getTime()) / (1000 * 60 * 60);
      if (diffHours < 24) {
        return { message: 'Session completed. Please come back in 24h.' };
      }
    }

    // 2. Create thread
    const threadRes = await fetch('https://api.openai.com/v1/threads', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'assistants=v1'
      }
    });

    const thread = await threadRes.json();
    if (!thread.id) throw new Error('Failed to create OpenAI thread');

    // 3. Add message
    await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'assistants=v1'
      },
      body: JSON.stringify({
        role: 'user',
        content: userMessage
      })
    });

    // 4. Run assistant
    const runRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'assistants=v1'
      },
      body: JSON.stringify({
        assistant_id: config.OPENAI_ASSISTANT_ID
      })
    });

    const run = await runRes.json();

    let status = run.status;
    let finalMessage = null;

    while (['queued', 'in_progress'].includes(status)) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const statusRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs/${run.id}`, {
        headers: {
          Authorization: `Bearer ${config.OPENAI_API_KEY}`,
          'OpenAI-Beta': 'assistants=v1'
        }
      });
      const runData = await statusRes.json();
      status = runData.status;
    }

    if (status === 'completed') {
      const msgRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
        headers: {
          Authorization: `Bearer ${config.OPENAI_API_KEY}`,
          'OpenAI-Beta': 'assistants=v1'
        }
      });

      const messages = await msgRes.json();
      finalMessage = messages.data.find((m) => m.role === 'assistant')?.content[0]?.text?.value || 'No response.';
    }

    // Update DB
    if (user) {
      await supabase
        .from('users')
        .update({ last_chat_time: now.toISOString() })
        .eq('email', userEmail);
    } else {
      await supabase
        .from('users')
        .insert({ email: userEmail, last_chat_time: now.toISOString() });
    }

    return { message: finalMessage };

  } catch (err) {
    console.error('❌ Chat API Error:', err);
    throw createError({ statusCode: 500, statusMessage: 'Server Error: ' + err.message });
  }
});
