import { createError, readBody, defineEventHandler, useRuntimeConfig } from 'h3'
import { createClient } from '@supabase/supabase-js'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()

  const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY)
  const { email: userEmail, message: userMessage } = await readBody(event)
  const now = new Date()

  if (!userEmail || !userMessage) {
    throw createError({ statusCode: 400, statusMessage: 'Missing email or message' })
  }

  // Check last session time
  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('email', userEmail)
    .single()

  if (user) {
    const lastChat = new Date(user.last_chat_time)
    const hoursSince = (now.getTime() - lastChat.getTime()) / (1000 * 60 * 60)
    if (hoursSince < 24) {
      return { message: 'Session completed. Please come back in 24h.' }
    }
  }

  // 1. Create thread
  const threadRes = await fetch('https://api.openai.com/v1/threads', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.OPENAI_API_KEY}`,
      'OpenAI-Beta': 'assistants=v2',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({})
  })

  const thread = await threadRes.json()
  if (!thread.id) throw createError({ statusCode: 500, statusMessage: 'Failed to create thread' })

  // 2. Add message to thread
  await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.OPENAI_API_KEY}`,
      'OpenAI-Beta': 'assistants=v2',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      role: 'user',
      content: userMessage
    })
  })

  // 3. Run assistant
  const runRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.OPENAI_API_KEY}`,
      'OpenAI-Beta': 'assistants=v2',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      assistant_id: config.OPENAI_ASSISTANT_ID
    })
  })

  const run = await runRes.json()
  if (!run.id) throw createError({ statusCode: 500, statusMessage: 'Failed to start run' })

  // 4. Poll for run completion
  let status = run.status
  let completedRun = run

  while (['queued', 'in_progress', 'cancelling'].includes(status)) {
    await new Promise((resolve) => setTimeout(resolve, 1500))

    const pollRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs/${run.id}`, {
      headers: {
        Authorization: `Bearer ${config.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'assistants=v2'
      }
    })

    completedRun = await pollRes.json()
    status = completedRun.status
  }

  if (status !== 'completed') {
    throw createError({ statusCode: 500, statusMessage: 'Run failed or incomplete.' })
  }

  // 5. Get assistant message
  const msgRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
    headers: {
      Authorization: `Bearer ${config.OPENAI_API_KEY}`,
      'OpenAI-Beta': 'assistants=v2'
    }
  })

  const allMessages = await msgRes.json()
  const assistantReply = allMessages.data
    .reverse()
    .find((m) => m.role === 'assistant')?.content?.[0]?.text?.value || 'No response from Assistant.'

  // 6. Save user timestamp
  if (user) {
    await supabase
      .from('users')
      .update({ last_chat_time: now.toISOString() })
      .eq('email', userEmail)
  } else {
    await supabase
      .from('users')
      .insert({ email: userEmail, last_chat_time: now.toISOString() })
  }

  return { message: assistantReply }
})
