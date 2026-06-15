/**
 * Claude Code Desktop App — HTTP + WebSocket Server
 *
 * 为桌面端 UI 提供 REST API 和 WebSocket 实时通信。
 * 读写与 CLI 完全相同的文件系统，确保 CLI/UI 数据互通。
 */

import { handleApiRequest } from './router.js'
import { handleWebSocket, type WebSocketData } from './ws/handler.js'
import { corsHeaders } from './middleware/cors.js'
import { requireAuth } from './middleware/auth.js'
import { teamWatcher } from './services/teamWatcher.js'
import { cronScheduler } from './services/cronScheduler.js'
import { handleProxyRequest, setServerProxyConfig } from './proxy/handler.js'
import { ProviderService } from './services/providerService.js'
import { handleHahaOAuthCallback } from './api/haha-oauth.js'
import { ensureDesktopCliLauncherInstalled } from './services/desktopCliLauncherService.js'

function readArgValue(flag: string): string | undefined {
  const args = process.argv.slice(2)
  const index = args.indexOf(flag)
  if (index === -1) return undefined
  return args[index + 1]
}

function hasArgFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag)
}

type ApiFormat = 'anthropic' | 'openai_chat' | 'openai_responses'

const VALID_API_FORMATS: ApiFormat[] = ['anthropic', 'openai_chat', 'openai_responses']

function resolveServerOptions() {
  const portArg = readArgValue('--port')
  const port = Number.parseInt(portArg || process.env.SERVER_PORT || '3456', 10)
  const host = readArgValue('--host') || process.env.SERVER_HOST || '127.0.0.1'
  const cliPath = readArgValue('--cli-path')
  const historyDir = readArgValue('--history-dir')
  const apiKey = readArgValue('--api-key')
  const baseUrl = readArgValue('--base-url')
  const model = readArgValue('--model')
  const apiFormat = (readArgValue('--api-format') || 'anthropic') as ApiFormat
  const authRequired = hasArgFlag('--auth-required')

  // Server mode requires all three provider params
  const missing: string[] = []
  if (!apiKey) missing.push('--api-key')
  if (!baseUrl) missing.push('--base-url')
  if (!model) missing.push('--model')
  if (missing.length > 0) {
    console.error(`[Server] Missing required arguments: ${missing.join(', ')}`)
    process.exit(1)
  }

  if (!VALID_API_FORMATS.includes(apiFormat)) {
    console.error(`[Server] Invalid --api-format: "${apiFormat}". Valid values: ${VALID_API_FORMATS.join(', ')}`)
    process.exit(1)
  }

  if (cliPath) {
    process.env.CLAUDE_CLI_PATH = cliPath
  }

  if (historyDir) {
    process.env.CLAUDE_CONFIG_DIR = historyDir
  }

  // Override all ANTHROPIC_* provider env vars with CLI args.
  // These take absolute priority over .env files and settings.json.
  //
  // For non-anthropic API formats (openai_chat, openai_responses), the actual
  // ANTHROPIC_BASE_URL is set later in startServer() to point to the local
  // proxy, which translates Anthropic format to the upstream format.
  process.env.ANTHROPIC_API_KEY = apiFormat === 'anthropic' ? apiKey : 'proxy-managed'
  process.env.ANTHROPIC_BASE_URL = baseUrl
  process.env.ANTHROPIC_MODEL = model
  // Force all model family defaults to the specified model
  process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = model
  process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = model
  process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = model
  process.env.ANTHROPIC_SMALL_FAST_MODEL = model

  const maskedKey = apiKey!.length > 8
    ? `${apiKey!.slice(0, 4)}...${apiKey!.slice(-4)}`
    : '****'
  console.log(`[Server] Resolved options:`)
  console.log(`[Server]   port=${port} host=${host} auth=${authRequired ? 'required' : 'off'}`)
  console.log(`[Server]   base-url=${baseUrl}`)
  console.log(`[Server]   api-key=${maskedKey}`)
  console.log(`[Server]   model=${model} (all families)`)
  console.log(`[Server]   api-format=${apiFormat}`)
  if (cliPath) console.log(`[Server]   cli-path=${cliPath}`)
  if (historyDir) console.log(`[Server]   history-dir=${historyDir}`)

  return { port, host, authRequired, apiFormat, apiKey: apiKey!, baseUrl: baseUrl! }
}

const SERVER_OPTIONS = resolveServerOptions()
const PORT = SERVER_OPTIONS.port
const HOST = SERVER_OPTIONS.host

