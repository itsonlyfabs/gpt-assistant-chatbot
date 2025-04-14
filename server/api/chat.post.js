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

  // Step 2: Continue chat with Assistant as before (your Assistant API logic here)

  // (copy your current Assistant API call here!)

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
    message: assistantMessage // from your Assistant API call
  };
})
