export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();

  console.log('🔥 Chat API endpoint hit');
  console.log('📦 Runtime config:', {
    SUPABASE_URL: config.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: config.SUPABASE_SERVICE_KEY ? '[OK]' : '[MISSING]',
    OPENAI_API_KEY: config.OPENAI_API_KEY ? '[OK]' : '[MISSING]',
    OPENAI_ASSISTANT_ID: config.OPENAI_ASSISTANT_ID ? '[OK]' : '[MISSING]'
  });

  if (!config.OPENAI_API_KEY || !config.OPENAI_ASSISTANT_ID || !config.SUPABASE_URL || !config.SUPABASE_SERVICE_KEY) {
    throw createError({
      statusCode: 500,
      statusMessage: '❌ Missing required environment variables in config.'
    });
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);

    const body = await readBody(event);
    console.log('📩 Incoming body:', body);

    const { email: userEmail, message: userMessage } = body;
    const now = new Date();

    if (!userEmail || !userMessage) {
      throw createError({ statusCode: 400, statusMessage: 'Missing email or message in request body' });
    }

    const { data: user, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('email', userEmail)
      .single();

    if (fetchError) console.warn('⚠️ Supabase fetch user error:', fetchError);

    if (user) {
      const lastChat = new Date(user.last_chat_time);
      const diffHours = (now.getTime() - lastChat.getTime()) / (1000 * 60 * 60);
      if (diffHours < 24) {
        return { message: 'Session completed. Please come back in 24h.' };
      }
    }

    // 1. Create thread
    const threadRes = await fetch('https://api.openai.com/v1/threads', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'assistants=v2'
      }
    });

    const thread = await threadRes.json();
    console.log('🧵 Thread created:', thread.id);

    if (!thread.id) throw new Error('Failed to create OpenAI thread');

    // 2. Add message
    const messageAddRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'assistants=v2'
      },
      body: JSON.stringify({
        role: 'user',
        content: userMessage
      })
    });

    const messageAdd = await messageAddRes.json();
    console.log('✉️ Message added to thread');

    // 3. Run assistant
    const runRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs`, {
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
    console.log('🏃 Assistant run started:', run.id);

    let status = run.status;
    let finalMessage = null;

    while (['queued', 'in_progress'].includes(status)) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const statusRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs/${run.id}`, {
        headers: {
          Authorization: `Bearer ${config.OPENAI_API_KEY}`,
          'OpenAI-Beta': 'assistants=v2'
        }
      });
      const runData = await statusRes.json();
      status = runData.status;
      console.log('📡 Run status:', status);
    }

    // 4. Get final response
    if (status === 'completed') {
      const msgRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
        headers: {
          Authorization: `Bearer ${config.OPENAI_API_KEY}`,
          'OpenAI-Beta': 'assistants=v2'
        }
      });

      const messages = await msgRes.json();
      const assistantMsg = messages.data.find((m) => m.role === 'assistant');
      finalMessage = assistantMsg?.content?.[0]?.text?.value || 'No response.';
      console.log('✅ Assistant message received');
    } else {
      console.error('❌ Assistant run failed or cancelled');
      finalMessage = 'Sorry, assistant could not complete the request.';
    }

    // 5. Update last chat time
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
    console.error('❌ Uncaught Chat API Error:', err);
    throw createError({ statusCode: 500, statusMessage: 'Server Error: ' + err.message });
  }
});
