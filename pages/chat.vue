<template>
  <ChatComponent />
</template>

<script setup>
import { supabase } from '@/utils/supabaseClient'
import ChatComponent from '@/components/ChatComponent.vue' // we move your full chat here

const { data: { user } } = await supabase.auth.getUser()

if (!user) {
  navigateTo('/') // Force to login if not logged in
}
</script>
