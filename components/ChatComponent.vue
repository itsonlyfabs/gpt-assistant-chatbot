const sendPrompt = async () => {
  if (message.value === '') return
  loading.value = true

  const userMessageCopy = message.value

  messages.value.push({
    role: 'User',
    message: userMessageCopy
  })

  scrollToEnd()
  message.value = ''

  const payload = {
    email: userEmail.value,
    message: userMessageCopy
  }

  console.log('📤 Sending to /api/chat:', payload)

  const res = await fetch(`/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })

  const response = await res.json()
  console.log('🔍 Chat API Response:', response)

  if (res.status === 200) {
    messages.value.push({
      role: 'AI',
      message: response?.message || 'No response.'
    })
  } else {
    messages.value.push({
      role: 'AI',
      message: 'Sorry, an error occurred.'
    })
  }

  loading.value = false
  scrollToEnd()
}
