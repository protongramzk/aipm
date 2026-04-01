import { buildApp } from '../serve.js'

let app

export default async function handler(req, res) {
  if (!app) {
    app = await buildApp()
    await app.ready()
  }

  app.server.emit('request', req, res)
}
