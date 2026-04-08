import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import { supabase } from './lib/supabase.js'

// import semua logic lu
import { register, login,refreshSession, getMe, getSession } from './lib/auth.js'
import {
  createApiKey,
  getMyApiKeys,
  deleteApiKey,
  renameApiKey
} from './lib/api-keys.js'
import {
  getPackages,
  getPackageDetail
} from './lib/packages.js'

import {
  toggleStar,
  getStarStatus
} from './lib/interaction.js'
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

  app.get('/u/:id', async (req,reply) => {
  
    const me = await getMe(req.params.id)
    return { user: me }
  })

  app.get('/auth/session', async () => {
    const session = await getSession()
    return { session }
  })

  app.get('/auth/me', { preHandler: authMiddleware }, async (req) => {
    const me = await getMe(req.user.id)
    return { user: me }
  })
  app.post('/refresh-token', async (request, reply) => {
    try {
      const { refresh_token: bodyRefreshToken } = request.body || {}
      if (!bodyRefreshToken) {
        return reply.status(400).send({ error: 'refresh_token is required' })
      }
      const { access_token, refresh_token } = await refreshSession(bodyRefreshToken)
      reply.send({ access_token, refresh_token })
    } catch (err) {
      reply.status(401).send({ error: 'cannot refresh token' })
    }
  })
  // ==============================
  // 🔑 API KEYS
  // ==============================
  app.get('/api-keys', { preHandler: authMiddleware }, async (req) => {
    const keys = await getMyApiKeys(req.user)
    return { keys }
  })

  app.post('/api-keys', { preHandler: authMiddleware }, async (req) => {
    const { name } = req.body
    const key = await createApiKey(req.user, name)
    return { key }
  })

  app.delete('/api-keys/:id', { preHandler: authMiddleware }, async (req) => {
    const { id } = req.params
    return await deleteApiKey(req.user, id)
  })

  app.put('/api-keys/:id', { preHandler: authMiddleware }, async (req) => {
    const { id } = req.params
    const { name } = req.body
    return await renameApiKey(req.user, id, name)
  })

  // ==============================
  // 📦 PACKAGES
  // ==============================
// ==============================
// 📦 PACKAGES
// ==============================
app.get('/packages', { preHandler: async (req, reply) => { try { await authMiddleware(req, reply) } catch (e) {} } }, async (req) => {
  const { type, username } = req.query;

  let queryType = type;
  let userFilter = username;

  // 🔹 kalau tab 'you', override type + set username
  if (type === 'you' && req.user) { // misal req.user ada dari session
    queryType = 'user';
    userFilter = req.user.username;
  }

  const data = await getPackages({ type: queryType, username: userFilter });
  return { packages: data };
});
  app.get('/mol/:pkgname', async (req) => {
    const { pkgname } = req.params
    return await getPackageDetail(pkgname)
  })

  app.get('/tree/:pkgname', async (req) => {
    const { pkgname } = req.params
    const data = await getPackageDetail(pkgname)
    return { tree: data.tree }
  })


// ==============================
// ⭐ STAR / INTERACTION
// ==============================

// TOGGLE STAR
app.post('/star/:pkgname', { preHandler: authMiddleware }, async (req, reply) => {
  try {
    const { pkgname } = req.params
    const result = await toggleStar(req.user.id, pkgname)
    return result
  } catch (err) {
    // Debounce error → 429
    if (err.message.startsWith('Terlalu cepat')) {
      return reply.code(429).send({ error: err.message })
    }
    // Package not found → 404
    if (err.message.includes('tidak ditemukan')) {
      return reply.code(404).send({ error: err.message })
    }
    return reply.code(500).send({ error: err.message })
  }
})

// GET STAR STATUS
app.get('/star/:pkgname', { preHandler: authMiddleware }, async (req, reply) => {
  try {
    const { pkgname } = req.params
    const result = await getStarStatus(req.user.id, pkgname)
    return result
  } catch (err) {
    if (err.message.includes('tidak ditemukan')) {
      return reply.code(404).send({ error: err.message })
    }
    return reply.code(500).send({ error: err.message })
  }
})

  return app
}
