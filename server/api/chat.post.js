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
          const errorData = await threadRes.json().catch(() => null) || await threadRes.text().catch(() => 'Unknown error');
          const errorMessage = typeof errorData === 'object' ? JSON.stringify(errorData) : errorData;
          console.error("❌ Thread creation failed:", errorMessage);
          throw createError({ 
            statusCode: threadRes.status, 
            statusMessage: `OpenAI thread creation failed: ${errorMessage}` 
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
    let userMsgRes;
    try {
      userMsgRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.OPENAI_API_KEY}`,
          'OpenAI-Beta': 'assistants=v2'
        },
        body: JSON.stringify({ role: 'user', content: userMessage })
      });

      if (!userMsgRes.ok) {
        const errorData = await userMsgRes.json().catch(() => null) || await userMsgRes.text().catch(() => 'Unknown error');
        const errorMessage = typeof errorData === 'object' ? JSON.stringify(errorData) : errorData;
        console.error("❌ Failed to add user message:", errorMessage);
        throw createError({ 
          statusCode: userMsgRes.status, 
          statusMessage: `Failed to add message to thread: ${errorMessage}` 
        });
      }
    } catch (err) {
      console.error("❌ Message addition error:", err);
      throw createError({ 
        statusCode: 500, 
        statusMessage: `Error adding message: ${err.message}` 
      });
    }

    // Run the assistant
    console.log(`Starting assistant run with ID: ${config.OPENAI_ASSISTANT_ID}`);
    let runRes;
    let run;
    try {
      runRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
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
        const errorData = await runRes.json().catch(() => null) || await runRes.text().catch(() => 'Unknown error');
        const errorMessage = typeof errorData === 'object' ? JSON.stringify(errorData) : errorData;
        console.error("❌ Failed to start run:", errorMessage);
        throw createError({ 
          statusCode: runRes.status, 
          statusMessage: `Failed to start assistant run: ${errorMessage}` 
        });
      }

      run = await runRes.json();
    } catch (err) {
      console.error("❌ Run creation error:", err);
      throw createError({ 
        statusCode: 500, 
        statusMessage: `Error creating run: ${err.message}` 
      });
    }

    let status = run.status;
    console.log(`Run started with status: ${status}`);

    // Poll for completion
    let attempts = 0;
    const maxAttempts = 30; // Prevent infinite loops
    
    while (['queued', 'in_progress'].includes(status) && attempts < maxAttempts) {
      console.log(`Run status: ${status}, waiting... (attempt ${attempts + 1}/${maxAttempts})`);
      await new Promise((r) => setTimeout(r, 1500));
      attempts++;
      
      let checkRes;
      try {
        checkRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${run.id}`, {
          headers: {
            'Authorization': `Bearer ${config.OPENAI_API_KEY}`,
            'OpenAI-Beta': 'assistants=v2'
          }
        });
        
        if (!checkRes.ok) {
          const errorData = await checkRes.json().catch(() => null) || await checkRes.text().catch(() => 'Unknown error');
          const errorMessage = typeof errorData === 'object' ? JSON.stringify(errorData) : errorData;
          console.error(`❌ Failed to check run status: ${errorMessage}`);
          continue;
        }
        
        const runStatus = await checkRes.json();
        status = runStatus.status;
      } catch (err) {
        console.error(`❌ Error checking run status: ${err.message}`);
        continue;
      }
    }

    console.log(`Final run status: ${status}`);
    let finalMessage = 'Sorry, assistant could not complete the request.';

    if (status === 'completed') {
      console.log(`Getting messages from thread ${threadId}`);
      let msgRes;
      try {
        msgRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
          headers: {
            'Authorization': `Bearer ${config.OPENAI_API_KEY}`,
            'OpenAI-Beta': 'assistants=v2'
          }
        });
        
        if (!msgRes.ok) {
          const errorData = await msgRes.json().catch(() => null) || await msgRes.text().catch(() => 'Unknown error');
          const errorMessage = typeof errorData === 'object' ? JSON.stringify(errorData) : errorData;
          console.error(`❌ Failed to get messages: ${errorMessage}`);
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
      } catch (err) {
        console.error(`❌ Error getting messages: ${err.message}`);
      }
    } else if (status === 'failed') {
      console.error(`❌ Run failed. Reason: ${run.last_error?.message || 'Unknown error'}`);
      finalMessage = "I'm sorry, I encountered an issue processing your request. Please try again later.";
    } else if (attempts >= maxAttempts) {
      console.error(`❌ Run timed out after ${maxAttempts} polling attempts.`);
      finalMessage = "I'm sorry, the request is taking longer than expected. Please try again later.";
    }

    // Update or create user record
    console.log(`Upserting user record for ${userEmail}`);
    try {
      const { error: upsertError } = await supabase
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
    } catch (err) {
      console.error("❌ Error upserting user:", err.message);
      // Don't throw error here, continue with the flow
    }

    // Store conversation
    console.log("Storing conversation in database");
    try {
      const { error: convError } = await supabase.from('conversations').insert({
        email: userEmail,
        thread_id: threadId,
        user_message: userMessage,
        assistant_message: finalMessage,
        timestamp: now.toISOString()
      });

      if (convError) {
        console.error("❌ Failed to insert conversation:", convError);
      }
    } catch (err) {
      console.error("❌ Error storing conversation:", err.message);
      // Don't throw error here, continue with the flow
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