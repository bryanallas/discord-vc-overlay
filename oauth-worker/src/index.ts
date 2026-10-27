interface Env {
  DISCORD_CLIENT_ID: string
  DISCORD_CLIENT_SECRET: string
  DISCORD_REDIRECT_URI: string
}

interface TokenRequest {
  code?: string
  refresh_token?: string
}

const corsHeaders = {
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-origin': '*'
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/oauth/callback' && request.method === 'GET') {
      return new Response('Discord sign-in is complete. You can close this page and return to the app.', {
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      })
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }
    if (url.pathname !== '/token' || request.method !== 'POST') {
      return json({ error: 'Not found.' }, 404)
    }
    if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET || !env.DISCORD_REDIRECT_URI) {
      return json({ error: 'The Discord OAuth service is not configured.' }, 503)
    }

    const declaredLength = Number(request.headers.get('content-length') ?? 0)
    if (declaredLength > 8192) return json({ error: 'Request is too large.' }, 413)

    let input: TokenRequest
    try {
      const body = await request.text()
      if (body.length > 8192) return json({ error: 'Request is too large.' }, 413)
      input = JSON.parse(body) as TokenRequest
    } catch {
      return json({ error: 'Expected a JSON request body.' }, 400)
    }

    const isRefresh = typeof input.refresh_token === 'string' && input.refresh_token.length > 0
    const code = typeof input.code === 'string' ? input.code : ''
    if (!isRefresh && !code) return json({ error: 'Missing authorization code.' }, 400)
    if (code.length > 4096 || (input.refresh_token?.length ?? 0) > 4096) {
      return json({ error: 'Invalid token request.' }, 400)
    }

    const form = new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: isRefresh ? 'refresh_token' : 'authorization_code'
    })
    if (isRefresh) {
      form.set('refresh_token', input.refresh_token!)
    } else {
      form.set('code', code)
      form.set('redirect_uri', env.DISCORD_REDIRECT_URI)
    }

    let discordResponse: Response
    try {
      discordResponse = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': 'discord-vc-overlay-oauth'
        },
        body: form
      })
    } catch {
      return json({ error: 'Could not reach Discord OAuth.' }, 502)
    }

    const body = await discordResponse.json().catch(() => null) as Record<string, unknown> | null
    if (!discordResponse.ok) {
      const message = typeof body?.error_description === 'string'
        ? body.error_description
        : 'Discord rejected the authorization. Sign in again.'
      const error = typeof body?.error === 'string' ? body.error : 'oauth_error'
      const status = [400, 401, 403, 429].includes(discordResponse.status)
        ? discordResponse.status
        : 502
      return json({ error, message }, status)
    }

    return json(body ?? { error: 'Discord returned an invalid token response.' }, discordResponse.status)
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8'
    }
  })
}
