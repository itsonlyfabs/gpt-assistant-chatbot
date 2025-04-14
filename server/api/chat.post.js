export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();
  const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY); // backend key
  const body = await readBody(event);
  const userEmail = body.email; // frontend must send logged-in user email
  const userMessage = body.message;

  // Step 1: Fetch user from DB
  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', userEmail)
    .single();

  const now = new Date();

  if (user) {
    const lastChat = new Date(user.last_chat_time);
    const diffHours = (now.getTime() - lastChat.getTime()) / (1000 * 60 * 60);

    if (diffHours < 24) {
      return { error: 'Session completed. Please come back in 24h.' }
    }
  }

  // Step 2: Chat with Assistant using OpenAI

  const res = await fetch('https://api.openai.com/v1/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'text-davinci-003',
      prompt: userMessage,
      temperature: 0.9,
      max_tokens: 512,
      top_p: 1.0,
      frequency_penalty: 0,
      presence_penalty: 0.6,
      stop: ['User:', 'AI:']
    })
  });

  const result = await res.json();
  const assistantMessage = result.choices[0].text.trim();

  // Step 3: Update last chat time
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

  return {
    message: assistantMessage
  };
});
