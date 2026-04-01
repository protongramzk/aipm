// routes/auth.js
import {
  register,
  login,
  getMe,
  refreshSession
} from '../lib/auth.js'

export default async function authRoutes(fastify, opts) {
  // ============================
  // 📝 REGISTER
  // ============================
  fastify.post('/register', async (request, reply) => {
    try {
      const { email, password, username } = request.body

      if (!email || !password || !username) {
        return reply.code(400).send({
          success: false,
          error: 'Missing fields'
        })
      }

      const data = await register(email, password, username)

      return {
        success: true,
        ...data
      }
    } catch (err) {
      return reply.code(400).send({
        success: false,
        error: err.message
      })
    }
  })

  // ============================
  // 🔑 LOGIN
  // ============================
  fastify.post('/login', async (request, reply) => {
    try {
      const { email, password } = request.body

      if (!email || !password) {
        return reply.code(400).send({
          success: false,
          error: 'Missing email or password'
        })
      }

      const data = await login(email, password)

      return {
        success: true,
        ...data
      }
    } catch (err) {
      return reply.code(401).send({
        success: false,
        error: err.message
      })
    }
  })

  // ============================
  // 👤 GET ME (Protected)
  // ============================
  fastify.get('/me', async (request, reply) => {
    try {
      const auth = request.headers.authorization

      if (!auth) {
        return reply.code(401).send({
          success: false,
          error: 'No token provided'
        })
      }

      const token = auth.replace('Bearer ', '')

      // inject token ke supabase client
      fastify.supabase.auth.setSession({
        access_token: token,
        refresh_token: token // dummy (ga dipakai di sini)
      })

      const user = await getMe()

      return {
        success: true,
        user
      }
    } catch (err) {
      return reply.code(401).send({
        success: false,
        error: 'Invalid token'
      })
    }
  })

  // ============================
  // 🔄 REFRESH TOKEN
  // ============================
  fastify.post('/refresh', async (request, reply) => {
    try {
      const data = await refreshSession()

      return {
        success: true,
        ...data
      }
    } catch (err) {
      return reply.code(401).send({
        success: false,
        error: err.message
      })
    }
  })
}
