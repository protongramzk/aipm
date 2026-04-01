// src/lib/supabase.js
import { createClient } from '@supabase/supabase-js'
const SUPABASE_URL="https://ueiurduvhlcxgiwxniqb.supabase.co"
const SUPABASE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlaXVyZHV2aGxjeGdpd3huaXFiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDU0ODYyNSwiZXhwIjoyMDkwMTI0NjI1fQ.gmoXCoWGonuxkq6UPazDr-KDj4D0BUYIRxXvvnsbmYA"

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
