import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'

import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'
import {
  register,
  login,
  getMe,
  getSession
} from './lib/auth.js'

import {
  createApiKey,
  getMyApiKeys,
  deleteApiKey,
  renameApiKey
} from './lib/api-keys.js'

import {
  getPackages,
  uploadPackage,
  getPackageDetail
} from './lib/packages.js'

import { supabase } from './lib/supabase.js'

// ==============================
// ⚙️ INIT
// ==============================
const app = Fastify({ logger: true })
// Izinkan Fastify nerima content-type octet-stream tanpa mencoba mem-parse body-nya
app.addContentTypeParser('application/octet-stream', (req, payload, done) => {
  done(null)
})
await app.register(cors, { origin: true })
await app.register(multipart)

// ==============================
// 🔐 MIDDLEWARE AUTH (JWT)
// ==============================
async function authMiddleware(req, reply) {
  const token = req.headers.authorization?.replace('Bearer ', '')

  if (!token) {
    return reply.code(401).send({ error: 'Unauthorized' })
  }

  const { data, error } = await supabase.auth.getUser(token)

  if (error || !data.user) {
    return reply.code(401).send({ error: 'Invalid token' })
  }

  req.user = data.user
}

// ==============================
// 🔑 AUTH ROUTES
// ==============================

app.post('/auth/register', async (req, reply) => {
  try {
    const { email, password, username } = req.body
    const data = await register(email, password, username)
    return { success: true, ...data }
  } catch (err) {
    return reply.code(400).send({ error: err.message })
  }
})

app.post('/auth/login', async (req, reply) => {
  try {
    const { email, password } = req.body
    const data = await login(email, password)
    return { success: true, ...data }
  } catch (err) {
    return reply.code(400).send({ error: err.message })
  }
})

app.get('/auth/me', { preHandler: authMiddleware }, async () => {
  const me = await getMe()
  return { user: me }
})

app.get('/auth/session', async () => {
  const session = await getSession()
  return { session }
})

// ==============================
// 🔑 API KEYS ROUTES
// ==============================

app.get('/api-keys', { preHandler: authMiddleware }, async () => {
  const keys = await getMyApiKeys()
  return { keys }
})

app.post('/api-keys', { preHandler: authMiddleware }, async (req) => {
  const { name } = req.body
  const key = await createApiKey(name)
  return { key }
})

app.delete('/api-keys/:id', { preHandler: authMiddleware }, async (req) => {
  const { id } = req.params
  return await deleteApiKey(id)
})

app.put('/api-keys/:id', { preHandler: authMiddleware }, async (req) => {
  const { id } = req.params
  const { name } = req.body
  return await renameApiKey(id, name)
})

// ==============================
// 📦 PACKAGES
// ==============================

// GET ALL (feed / rank / user)
app.get('/packages', async (req) => {
  const { type, username } = req.query
  const data = await getPackages({ type, username })
  return { packages: data }
})

// DETAIL PACKAGE
app.get('/mol/:pkgname', async (req) => {
  const { pkgname } = req.params
  const data = await getPackageDetail(pkgname)
  return data
})

// TREE ONLY
app.get('/tree/:pkgname', async (req) => {
  const { pkgname } = req.params
  const data = await getPackageDetail(pkgname)
  return { tree: data.tree }
})

// 2. Update bagian PACKAGES /create
app.post('/create', {
  preHandler: authMiddleware
}, async (req, reply) => {
  // Ambil nama file dari header yang kita set di CLI tadi
  const fileName = req.headers['x-file-name'] || `upload_${Date.now()}.tgz`
  const filepath = `./tmp_${Date.now()}_${fileName}`

  try {
    // req.raw adalah stream mentah dari Node.js (IncomingMessage)
    // Kita langsung "piping" ke file system
    await pipeline(req.raw, createWriteStream(filepath))

    // Setelah selesai streaming, baru panggil logika uploadPackage
    const result = await uploadPackage({
      filePath: filepath,
      userId: req.user.id
    })

    return result
  } catch (err) {
    req.log.error(err)
    return reply.code(500).send({ error: 'Gagal memproses file binary' })
  }
})
// ==============================
// 🟢 START SERVER
// ==============================
app.listen({ port: 3000, host: '0.0.0.0' })
  .then(() => {
    console.log('🚀 Server running on http://localhost:3000')
  })
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
