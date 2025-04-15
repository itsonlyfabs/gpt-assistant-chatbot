export default defineEventHandler(async (event) => {
  try {
    const config = useRuntimeConfig();
    const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);
    const body = await readBody(event);

    console.log('🟢 Request Body:', body);

    const userEmail = body.email;
    const userMessage = body.message;
    const now = new Date();

    // Step 1: Get user from DB
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', userEmail)
      .single();

    console.log('👤 Supabase user:', user, 'Error:', error);

    if (user) {
      const lastChat = new Date(user.last_chat_time);
      const diffHours = (now.getTime() - lastChat.getTime()) / (1000 * 60 * 60);
      if (diffHours < 24) {
        return { message: 'Session completed. Please come back in 24h.' };
      }
    }

    // Step 2: Create a new thread
    const threadRes = await fetch('https://api.openai.com/v1/threads', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'assistants=v1'
      }
    });

    const thread = await threadRes.json();
    console.log('🧵 Thread created:', thread);

    if (!thread.id) throw new Error('Failed to create thread');

    // Step 3: Add message to thread
    const messageRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
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

    console.log('✉️ Message sent to thread');

    // Step 4: Start assistant run
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
    console.log('🏃 Run started:', run);

    if (!run.id) throw new Error('Failed to start assistant run');

    let status = run.status;
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

    console.log('✅ Final Run Status:', status);

    if (status === 'completed') {
      const msgRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
        headers: {
          Authorization: `Bearer ${config.OPENAI_API_KEY}`,
          'OpenAI-Beta': 'assistants=v1'
        }
      });
      const messages = await msgRes.json();
      const finalMessage = messages.data.find((m) => m.role === 'assistant')?.content?.[0]?.text?.value || 'No response.';

      // Save last_chat_time
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
    } else {
      throw new Error('Assistant run failed.');
    }
  } catch (err) {
    console.error('❌ Server Error:', err);
    return { message: 'Internal Server Error' };
  }
});
