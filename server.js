// Production server for Render: serves the built app (dist/) and the AI route.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { suggest } from './server/suggest.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist')
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8'
}

const readBody = req => new Promise((resolve, reject) => {
  const chunks = []; let size = 0
  req.on('data', d => {
    size += d.length
    if (size > 100_000) { const e = new Error('too large'); e.code = 413; reject(e); req.destroy(); return }
    chunks.push(d)
  })
  req.on('end', () => resolve(Buffer.concat(chunks)))
  req.on('error', reject)
})

const send = (res, status, body, headers = {}) => { res.writeHead(status, headers); res.end(body) }
const sendJson = (res, status, obj) => send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json' })

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')

    if (url.pathname === '/health') return send(res, 200, 'ok', { 'Content-Type': 'text/plain' })

    if (url.pathname === '/api/suggest-ingredients') {
      const body = req.method === 'POST' ? await readBody(req) : undefined
      const r = await suggest(new Request('http://localhost' + req.url, { method: req.method, headers: req.headers, body }), process.env)
      return send(res, r.status, Buffer.from(await r.arrayBuffer()), Object.fromEntries(r.headers))
    }
    if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' })

    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed' })

    // Static files, with a safe path check
    let rel
    try { rel = decodeURIComponent(url.pathname) } catch { return sendJson(res, 400, { error: 'Bad request' }) }
    let file = path.resolve(root, '.' + rel)
    if (file !== root && !file.startsWith(root + path.sep)) return sendJson(res, 403, { error: 'Forbidden' })

    let stat = null
    try { stat = fs.statSync(file) } catch {}
    if (!stat || stat.isDirectory()) {
      // Missing file with an extension is a real 404; anything else is an app route, so serve the app.
      if (path.extname(rel)) return sendJson(res, 404, { error: 'Not found' })
      file = path.join(root, 'index.html')
    }
    const ext = path.extname(file)
    const cache = file.includes(path.sep + 'assets' + path.sep) ? 'public, max-age=31536000, immutable' : 'no-cache'
    const data = fs.readFileSync(file)
    send(res, 200, req.method === 'HEAD' ? undefined : data, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': cache })
  } catch (e) {
    if (e.code === 413) return sendJson(res, 413, { error: 'Request too large' })
    console.error(e)
    sendJson(res, 500, { error: 'Server error' })
  }
})

const port = process.env.PORT || 3000
server.listen(port, '0.0.0.0', () => console.log('Kitchen Forecast listening on ' + port))
