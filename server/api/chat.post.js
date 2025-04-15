export default defineEventHandler(async (event) => {
  try {
    const config = useRuntimeConfig();
    const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);
    const body = await readBody(event);
    const userEmail = body.email;
    const userMessage = body.message;
    const now = new Date();

    console.log('📥 Incoming Chat Request:', { email: userEmail, message: userMessage });

    // 1. Check last chat time
    const { data: user, error } = await supabase
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

    // 2. Create new thread
    const threadRes = await fetch('https://api.openai.com/v1/threads', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'assistants=v1'
      }
    });
    const thread = await threadRes.json();
    console.log('🧵 Thread Created:', thread);

    // 3. Add message to thread
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
    console.log('🏃 Assistant Run Started:', run);

    // 5. Poll run status
    let status = run.status;
    let finalMessage = null;

    while (status === 'queued' || status === 'in_progress') {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const checkRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs/${run.id}`, {
        headers: {
          Authorization: `Bearer ${config.OPENAI_API_KEY}`,
          'OpenAI-Beta': 'assistants=v1'
        }
      });
      const statusData = await checkRes.json();
      status = statusData.status;
    }

    if (status === 'completed') {
      const msgRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
        headers: {
          Authorization: `Bearer ${config.OPENAI_API_KEY}`,
          'OpenAI-Beta': 'assistants=v1'
        }
      });
      const messages = await msgRes.json();
      console.log('💬 Assistant Messages:', messages);

      finalMessage = messages.data.find((m) => m.role === 'assistant')?.content[0]?.text?.value || 'No response.';
    } else {
      console.log('❌ Assistant Run Failed:', status);
    }

    // 6. Save chat time
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

    return { message: finalMessage || 'No assistant response.' };

  } catch (error) {
    console.error('🔥 Chat API Error:', error);
    return { message: 'Sorry, an internal server error occurred.' };
  }
});
