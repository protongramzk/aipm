import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import { supabase } from './lib/supabase.js'

// import semua logic lu
import { register, login, getMe, getSession } from './lib/auth.js'
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

export async function buildApp() {
  const app = Fastify({ logger: true })

  // biar octet-stream gak error
  app.addContentTypeParser('application/octet-stream', (req, payload, done) => {
    done(null)
  })

  await app.register(cors, { origin: true })
  await app.register(multipart)

  // ==============================
  // 🔐 AUTH MIDDLEWARE
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
  // 🔑 AUTH
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
  // 🔑 API KEYS
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
  app.get('/packages', async (req) => {
    const { type, username } = req.query
    const data = await getPackages({ type, username })
    return { packages: data }
  })

  app.get('/mol/:pkgname', async (req) => {
    const { pkgname } = req.params
    return await getPackageDetail(pkgname)
  })

  app.get('/tree/:pkgname', async (req) => {
    const { pkgname } = req.params
    const data = await getPackageDetail(pkgname)
    return { tree: data.tree }
  })

  // ⚠️ upload (note: jangan pakai fs di vercel)
  app.post('/create', {
    preHandler: authMiddleware
  }, async (req, reply) => {
    try {
      const chunks = []
      for await (const chunk of req.raw) {
        chunks.push(chunk)
      }

      const buffer = Buffer.concat(chunks)

      const result = await uploadPackage({
        buffer,
        userId: req.user.id
      })

      return result
    } catch (err) {
      req.log.error(err)
      return reply.code(500).send({ error: 'Upload gagal' })
    }
  })

  return app
}



