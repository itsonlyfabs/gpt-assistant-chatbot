import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://ucardnloqccmtrwxmbnv.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjYXJkbmxvcWNjbXRyd3htYm52Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQ1OTMwMTksImV4cCI6MjA2MDE2OTAxOX0.s7xR6KCRGJlWSVx9Z_TbBBa-0ASWOn8qEojQHDxqmg0'

export const supabase = createClient(supabaseUrl, supabaseKey)
