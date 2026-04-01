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
  const { error: accError } = await supabase
    .from('accounts')
    .insert({
      id: user.id,
      username
    })

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
export async function getMe() {
  const { data, error } = await supabase.auth.getUser()

  if (error) throw error
  if (!data.user) return null

  // ambil profile dari accounts
  const { data: account, error: accError } = await supabase
    .from('accounts')
    .select('*')
    .eq('id', data.user.id)
    .single()

  if (accError) throw accError

  return {
    ...data.user,
    account
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
