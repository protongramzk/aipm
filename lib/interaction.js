// interaction.js
// Mengelola interaksi user terhadap package (star/unstar)
// Semua operasi membutuhkan user yang sudah login (JWT via Supabase Auth)

import { supabase } from './supabase.js'

// ==============================
// ⏱️ IN-MEMORY DEBOUNCE STORE
// ==============================
// Map<userId_packageId, timestamp>
// Mencegah spam toggle star dalam waktu singkat
const starDebounceMap = new Map()

const DEBOUNCE_MS = 3000 // 3 detik cooldown per user per package

function getDebounceKey(userId, packageId) {
  return `${userId}::${packageId}`
}

function isDebounced(userId, packageId) {
  const key = getDebounceKey(userId, packageId)
  const last = starDebounceMap.get(key)
  if (!last) return false
  return Date.now() - last < DEBOUNCE_MS
}

function setDebounce(userId, packageId) {
  const key = getDebounceKey(userId, packageId)
  starDebounceMap.set(key, Date.now())
}

// ==============================
// ⭐ TOGGLE STAR
// ==============================
/**
 * Toggle star untuk sebuah package.
 * - Jika user belum star → tambah star
 * - Jika user sudah star → hapus star
 * - Debounce 3 detik per user per package (anti spam)
 *
 * @param {string} userId     - UUID user dari JWT
 * @param {string} packageName - Nama package (bukan UUID)
 * @returns {{ starred: boolean, stars: number }}
 */
export async function toggleStar(userId, packageName) {
  // 1. Resolve package id dari name
  const { data: pkg, error: pkgErr } = await supabase
    .from('packages')
    .select('id, stars_count')
    .eq('name', packageName)
    .single()

  if (pkgErr || !pkg) throw new Error(`Package "${packageName}" tidak ditemukan`)

  const packageId = pkg.id

  // 2. Cek debounce
  if (isDebounced(userId, packageId)) {
    const key = getDebounceKey(userId, packageId)
    const elapsed = Date.now() - starDebounceMap.get(key)
    const remaining = Math.ceil((DEBOUNCE_MS - elapsed) / 1000)
    throw new Error(`Terlalu cepat. Coba lagi dalam ${remaining} detik.`)
  }

  // 3. Cek apakah sudah pernah star
  const { data: existing, error: checkErr } = await supabase
    .from('package_stars')
    .select('user_id')
    .eq('user_id', userId)
    .eq('package_id', packageId)
    .maybeSingle()

  if (checkErr) throw checkErr

  let starred
  let newCount

  if (existing) {
    // ❌ Sudah star → unstar
    const { error: delErr } = await supabase
      .from('package_stars')
      .delete()
      .eq('user_id', userId)
      .eq('package_id', packageId)

    if (delErr) throw delErr

    // Decrement stars_count (tidak boleh negatif)
    newCount = Math.max(0, (pkg.stars_count || 0) - 1)
    starred = false
  } else {
    // ⭐ Belum star → star
    const { error: insErr } = await supabase
      .from('package_stars')
      .insert({ user_id: userId, package_id: packageId })

    if (insErr) throw insErr

    newCount = (pkg.stars_count || 0) + 1
    starred = true
  }

  // 4. Update stars_count di tabel packages
  const { error: updateErr } = await supabase
    .from('packages')
    .update({ stars_count: newCount })
    .eq('id', packageId)

  if (updateErr) throw updateErr

  // 5. Set debounce setelah berhasil
  setDebounce(userId, packageId)

  return { starred, stars: newCount }
}

// ==============================
// 🔍 GET STAR STATUS
// ==============================
/**
 * Cek apakah user sudah memberi star pada package tertentu.
 *
 * @param {string} userId
 * @param {string} packageName
 * @returns {{ starred: boolean, stars: number }}
 */
export async function getStarStatus(userId, packageName) {
  const { data: pkg, error: pkgErr } = await supabase
    .from('packages')
    .select('id, stars_count')
    .eq('name', packageName)
    .single()

  if (pkgErr || !pkg) throw new Error(`Package "${packageName}" tidak ditemukan`)

  const { data: existing } = await supabase
    .from('package_stars')
    .select('user_id')
    .eq('user_id', userId)
    .eq('package_id', pkg.id)
    .maybeSingle()

  return {
    starred: !!existing,
    stars: pkg.stars_count || 0
  }
}
