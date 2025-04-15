<template>
  <div class="max-w-xl mx-auto text-black">
    <h1 class="my-8 text-4xl font-bold text-center">AI Chatbot</h1>
    <div class="bg-white rounded-md shadow h-[70vh] flex flex-col justify-between">
      <div class="h-full overflow-auto chat-messages">
        <div v-for="(message, i) in messages" :key="i" class="flex flex-col p-4">
          <div v-if="message.role === 'AI'" class="pr-8 mr-auto">
            <div class="p-2 mt-1 text-sm text-gray-700 bg-gray-200 rounded-lg">
              {{ message.message }}
            </div>
          </div>
          <div v-else class="pl-8 ml-auto">
            <div class="p-2 mt-1 text-sm text-white bg-blue-400 rounded-lg">
              {{ message.message }}
            </div>
          </div>
        </div>
        <div v-if="loading" class="p-4 text-center">
          <span class="loader"></span>
        </div>
      </div>

      <form @submit.prevent="sendPrompt" class="flex items-center p-4">
        <input
          v-model="message"
          type="text"
          placeholder="Type your message..."
          class="w-full p-2 text-sm border rounded-md"
        />
        <button
          :disabled="loading"
          type="submit"
          class="flex items-center justify-center w-10 h-10 ml-2 bg-green-500 rounded-full"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
               xmlns="http://www.w3.org/2000/svg">
            <path d="M22 2L11 13" stroke="white" stroke-width="1.5" stroke-linecap="round"
                  stroke-linejoin="round"/>
            <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="white" stroke-width="1.5"
                  stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { supabase } from '@/utils/supabaseClient'

const messages = ref([
  { role: 'AI', message: 'Hello! How can I help you?' }
])

const loading = ref(false)
const message = ref('')
const userEmail = ref('')

onMounted(async () => {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) {
    if (process.client) {
      alert('User not logged in. Please log in again.')
      window.location.href = '/'
    } else {
      console.warn('User not logged in - skipped alert (SSR).')
    }
  } else {
    userEmail.value = user.email
  }
})


const scrollToEnd = () => {
  setTimeout(() => {
    const chatMessages = document.querySelector('.chat-messages > div:last-child')
    chatMessages?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, 100)
}

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

  try {
    const res = await fetch(`/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: userEmail.value,
        message: userMessageCopy
      })
    })

    const response = await res.json()
    console.log('🧠 OpenAI response:', response)

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

  } catch (e) {
    console.error('❌ Chat error:', e)
    messages.value.push({
      role: 'AI',
      message: 'Unexpected error occurred.'
    })
  }

  loading.value = false
  scrollToEnd()
}
</script>

<style scoped>
.loader {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  display: block;
  position: relative;
  color: #d3d3d3;
  box-sizing: border-box;
  animation: animloader 2s linear infinite;
}

@keyframes animloader {
  0% {
    box-shadow: 14px 0 0 -2px, 38px 0 0 -2px, -14px 0 0 -2px, -38px 0 0 -2px;
  }
  25% {
    box-shadow: 14px 0 0 -2px, 38px 0 0 -2px, -14px 0 0 -2px, -38px 0 0 2px;
  }
  50% {
    box-shadow: 14px 0 0 -2px, 38px 0 0 -2px, -14px 0 0 2px, -38px 0 0 -2px;
  }
  75% {
    box-shadow: 14px 0 0 2px, 38px 0 0 -2px;
  }
}
</style>
