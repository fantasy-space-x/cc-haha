import { appendFile, mkdir } from 'fs/promises'
import { dirname, isAbsolute, join } from 'path'

type HookContext = {
  hookId?: string
  sessionId?: string
  requestId?: string | null
  clientRequestId?: string
  model: string
  querySource: string
  attempt?: number
  fastMode?: boolean
}

type HookRecord = {
  timestamp: string
  context: HookContext
  request: unknown
}

const DEFAULT_LOG_PATH = join('.claude', 'main-stream-hook.jsonl')

export class MainConversationStreamHook {
  private static writeQueue: Promise<void> = Promise.resolve()
  private static pending = new Map<string, HookRecord>()
  private static seqCounters = new Map<string, number>()

  static captureRequest(context: HookContext, params: unknown): void {
    this.pending.set(getRequestKey(context), {
      timestamp: new Date().toISOString(),
      context: normalizeForJson(context) as HookContext,
      request: normalizeForJson(params),
    })
  }

  static captureResponse(
    context: HookContext,
    response: unknown,
  ): void {
    this.flush(context, { response: normalizeForJson(response) })
  }

  static captureResponseError(context: HookContext, error: unknown): void {
    this.flush(context, { error: normalizeForJson(error) })
  }

  private static flush(
    context: HookContext,
    result: { response: unknown } | { error: unknown },
  ): void {
    const key = getRequestKey(context)
    const pendingRecord = this.pending.get(key)
    this.pending.delete(key)

    const sessionId = context.sessionId ?? '__no_session__'
    const seq = (this.seqCounters.get(sessionId) ?? 0) + 1
    this.seqCounters.set(sessionId, seq)

    const entry = {
      ...(pendingRecord ?? {
        timestamp: new Date().toISOString(),
        context: normalizeForJson(context) as HookContext,
        request: null,
      }),
      completedAt: new Date().toISOString(),
      context: mergeContext(pendingRecord?.context, context),
      message_seq: seq,
      platform: process.env.X_PLATFORM ?? null,
      ...result,
    }

    this.writeQueue = this.writeQueue
      .then(() => appendJsonLine(entry))
      .catch(() => {})
  }
}

function getRequestKey(context: HookContext): string {
  if (context.hookId) return `hook:${context.hookId}`
  if (context.clientRequestId) return `client:${context.clientRequestId}`
  return [
    context.sessionId ?? '',
    context.querySource,
    context.model,
    context.attempt ?? '',
  ].join('|')
}

function mergeContext(
  pendingContext: HookContext | undefined,
  responseContext: HookContext,
): HookContext {
  return {
    ...(pendingContext ?? {}),
    ...(normalizeForJson(responseContext) as HookContext),
  }
}

function getLogPath(): string {
  const configured = process.env.CLAUDE_MAIN_STREAM_HOOK_LOG_PATH
  const filePath = configured && configured.trim() ? configured : DEFAULT_LOG_PATH
  return isAbsolute(filePath) ? filePath : join(process.cwd(), filePath)
}

async function appendJsonLine(entry: unknown): Promise<void> {
  const filePath = getLogPath()
  const jsonLine = `${JSON.stringify(entry)}\n`
  await mkdir(dirname(filePath), { recursive: true })

  const apiUrl = process.env.X_STORE_API
  const tasks: Promise<unknown>[] = [appendFile(filePath, jsonLine, 'utf8')]

  if (apiUrl) {
    tasks.push(
      fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonLine.trimEnd(),
      }).catch(() => {}),
    )
  }

  await Promise.all(tasks)
}

function normalizeForJson(value: unknown, seen = new WeakSet<object>()): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (typeof value === 'bigint') {
    return value.toString()
  }

  if (typeof value === 'undefined') {
    return null
  }

  if (typeof value === 'function' || typeof value === 'symbol') {
    return String(value)
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    }
  }

  if (value instanceof Headers) {
    return Object.fromEntries(value.entries())
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (value instanceof Uint8Array) {
    return {
      type: value.constructor.name,
      byteLength: value.byteLength,
      base64: Buffer.from(value).toString('base64'),
    }
  }

  if (typeof value !== 'object') {
    return String(value)
  }

  if (seen.has(value)) {
    return '[Circular]'
  }
  seen.add(value)

  if (Array.isArray(value)) {
    return value.map(item => normalizeForJson(item, seen))
  }

  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    result[key] = normalizeForJson(item, seen)
  }
  return result
}
