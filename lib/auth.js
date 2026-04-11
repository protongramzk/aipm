import { supabase } from './supabase.js'

// ==============================
// 🔐 REGISTER (auto login)
// ==============================
export async function register(email, password, username) {
  // 1. signup ke supabase auth
  const { data, error } = await supabase.auth.signUp({
    email,
    password
  })

  if (error) throw error

  // 2. ambil user id
  const user = data.user

  if (!user) {
    throw new Error('User not created')
  }

  // 3. insert ke accounts (profile)
  // Gunakan upsert supaya kalau script jalan dua kali, nggak error duplicate
const { error: accError } = await supabase
  .from('accounts')
  .upsert({
    id: user.id,
    username: username
  }, { onConflict: 'id' }) 

  if (accError) throw accError

  // 4. ambil session (JWT)
  const { data: sessionData } = await supabase.auth.getSession()

  return {
    user,
    access_token: sessionData.session?.access_token,
    refresh_token: sessionData.session?.refresh_token
  }
}

// ==============================
// 🔑 LOGIN
// ==============================
export async function login(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  })

  if (error) throw error

  const session = data.session

  return {
    user: data.user,
    access_token: session.access_token,
    refresh_token: session.refresh_token
  }
}

// ==============================
// 🔓 LOGOUT
// ==============================
export async function logout() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

// ==============================
// 🧾 GET SESSION (JWT)
// ==============================
export async function getSession() {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error

  return data.session
}

// ==============================
// 👤 GET ME (auth + accounts)
// ==============================
export async function getMe(id) {

  if (!id) {
    return { user: null}
  }

  const { data: account } = await supabase
    .from('accounts')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (!account) {
    return { user: null}
  }

  return {
      id: account.id,
      username: account.username,
      created_at: account.created_at
    }
}
// ==============================
// 🔄 REFRESH TOKEN
// ==============================
export async function refreshSession() {
  const { data, error } = await supabase.auth.refreshSession()

  if (error) throw error

  return {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token
  }
}
