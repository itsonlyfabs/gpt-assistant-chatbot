
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();

  if (!config.OPENAI_API_KEY || !config.SUPABASE_URL || !config.SUPABASE_SERVICE_KEY || !config.OPENAI_ASSISTANT_ID) {
    throw createError({
      statusCode: 500,
      statusMessage: '❌ Missing required environment variables.'
    });
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);
    const body = await readBody(event);
    const { email: userEmail, message: userMessage } = body;
    const now = new Date();

    if (!userEmail || !userMessage) {
      throw createError({ statusCode: 400, statusMessage: 'Missing email or message.' });
    }

    let threadId = null;
    let resetThread = false;

    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('email', userEmail)
      .single();

    if (user) {
      threadId = user.thread_id;
      const lastChat = new Date(user.last_chat_time);
      const hoursPassed = (now.getTime() - lastChat.getTime()) / (1000 * 60 * 60);
      if (hoursPassed >= 24) resetThread = true;
    }

    if (!threadId || resetThread) {
      const threadRes = await fetch('https://api.openai.com/v1/threads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.OPENAI_API_KEY}`,
          'OpenAI-Beta': 'assistants=v2'
        }
      });
      const threadData = await threadRes.json();
      if (!threadData.id) throw new Error('Failed to create thread');
      threadId = threadData.id;
    }

    // Inject history for context
    const { data: history } = await supabase
      .from('conversations')
      .select('*')
      .eq('email', userEmail)
      .order('timestamp', { ascending: true });

    for (const entry of history) {
      if (entry.user_message) {
        await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.OPENAI_API_KEY}`,
            'OpenAI-Beta': 'assistants=v2'
          },
          body: JSON.stringify({ role: 'user', content: entry.user_message })
        });
      }
      if (entry.assistant_message) {
        await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.OPENAI_API_KEY}`,
            'OpenAI-Beta': 'assistants=v2'
          },
          body: JSON.stringify({ role: 'assistant', content: entry.assistant_message })
        });
      }
    }

    // Add the latest user message
    await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'assistants=v2'
      },
      body: JSON.stringify({ role: 'user', content: userMessage })
    });

    // Trigger run using the assistant ID
    const runRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'assistants=v2'
      },
      body: JSON.stringify({
        assistant_id: config.OPENAI_ASSISTANT_ID
      })
    });

    const run = await runRes.json();
    if (!runRes.ok) {
      console.error("❌ OpenAI Run Error:", run);
      throw createError({ statusCode: runRes.status, statusMessage: run?.error?.message || 'Run creation failed' });
    }

    let status = run.status;

    while (['queued', 'in_progress'].includes(status)) {
      await new Promise((r) => setTimeout(r, 1500));
      const checkRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${run.id}`, {
        headers: {
          Authorization: `Bearer ${config.OPENAI_API_KEY}`,
          'OpenAI-Beta': 'assistants=v2'
        }
      });
      const runStatus = await checkRes.json();
      status = runStatus.status;
    }

    let finalMessage = 'Sorry, assistant could not complete the request.';

    if (status === 'completed') {
      const msgRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
        headers: {
          Authorization: `Bearer ${config.OPENAI_API_KEY}`,
          'OpenAI-Beta': 'assistants=v2'
        }
      });
      const messages = await msgRes.json();
      const assistantResponse = messages.data.find((m) => m.role === 'assistant');
      finalMessage = assistantResponse?.content?.[0]?.text?.value || finalMessage;
    }

    await supabase
      .from('users')
      .upsert({ email: userEmail, last_chat_time: now.toISOString(), thread_id: threadId }, { onConflict: 'email' });

    await supabase.from('conversations').insert({
      email: userEmail,
      thread_id: threadId,
      user_message: userMessage,
      assistant_message: finalMessage,
      timestamp: now.toISOString()
    });

    const { data: updatedHistory } = await supabase
      .from('conversations')
      .select('*')
      .eq('email', userEmail)
      .order('timestamp', { ascending: true });

    return { message: finalMessage, history: updatedHistory };
  } catch (err) {
    console.error('❌ Chat error:', err);
    throw createError({ statusCode: 500, statusMessage: err.message || 'Internal error' });
  }
});
