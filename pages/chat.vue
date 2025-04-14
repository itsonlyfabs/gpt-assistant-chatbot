<template>
  <ChatComponent />
</template>

<script setup>
import { supabase } from '@/utils/supabaseClient'
import ChatComponent from '@/components/ChatComponent.vue'

const { data: { user } } = await supabase.auth.getUser()

if (!user) {
  navigateTo('/') // redirect to login
}
</script>
