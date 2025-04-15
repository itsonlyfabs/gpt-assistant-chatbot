<template>
  <ChatComponent />
</template>

<script setup>
import { supabase } from '@/utils/supabaseClient'
import { useRouter } from 'vue-router'

const router = useRouter()

const { data: { user } } = await supabase.auth.getUser()

if (!user) {
  router.push('/') // redirect to login if not logged in
}
</script>
