export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();

  console.log('🔥 Chat API endpoint hit');
  console.log('📦 Runtime config:', {
    SUPABASE_URL: config.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: config.SUPABASE_SERVICE_KEY ? '[OK]' : '[MISSING]',
    OPENAI_API_KEY: config.OPENAI_API_KEY ? '[OK]' : '[MISSING]'
  });

  if (!config.OPENAI_API_KEY || !config.SUPABASE_URL || !config.SUPABASE_SERVICE_KEY) {
    throw createError({
      statusCode: 500,
      statusMessage: '❌ Missing required environment variables in config.'
    });
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);

    const body = await readBody(event);
    console.log('📬 Incoming body:', body);

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

    let threadId = user?.thread_id;
    let resetThread = false;

    if (user?.last_chat_time) {
      const lastChat = new Date(user.last_chat_time);
      const diffHours = (now.getTime() - lastChat.getTime()) / (1000 * 60 * 60);
      if (diffHours >= 24) {
        resetThread = true;
      }
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

      const thread = await threadRes.json();
      console.log('🧵 Thread created:', thread.id);

      if (!thread.id) throw new Error('Failed to create OpenAI thread');

      threadId = thread.id;
    }

    const messageAddRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'assistants=v2'
      },
      body: JSON.stringify({ role: 'user', content: userMessage })
    });

    await messageAddRes.json();
    console.log('✉️ Message added to thread');

    const trainingPrompt = `You are a professional NLP and Life Coaching Assistant called "Life Accelerator Assistant", designed to guide users through a warm, inspiring, and step-by-step coaching journey.

Always remember the user's previous answers and respond accordingly with continuity and without repeating intros.

Your mission is twofold:

(A) Build deep trust, demonstrate professionalism, and help potential clients realize that working with Coach Fabio will lead to real transformation.
(B) Help the user gain clarity, discover emotional drivers, uncover hidden blocks, and create breakthrough strategies to move forward in life.
Always maintain a tone that is friendly, positive, empowering, mindset-driven, human, fun, yet professional.
Be empathic and supportive, but action-focused.

🧭 Conversation Flow:
...
(continue full prompt as before) ...
`;

    const runRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'assistants=v2'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        instructions: trainingPrompt
      })
    });

    const run = await runRes.json();
    console.log('🏃 Assistant run started:', run.id);

    let status = run.status;
    let finalMessage = null;

    while (['queued', 'in_progress'].includes(status)) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const statusRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${run.id}`, {
        headers: {
          Authorization: `Bearer ${config.OPENAI_API_KEY}`,
          'OpenAI-Beta': 'assistants=v2'
        }
      });
      const runData = await statusRes.json();
      status = runData.status;
      console.log('📡 Run status:', status);
    }

    if (status === 'completed') {
      const msgRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
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

    // ✅ First upsert user BEFORE inserting conversation
    await supabase
      .from('users')
      .upsert({ email: userEmail, last_chat_time: now.toISOString(), thread_id: threadId }, { onConflict: 'email' });

    // ✅ Then insert conversation safely
    await supabase.from('conversations').insert({
      email: userEmail,
      thread_id: threadId,
      user_message: userMessage,
      assistant_message: finalMessage,
      timestamp: now.toISOString()
    });

    const { data: history } = await supabase
      .from('conversations')
      .select('*')
      .eq('email', userEmail)
      .order('timestamp', { ascending: true });

    return { message: finalMessage, history };

  } catch (err) {
    console.error('❌ Uncaught Chat API Error:', err);
    throw createError({ statusCode: 500, statusMessage: 'Server Error: ' + err.message });
  }
});
