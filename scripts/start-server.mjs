#!/usr/bin/env node
import { createServer } from 'node:http'
import { Readable } from 'node:stream'

const port = Number(process.env.PORT || 3000)
const host = process.env.HOST || '0.0.0.0'

const mod = await import('../dist/server/server.js')
const app = mod.default

if (!app || typeof app.fetch !== 'function') {
  throw new Error('Invalid server entry: expected default export with fetch(request).')
}

const server = createServer(async (req, res) => {
  try {
    const proto = req.headers['x-forwarded-proto'] || 'http'
    const authority = req.headers.host || `127.0.0.1:${port}`
    const url = `${proto}://${authority}${req.url || '/'}`
    const method = (req.method || 'GET').toUpperCase()
    const hasBody = method !== 'GET' && method !== 'HEAD'

    const request = new Request(url, {
      method,
      headers: new Headers(req.headers),
      body: hasBody ? Readable.toWeb(req) : undefined,
      duplex: hasBody ? 'half' : undefined,
    })

    const response = await app.fetch(request)

    res.statusCode = response.status
    res.statusMessage = response.statusText

    const setCookies = response.headers.getSetCookie?.() || []
    if (setCookies.length > 0) {
      res.setHeader('set-cookie', setCookies)
    }

    for (const [key, value] of response.headers) {
      if (key.toLowerCase() === 'set-cookie') continue
      res.setHeader(key, value)
    }

    if (!response.body) {
      res.end()
      return
    }

    Readable.fromWeb(response.body).pipe(res)
  } catch (error) {
    console.error(error)
    if (!res.headersSent) {
      res.statusCode = 500
      res.setHeader('content-type', 'text/plain; charset=utf-8')
    }
    res.end('Internal Server Error')
  }
})

server.listen(port, host, () => {
  console.log(`[start] PullNotes listening on http://${host}:${port}`)
})
