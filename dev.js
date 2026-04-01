import { buildApp } from './serve.js'

const start = async () => {
  const app = await buildApp()

  try {
    await app.listen({
      port: 3000,
      host: '0.0.0.0'
    })

    console.log('🚀 DEV server jalan di http://localhost:3000')
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
}

start()
