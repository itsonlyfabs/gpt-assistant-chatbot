<template>
  <ChatComponent />
</template>

<script setup>
import { supabase } from '@/utils/supabaseClient'
import { useRouter } from 'vue-router'
import { onMounted } from 'vue'

const router = useRouter()

// Check authentication on mount
onMounted(async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      console.log('No authenticated user found, redirecting to login')
      router.push('/')
    } else {
      console.log('Authenticated user:', user.email)
    }
  } catch (error) {
    console.error('Authentication error:', error)
    router.push('/')
  }
})
</script>