export function startServer(port = PORT, host = HOST) {
  ProviderService.setServerPort(port)
  const localConnectHost =
    host === '0.0.0.0' || host === '127.0.0.1' || host === 'localhost'
      ? '127.0.0.1'
      : host

  // For non-anthropic API formats, route CLI requests through the local proxy
  // which translates Anthropic Messages API → OpenAI Chat/Responses API.
  const needsProxy = SERVER_OPTIONS.apiFormat !== 'anthropic'
  if (needsProxy) {
    setServerProxyConfig({
      baseUrl: SERVER_OPTIONS.baseUrl,
      apiKey: SERVER_OPTIONS.apiKey,
      apiFormat: SERVER_OPTIONS.apiFormat,
    })
    const proxyUrl = `http://127.0.0.1:${port}/proxy/v1/messages`
    process.env.ANTHROPIC_BASE_URL = proxyUrl
    process.env.ANTHROPIC_API_KEY = 'proxy-managed'
    console.log(`[Server] Non-anthropic format (${SERVER_OPTIONS.apiFormat}): routing CLI through proxy -> ${proxyUrl}`)
  }

  /**
   * Auth is required when explicitly opted in or when bound to a non-localhost address.
   * - Default localhost dev: no auth needed (tests pass as-is).
   * - Production / non-localhost (e.g. 0.0.0.0): auth enforced automatically.
   * - Explicit opt-in: SERVER_AUTH_REQUIRED=1 forces auth even on localhost.
   */
  const authRequired =
    SERVER_OPTIONS.authRequired ||
    process.env.SERVER_AUTH_REQUIRED === '1' ||
    host !== '127.0.0.1'

  const server = Bun.serve<WebSocketData>({
    port,
    hostname: host,

    async fetch(req, server) {
      const url = new URL(req.url)
      const startTime = Date.now()

      const origin = req.headers.get('Origin')

      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders(origin) })
      }

      // WebSocket upgrade
      if (url.pathname.startsWith('/ws/')) {
        // Enforce authentication when required
        if (authRequired) {
          const authError = requireAuth(req)
          if (authError) {
            console.warn(`[Server] WS auth rejected: ${url.pathname}`)
            const headers = new Headers(authError.headers)
            for (const [key, value] of Object.entries(corsHeaders(origin))) {
              headers.set(key, value)
            }
            return new Response(authError.body, { status: authError.status, headers })
          }
        }

        // Validate session ID format
        const sessionId = url.pathname.split('/').pop() || ''
        if (!sessionId || !/^[0-9a-zA-Z_-]{1,64}$/.test(sessionId)) {
          console.warn(`[Server] Invalid WS session ID: ${sessionId}`)
          return new Response('Invalid session ID', { status: 400 })
        }
        console.log(`[Server] WS upgrade /ws/ session=${sessionId}`)
        const upgraded = server.upgrade(req, {
          data: {
            sessionId,
            connectedAt: Date.now(),
            channel: 'client',
            sdkToken: null,
            serverPort: port,
            serverHost: localConnectHost,
          },
        })
        if (upgraded) return undefined
        console.error(`[Server] WS upgrade failed for session=${sessionId}`)
        return new Response('WebSocket upgrade failed', { status: 400 })
      }

      // Internal SDK WebSocket used by the spawned Claude CLI.
      if (url.pathname.startsWith('/sdk/')) {
        const sessionId = url.pathname.split('/').pop() || ''
        if (!sessionId || !/^[0-9a-zA-Z_-]{1,64}$/.test(sessionId)) {
          console.warn(`[Server] Invalid SDK session ID: ${sessionId}`)
          return new Response('Invalid session ID', { status: 400 })
        }
        console.log(`[Server] WS upgrade /sdk/ session=${sessionId}`)
        const upgraded = server.upgrade(req, {
          data: {
            sessionId,
            connectedAt: Date.now(),
            channel: 'sdk',
            sdkToken: url.searchParams.get('token'),
            serverPort: port,
            serverHost: localConnectHost,
          },
        })
        if (upgraded) return undefined
        console.error(`[Server] SDK WS upgrade failed for session=${sessionId}`)
        return new Response('WebSocket upgrade failed', { status: 400 })
      }

      if (url.pathname === '/callback') {
        console.log(`[Server] OAuth callback`)
        return handleHahaOAuthCallback(url)
      }

      // REST API
      if (url.pathname.startsWith('/api/')) {
        // Enforce authentication when required
        if (authRequired) {
          const authError = requireAuth(req)
          if (authError) {
            console.warn(`[Server] API auth rejected: ${req.method} ${url.pathname}`)
            const headers = new Headers(authError.headers)
            for (const [key, value] of Object.entries(corsHeaders(origin))) {
              headers.set(key, value)
            }
            return new Response(authError.body, { status: authError.status, headers })
          }
        }

        try {
          const response = await handleApiRequest(req, url)
          const elapsed = Date.now() - startTime
          console.log(`[Server] ${req.method} ${url.pathname} -> ${response.status} (${elapsed}ms)`)
          // Add CORS headers to all responses
          const headers = new Headers(response.headers)
          for (const [key, value] of Object.entries(corsHeaders(origin))) {
            headers.set(key, value)
          }
          return new Response(response.body, {
            status: response.status,
            headers,
          })
        } catch (error) {
          const elapsed = Date.now() - startTime
          console.error(`[Server] ${req.method} ${url.pathname} -> ERROR (${elapsed}ms):`, error)
          return Response.json(
            { error: 'Internal server error' },
            { status: 500, headers: corsHeaders() }
          )
        }
      }

      // Proxy — protocol-translating reverse proxy for OpenAI-compatible APIs
      if (url.pathname.startsWith('/proxy/')) {
        if (authRequired) {
          const authError = requireAuth(req)
          if (authError) {
            console.warn(`[Server] Proxy auth rejected: ${url.pathname}`)
            const headers = new Headers(authError.headers)
            for (const [key, value] of Object.entries(corsHeaders(origin))) {
              headers.set(key, value)
            }
            return new Response(authError.body, { status: authError.status, headers })
          }
        }
        console.log(`[Server] Proxy ${req.method} ${url.pathname}`)
        try {
          const response = await handleProxyRequest(req, url)
          const elapsed = Date.now() - startTime
          console.log(`[Server] Proxy ${url.pathname} -> ${response.status} (${elapsed}ms)`)
          const headers = new Headers(response.headers)
          for (const [key, value] of Object.entries(corsHeaders(origin))) {
            headers.set(key, value)
          }
          return new Response(response.body, {
            status: response.status,
            headers,
          })
        } catch (error) {
          const elapsed = Date.now() - startTime
          console.error(`[Server] Proxy ${url.pathname} -> ERROR (${elapsed}ms):`, error)
          return Response.json(
            { type: 'error', error: { type: 'api_error', message: 'Internal proxy error' } },
            { status: 500, headers: corsHeaders() },
          )
        }
      }

      // Health check
      if (url.pathname === '/health') {
        return Response.json(
          { status: 'ok', timestamp: new Date().toISOString() },
          { headers: corsHeaders(origin) },
        )
      }

      console.warn(`[Server] 404 Not Found: ${req.method} ${url.pathname}`)
      return new Response('Not Found', { status: 404 })
    },

    websocket: handleWebSocket,
  })

  // Start watching ~/.claude/teams/ for real-time WebSocket push
  teamWatcher.start()

  // Start the cron scheduler to execute scheduled tasks
  cronScheduler.start()

  void ensureDesktopCliLauncherInstalled().catch((error) => {
    console.error(
      '[desktop-cli-launcher] failed to install bundled launcher:',
      error instanceof Error ? error.message : error,
    )
  })

  console.log(`[Server] ──────────────────────────────────────────────`)
  console.log(`[Server] Claude Code API server running at http://${host}:${port}`)
  console.log(`[Server] Base URL: ${process.env.ANTHROPIC_BASE_URL}`)
  console.log(`[Server] Model:    ${process.env.ANTHROPIC_MODEL}`)
  console.log(`[Server] Auth:     ${authRequired ? 'required' : 'off'}`)
  console.log(`[Server] PID:      ${process.pid}`)
  console.log(`[Server] ──────────────────────────────────────────────`)
  return server
}

// ─── Graceful shutdown: kill all CLI subprocesses on exit ────────────────────
import { conversationService } from './services/conversationService.js'

function cleanupAllSessions() {
  const active = conversationService.getActiveSessions()
  if (active.length > 0) {
    console.log(`[Server] Shutting down — killing ${active.length} CLI subprocess(es): ${active.join(', ')}`)
    for (const sessionId of active) {
      conversationService.stopSession(sessionId)
    }
  } else {
    console.log('[Server] Shutting down — no active sessions')
  }
}

process.on('SIGTERM', () => {
  console.log('[Server] Received SIGTERM')
  cleanupAllSessions()
  process.exit(0)
})

process.on('SIGINT', () => {
  console.log('[Server] Received SIGINT')
  cleanupAllSessions()
  process.exit(0)
})

process.on('exit', () => {
  cleanupAllSessions()
})

// Direct execution
if (import.meta.main) {
  startServer()
}
