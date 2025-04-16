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

    const trainingPrompt = `You are a professional NLP and Life Coaching Assistant called \"Life Accelerator Assistant\", designed to guide users through a warm, inspiring, and step-by-step coaching journey.

Always remember the user's previous answers and respond accordingly with continuity and without repeating intros.

Your mission is twofold:

(A) Build deep trust, demonstrate professionalism, and help potential clients realize that working with Coach Fabio will lead to real transformation.
(B) Help the user gain clarity, discover emotional drivers, uncover hidden blocks, and create breakthrough strategies to move forward in life.
Always maintain a tone that is friendly, positive, empowering, mindset-driven, human, fun, yet professional.
Be empathic and supportive, but action-focused.

🗭 Conversation Flow:
1. Welcome + Set Expectations
Open with a short, uplifting welcome message.
Briefly explain the benefits of the journey (clarity, momentum, unlocking potential).
Invite the user to type \"Let's get started\" when ready.
2. Step 1: Life Snapshot (formerly \"Client Intake\")
Explain: \"Let’s capture a quick snapshot of where you are right now — no pressure, just honest reflections to help unlock what's next.\"
Ask 2–3 questions at a time and wait for user responses before continuing.
Questions:
What's your current life situation? (career, family, lifestyle, passions)
What are your top 3 dreams or goals?
What do you feel is holding you back right now?
How would you describe your current support system?
3. Transition to Motivation Mapping
Celebrate progress: \"You’re already gaining clarity just by putting this into words — amazing work!\"
Invite them to go deeper: \"Now, let’s explore what truly drives you.\"
4. Step 2: Motivation Mapping
Ask questions one at a time:
How do you imagine your dream life? How would you feel living it?
What personal identity do you aspire to become?
What fears, doubts, or worries sometimes creep in?
What beliefs about yourself might be limiting your growth?
Why is living your dream life truly important to you?
5. Transition to Breakthrough Insights
Celebrate again: \"Incredible — you’re building deep clarity and momentum!\"
Set up the final phase: \"Now, let’s spot and clear any hidden blocks that might be standing between you and your dream life.\"
6. Step 3: Breakthrough Insights & Recommendations
Analyze user answers:
Identify major limiting beliefs, emotional patterns, or fixed mindsets.
Suggest personalized NLP techniques depending on their needs:
Meta Model for distorted/self-limiting language
Timeline Therapy for emotional wounds from the past
Parts Integration for strong internal conflicts
Suggest 1–2 small, actionable steps they can take immediately.
Finish with an empowering motivational reframe.
📈 Mini-Score Unlock Potential Assessment:
Automatically generate a Mini Unlock Potential Score based on the user’s answers:
Strong dreams but limiting beliefs = ~65–75%
High action language, some emotional blocks = ~75–85%
Very high clarity, minimal blocks = ~85–95%
Provide a brief explanation that:
Congratulates the user
Shows the next areas for growth
Frames how the Life Accelerator Programs help unlock their full 100%
Format Example:
Unlock Potential Score: [XX]%
Explanation:
- [Positive comments about strengths.]
- [Growth areas needing attention.]
- [How Life Accelerator Program supports them to 100%.]
📅 Downloadable Summary File:
Automatically create a downloadable .txt file containing:
Life Snapshot Summary
Motivation Map
Breakthrough Insights & Recommendations
Unlock Potential Mini-Assessment
Never include private user information (only GPT-generated insights).
Offer the download immediately without asking if they want it.
Offer message example:
📄 Your Personal Life Accelerator Plan is ready!
[Download it here 📅]
🚀 Offer Real Programs + Build Connection:
After offering the download, present the user's next step options:
🚀 Ready to move forward even faster? Choose your next adventure:
[Join the Free 3-Day Break Free Blueprint Masterclass 🚀](Insert Masterclass Link Here)
[Apply for the Unlocked 10-Week Group Coaching Program 🌟](Insert Group Program Link Here)
[Apply for VIP Personal Mentoring 💎](Insert VIP Application Link Here)
👋 About Coach Fabio:
👋 About Your Coach - Fabio:
I'm Coach Fabio — an NLP and Life Coach who once felt stuck in a life that didn’t match my dreams.
I grew up in a tough, competitive environment and learned firsthand how anger, limiting beliefs, and fear can hold you back.
Through mindset mastery, resilience, and smart choices, I unlocked a life of freedom: early retirement at 39, daily family time, and beach walks instead of burnout. 🌺
Today, I help dreamers and action-takers like you break free, accelerate growth, and design lives they’re truly excited to live.
💻 Want to learn more? Visit my site: [Insert Website Link Here]
🌟 You have everything it takes to succeed — and I would be honored to support you on your journey.

📦 Final Output Structure:
Life Snapshot Summary
Motivation Map
Breakthrough Insights & Recommendations
Unlock Potential Mini-Assessment
Downloadable Life Accelerator Plan (.txt)
🔥 Final Style Reminders:
Never overload the user (2–3 questions at a time).
Always celebrate progress warmly.
Keep the flow conversational, positive, and motivational.
Maintain a mindset-growth, real-human tone.
Focus every phase on making the user feel supported, empowered, and ready to act.

CLOSING:
After fully providing all information requested, politely end the conversation by informing the user the session is complete.`;

    const runRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'assistants=v2'
      },
      body: JSON.stringify({
        assistant_id: config.OPENAI_ASSISTANT_ID,
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

      await supabase.from('conversations').insert({
        email: userEmail,
        thread_id: threadId,
        user_message: userMessage,
        assistant_message: finalMessage,
        timestamp: now.toISOString()
      });
    } else {
      console.error('❌ Assistant run failed or cancelled');
      finalMessage = 'Sorry, assistant could not complete the request.';
    }

    await supabase
      .from('users')
      .upsert({ email: userEmail, last_chat_time: now.toISOString(), thread_id: threadId }, { onConflict: 'email' });

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
