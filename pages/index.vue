<template>
  <div class="flex flex-col items-center justify-center min-h-screen py-20 text-center bg-gradient-to-b from-[#3f4c6b] to-[#606c88]">
    <div class="mb-16">
      <h1 class="text-7xl font-bold mb-8 text-white">Life<br>Accelerator</h1>
      <p class="text-lg max-w-md mx-auto opacity-80 mb-16 text-zinc-200">Get instant guidance and clarity for your life's challenges</p>
      <button
        @click="loginWithGoogle"
        class="px-8 py-4 rounded-full bg-gradient-to-r from-indigo-400 to-pink-400 text-white font-medium hover:opacity-90 transition flex items-center justify-center mx-auto"
      >
        <span>Login with Google</span>
      </button>
    </div>
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
  if (error) console.error('Login error:', error.message);
};
</script>