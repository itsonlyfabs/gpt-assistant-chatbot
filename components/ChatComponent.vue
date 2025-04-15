const sendPrompt = async () => {
  if (message.value === '') return
  loading.value = true

  messages.value.push({
    role: 'User',
    message: message.value
  })

  scrollToEnd()
  const userMessageCopy = message.value
  message.value = ''

  const res = await fetch(`/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: userEmail.value,
      message: userMessageCopy
    })
  });

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
