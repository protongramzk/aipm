import { supabase } from './supabase.js'
import crypto from 'crypto'

// ==============================
// 🔐 UTIL
// ==============================
function generateApiKey() {
  const raw = crypto.randomBytes(32).toString('hex')
  return `mol_${raw}`
}

function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex')
}

// ==============================
// ➕ CREATE API KEY
// ==============================
export async function createApiKey(user, name = 'default') {
  if (!user) throw new Error('Unauthorized')

  const rawKey = generateApiKey()
  const hashed = hashKey(rawKey)

  const { data, error } = await supabase
    .from('api_keys')
    .insert({ account_id: user.id, name, hashed_key: hashed })
    .select()
    .single()

  if (error) throw error

  // raw key cuma dikasih sekali
  return { id: data.id, name: data.name, key: rawKey, created_at: data.created_at }
}

// ==============================
// 📜 GET MY API KEYS
// ==============================
export async function getMyApiKeys(user) {
  if (!user) throw new Error('Unauthorized')

  const { data, error } = await supabase
    .from('api_keys')
    .select('id, name, created_at')
    .eq('account_id', user.id)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

// ==============================
// ❌ DELETE API KEY
// ==============================
export async function deleteApiKey(user, id) {
  if (!user) throw new Error('Unauthorized')

  const { error } = await supabase
    .from('api_keys')
    .delete()
    .eq('id', id)
    .eq('account_id', user.id)

  if (error) throw error
  return { success: true }
}

// ==============================
// 🔄 RENAME API KEY
// ==============================
export async function renameApiKey(user, id, newName) {
  if (!user) throw new Error('Unauthorized')

  const { data, error } = await supabase
    .from('api_keys')
    .update({ name: newName })
    .eq('id', id)
    .eq('account_id', user.id)
    .select()
    .single()

  if (error) throw error
  return data
}

// ==============================
// 🔍 VERIFY API KEY (SERVER USE)
// ==============================
export async function verifyApiKey(rawKey) {
  const hashed = hashKey(rawKey)

  const { data, error } = await supabase
    .from('api_keys')
    .select('id, account_id')
    .eq('hashed_key', hashed)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  return { key_id: data.id, account_id: data.account_id }
}
