export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();

  // Validate environment variables
  if (!config.OPENAI_API_KEY || !config.SUPABASE_URL || !config.SUPABASE_SERVICE_KEY || !config.OPENAI_ASSISTANT_ID) {
    console.error('❌ Missing required environment variables:', {
      hasOpenAIKey: !!config.OPENAI_API_KEY,
      hasSupabaseURL: !!config.SUPABASE_URL,
      hasSupabaseServiceKey: !!config.SUPABASE_SERVICE_KEY,
      hasAssistantID: !!config.OPENAI_ASSISTANT_ID
    });
    throw createError({
      statusCode: 500,
      statusMessage: 'Missing required environment variables. Please check server configuration.'
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

    console.log(`Processing request for email: ${userEmail}`);
    
    // Get user or create if doesn't exist
    let threadId = null;
    let resetThread = false;

    const { data: users, error: userFetchError } = await supabase
      .from('users')
      .select('*')
      .eq('email', userEmail);

    if (userFetchError) {
      console.error("❌ Supabase user fetch error:", userFetchError.message);
      throw createError({ 
        statusCode: 500, 
        statusMessage: `Database error: ${userFetchError.message}` 
      });
    }

    let user = null;
    if (users && users.length > 0) {
      user = users[0];
      console.log(`Found existing user with thread_id: ${user.thread_id}`);
    } else {
      console.log("ℹ️ No existing user found — will create new user");
    }

    if (user) {
      threadId = user.thread_id;
      // Check if thread should be reset (conversation older than 24 hours)
      if (user.last_chat_time) {
        const lastChat = new Date(user.last_chat_time);
        const hoursPassed = (now.getTime() - lastChat.getTime()) / (1000 * 60 * 60);
        if (hoursPassed >= 24) {
          console.log(`Last chat was ${hoursPassed.toFixed(2)} hours ago. Resetting thread.`);
          resetThread = true;
        }
      }
    }

    // Create a new thread if needed
    if (!threadId || resetThread) {
      console.log("Creating new OpenAI thread");
      try {
        const threadRes = await fetch('https://api.openai.com/v1/threads', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.OPENAI_API_KEY}`,
            'OpenAI-Beta': 'assistants=v2'
          }
        });
        
        if (!threadRes.ok) {
          const errorText = await threadRes.text();
          console.error("❌ Thread creation failed:", errorText);
          throw createError({ 
            statusCode: threadRes.status, 
            statusMessage: `OpenAI thread creation failed: ${errorText}` 
          });
        }
        
        const threadData = await threadRes.json();
        threadId = threadData.id;
        console.log(`Created new thread with ID: ${threadId}`);
      } catch (err) {
        console.error("❌ Thread creation error:", err);
        throw createError({ 
          statusCode: 500, 
          statusMessage: `Failed to create OpenAI thread: ${err.message}` 
        });
      }
    }

    // Add user message to thread
    console.log(`Adding user message to thread ${threadId}`);
    const userMsgRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'assistants=v2'
      },
      body: JSON.stringify({ role: 'user', content: userMessage })
    });

    if (!userMsgRes.ok) {
      const err = await userMsgRes.text();
      console.error("❌ Failed to add user message:", err);
      throw createError({ 
        statusCode: userMsgRes.status, 
        statusMessage: `Failed to add message to thread: ${err}` 
      });
    }

    // Run the assistant
    console.log(`Starting assistant run with ID: ${config.OPENAI_ASSISTANT_ID}`);
    const runRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'assistants=v2'
      },
      body: JSON.stringify({
        assistant_id: config.OPENAI_ASSISTANT_ID
      })
    });

    if (!runRes.ok) {
      const runErr = await runRes.text();
      console.error("❌ Failed to start run:", runErr);
      throw createError({ 
        statusCode: runRes.status, 
        statusMessage: `Failed to start assistant run: ${runErr}` 
      });
    }

    const run = await runRes.json();
    let status = run.status;
    console.log(`Run started with status: ${status}`);

    // Poll for completion
    let attempts = 0;
    const maxAttempts = 30; // Prevent infinite loops
    
    while (['queued', 'in_progress'].includes(status) && attempts < maxAttempts) {
      console.log(`Run status: ${status}, waiting...`);
      await new Promise((r) => setTimeout(r, 1500));
      attempts++;
      
      const checkRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${run.id}`, {
        headers: {
          'Authorization': `Bearer ${config.OPENAI_API_KEY}`,
          'OpenAI-Beta': 'assistants=v2'
        }
      });
      
      if (!checkRes.ok) {
        const checkErr = await checkRes.text();
        console.error(`❌ Failed to check run status: ${checkErr}`);
        continue;
      }
      
      const runStatus = await checkRes.json();
      status = runStatus.status;
    }

    console.log(`Final run status: ${status}`);
    let finalMessage = 'Sorry, assistant could not complete the request.';

    if (status === 'completed') {
      console.log(`Getting messages from thread ${threadId}`);
      const msgRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
        headers: {
          'Authorization': `Bearer ${config.OPENAI_API_KEY}`,
          'OpenAI-Beta': 'assistants=v2'
        }
      });
      
      if (!msgRes.ok) {
        const msgErr = await msgRes.text();
        console.error(`❌ Failed to get messages: ${msgErr}`);
      } else {
        const messages = await msgRes.json();
        // Find most recent assistant message
        const assistantResponse = messages.data.find((m) => m.role === 'assistant');
        
        if (assistantResponse?.content?.[0]?.text?.value) {
          finalMessage = assistantResponse.content[0].text.value;
          console.log(`Got assistant response: ${finalMessage.substring(0, 50)}...`);
        } else {
          console.error("❌ No assistant response content found in:", assistantResponse);
        }
      }
    } else {
      console.error(`❌ Run did not complete successfully. Final status: ${status}`);
    }

    // Update or create user record
    console.log(`Upserting user record for ${userEmail}`);
    const { data: upsertData, error: upsertError } = await supabase
      .from('users')
      .upsert({ 
        email: userEmail, 
        last_chat_time: now.toISOString(), 
        thread_id: threadId 
      }, { 
        onConflict: 'email',
        returning: 'minimal'
      });

    if (upsertError) {
      console.error("❌ Failed to upsert user:", upsertError);
    }

    // Store conversation
    console.log("Storing conversation in database");
    const { data: convData, error: convError } = await supabase.from('conversations').insert({
      email: userEmail,
      thread_id: threadId,
      user_message: userMessage,
      assistant_message: finalMessage,
      timestamp: now.toISOString()
    });

    if (convError) {
      console.error("❌ Failed to insert conversation:", convError);
    }

    return { 
      message: finalMessage,
      success: true
    };
    
  } catch (err) {
    console.error('❌ Chat error (outer catch):', err);
    throw createError({ 
      statusCode: err.statusCode || 500, 
      statusMessage: err.message || 'Internal server error' 
    });
  }
});