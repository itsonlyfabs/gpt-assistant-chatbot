import { createClient } from '@supabase/supabase-js'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();
  const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);
  const body = await readBody(event);
  const userEmail = body.email;
  const userMessage = body.message;
  const now = new Date();

  try {
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

    // 2. Create a thread
    const threadRes = await fetch('https://api.openai.com/v1/threads', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'assistants=v1'
      }
    });
    const thread = await threadRes.json();
    if (!thread.id) throw new Error('Failed to create thread');

    // 3. Add user message to thread
    await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'assistants=v1'
      },
      body: JSON.stringify({ role: 'user', content: userMessage })
    });

    // 4. Run the assistant
    const runRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'assistants=v1'
      },
      body: JSON.stringify({ assistant_id: config.OPENAI_ASSISTANT_ID })
    });
    const run = await runRes.json();
    if (!run.id) throw new Error('Failed to start assistant run');

    // 5. Poll for run completion
    let status = run.status;
    while (status === 'queued' || status === 'in_progress') {
      await new Promise((r) => setTimeout(r, 1500));
      const checkRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs/${run.id}`, {
        headers: {
          Authorization: `Bearer ${config.OPENAI_API_KEY}`,
          'OpenAI-Beta': 'assistants=v1'
        }
      });
      const checkData = await checkRes.json();
      status = checkData.status;
    }

    if (status !== 'completed') throw new Error('Assistant run failed');

    // 6. Get last assistant message
    const msgRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
      headers: {
        Authorization: `Bearer ${config.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'assistants=v1'
      }
    });
    const messages = await msgRes.json();
    const assistantReply = messages.data.find((m) => m.role === 'assistant');
    const finalMessage = assistantReply?.content?.[0]?.text?.value || 'No response.';

    // 7. Save chat time
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
    console.error('[chat.post.js error]', err);
    return { message: '⚠️ Sorry, something went wrong while talking to the assistant.' };
  }
});
