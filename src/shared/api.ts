import { request as apiRequest, console, t } from './hostApi'

// API 返回统一包装：{ code: 0成功/-1失败, msg, data }
interface ApiEnvelope<T = unknown> {
  code: number
  msg: string
  data: T | null
}

export class ApiError extends Error {
  code?: number
  statusCode?: number

  constructor(message: string, opts: { code?: number; statusCode?: number } = {}) {
    super(message)
    this.name = 'ApiError'
    this.code = opts.code
    this.statusCode = opts.statusCode
  }
}

export const isApiError = (err: unknown, code?: number): err is ApiError => {
  return err instanceof ApiError && (code == null || err.code === code)
}

// 鉴权类失败：业务码 -1 或 HTTP 401（该 API 两种形态都会出现）
export const isAuthError = (err: unknown): err is ApiError => {
  return err instanceof ApiError && (err.code === -1 || err.statusCode === 401)
}

type QueryValue = string | number | boolean | null | undefined

let baseUrl = 'https://qqmusic.api.waadri.top'
let getCookieHeader: () => string | null = () => null

export const setApiBaseUrl = (url: string) => {
  const trimmed = url.trim().replace(/\/+$/, '')
  baseUrl = trimmed || 'https://qqmusic.api.waadri.top'
}

export const getApiBaseUrl = () => baseUrl

// cookie 头由 credential 模块注入，避免 api ↔ credential 循环依赖
export const setCookieHeaderProvider = (provider: () => string | null) => {
  getCookieHeader = provider
}

const buildQuery = (query?: Record<string, QueryValue>) => {
  if (!query) return ''
  const parts: string[] = []
  for (const key of Object.keys(query)) {
    const value = query[key]
    if (value != null) parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
  }
  return parts.length ? `?${parts.join('&')}` : ''
}

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

interface RawResponse {
  statusCode?: number
  body: unknown
}

export const apiGet = async <T = unknown>(
  path: string,
  query?: Record<string, QueryValue>,
  opts: { noCookie?: boolean; timeout?: number } = {}
): Promise<T> => {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: 'application/json',
    Referer: 'https://y.qq.com/',
  }
  if (!opts.noCookie) {
    const cookie = getCookieHeader()
    if (cookie) headers.Cookie = cookie
  }

  let resp: RawResponse
  try {
    resp = (await apiRequest(`${baseUrl}${path}${buildQuery(query)}`, {
      method: 'GET',
      headers,
      timeout: opts.timeout ?? 15000,
    })) as RawResponse
  } catch (err) {
    console.error(`[qqmusic] request failed: GET ${path}`, err)
    throw new ApiError(t('qqmusic.networkError'))
  }

  const statusCode = resp.statusCode ?? 0
  let envelope: ApiEnvelope<T> | undefined
  try {
    envelope = (typeof resp.body === 'string' ? JSON.parse(resp.body) : (resp.body as ApiEnvelope<T>)) as ApiEnvelope<T>
  } catch {
    envelope = undefined
  }

  // 该 API 鉴权失败时可能返回 HTTP 200 + code:-1，也可能直接返回 HTTP 401 + JSON envelope，
  // 统一按业务码处理；仅在完全无法解析时才按 HTTP 状态报错
  if (envelope && typeof envelope.code === 'number') {
    if (envelope.code !== 0) {
      throw new ApiError(envelope.msg || t('qqmusic.apiError', { message: `code ${envelope.code}` }), {
        code: envelope.code,
        statusCode,
      })
    }
    return envelope.data as T
  }

  if (statusCode !== 200) {
    console.error(`[qqmusic] non-200 (${statusCode}) GET ${path}:`, typeof resp.body === 'string' ? resp.body.slice(0, 300) : JSON.stringify(resp.body).slice(0, 300))
    throw new ApiError(t('qqmusic.apiError', { message: `HTTP ${statusCode}` }), { statusCode })
  }
  throw new ApiError(t('qqmusic.apiError', { message: 'invalid JSON response' }))
}
