<template>
  <div class="max-w-xl mx-auto text-center py-20">
    <h1 class="text-4xl font-bold mb-6">Welcome!</h1>
    <p class="mb-6 text-gray-600">Login with Google to start your Free Chat Session</p>
    <button
      @click="loginWithGoogle"
      class="px-6 py-3 bg-green-500 text-white rounded-full hover:bg-green-600 transition"
    >
      Login with Google
    </button>
  </div>
</template>

<script setup>
import { supabase } from '@/utils/supabaseClient'

const loginWithGoogle = async () => {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/chat`
    }
  });
  if (error) console.error('Login error:', error)
}
</script>
