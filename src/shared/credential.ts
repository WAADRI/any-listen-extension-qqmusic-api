import { apiGet, isAuthError, setCookieHeaderProvider } from './api'
import { console, configuration, storage, t } from './hostApi'

// ============ Cookie 解析 / 序列化 ============

// 保留用户粘贴 Cookie 的全部字段（可能有额外字段），续期时只更新已知凭据字段
export const CREDENTIAL_FIELDS = [
  'musicid',
  'musickey',
  'openid',
  'refresh_token',
  'access_token',
  'expired_at',
  'unionid',
  'str_musicid',
  'refresh_key',
] as const

// /login/refresh_credential 返回的 Credential 结构（同名字段为字符串/数字）
interface CredentialResponse {
  musicid?: number | string
  musickey?: string
  openid?: string
  refresh_token?: string
  access_token?: string
  expired_at?: number
  unionid?: string
  str_musicid?: string
  refresh_key?: string
}

export const parseCookieString = (raw: string): Map<string, string> => {
  const pairs = new Map<string, string>()
  for (const part of raw.split(';')) {
    const segment = part.trim()
    if (!segment) continue
    const eq = segment.indexOf('=')
    if (eq <= 0) continue
    const key = segment.slice(0, eq).trim()
    const value = segment.slice(eq + 1).trim()
    if (key) pairs.set(key, value)
  }
  return pairs
}

// y.qq.com 网页版登录后的 Cookie 使用 psrf_ 前缀等网页版字段名，与接口所需名称不同。
// 解析时按别名推导缺失的凭据字段（已有同名字段时以直接字段为准，别名值为空的跳过）。
const CREDENTIAL_ALIASES: Record<string, string[]> = {
  musicid: ['uin', 'psrf_qqmusicid'],
  musickey: ['qm_keyst', 'qqmusic_key'],
  str_musicid: ['uin', 'psrf_qqmusicid'],
  openid: ['psrf_qqopenid', 'wxopenid'],
  refresh_token: ['psrf_qqrefresh_token', 'wxrefresh_token'],
  access_token: ['psrf_qqaccess_token'],
  unionid: ['psrf_qqunionid', 'wxunionid'],
  expired_at: ['psrf_access_token_expiresAt'],
  refresh_key: ['psrf_qqrefresh_key'],
  encrypt_uin: ['euin'],
  musickey_create_time: ['psrf_musickey_createtime'],
  login_type: ['tmeLoginType'],
}

// uin 可能带 o 前缀（如 o2533169981），推导 musicid 时去掉
const normalizeAliasValue = (field: string, value: string): string => {
  if ((field === 'musicid' || field === 'str_musicid') && value.startsWith('o') && /^\d+$/.test(value.slice(1))) {
    return value.slice(1)
  }
  return value
}

export const deriveCredentialFields = (pairs: Map<string, string>): void => {
  for (const field of Object.keys(CREDENTIAL_ALIASES)) {
    if (pairs.get(field)) continue
    for (const alias of CREDENTIAL_ALIASES[field]) {
      const value = pairs.get(alias)
      if (value) {
        pairs.set(field, normalizeAliasValue(field, value))
        break
      }
    }
  }
}

export const serializeCookie = (pairs: Map<string, string>): string => {
  const parts: string[] = []
  for (const [key, value] of pairs) parts.push(`${key}=${value}`)
  return parts.join('; ')
}

// ============ 凭据状态 ============

const CHECK_THROTTLE_MS = 30 * 60 * 1000 // 30 分钟内不重复检查
const STATE_FILE = 'credential-state.json'

let cookiePairs = new Map<string, string>()
let lastCheckAt = 0
let lastRefreshAt = 0
let serializedCookie = '' // 当前已写回/解析的 Cookie 串，用于检测设置变化避免循环

export const hasCredential = (): boolean => {
  const musicid = cookiePairs.get('musicid')
  const musickey = cookiePairs.get('musickey')
  return !!musicid && !!musickey
}

export const getMusicId = (): string => cookiePairs.get('str_musicid') || cookiePairs.get('musicid') || ''

export const getCookieHeader = (): string | null => {
  if (!hasCredential()) return null
  return serializeCookie(cookiePairs)
}

export const getLastCheckAt = () => lastCheckAt
export const getLastRefreshAt = () => lastRefreshAt

setCookieHeaderProvider(getCookieHeader)

const persistState = async () => {
  try {
    await storage.writeFile(STATE_FILE, JSON.stringify({ lastCheckAt, lastRefreshAt }))
  } catch (err) {
    console.warn('[qqmusic] failed to persist credential state:', err)
  }
}

const restoreState = async () => {
  try {
    if (!(await storage.fileExists(STATE_FILE))) return
    const raw = await storage.readFile(STATE_FILE, 'utf-8')
    const state = JSON.parse(raw) as { lastCheckAt?: number; lastRefreshAt?: number }
    if (typeof state.lastCheckAt === 'number') lastCheckAt = state.lastCheckAt
    if (typeof state.lastRefreshAt === 'number') lastRefreshAt = state.lastRefreshAt
  } catch (err) {
    console.warn('[qqmusic] failed to restore credential state:', err)
  }
}

// 从设置读取 Cookie。仅当设置中的 Cookie 与当前已解析的不同时才重新解析，
// 避免续期写回设置后触发 onConfigChanged 造成循环。
export const applyCookieSetting = (cookieSetting: unknown) => {
  const cookie = typeof cookieSetting === 'string' ? cookieSetting : ''
  if (cookie === serializedCookie) return false
  serializedCookie = cookie
  cookiePairs = parseCookieString(cookie)
  deriveCredentialFields(cookiePairs)
  lastCheckAt = 0
  return true
}

// ============ 过期检查与续期 ============

const checkExpired = async (): Promise<boolean> => {
  const data = await apiGet<{ expired: boolean }>('/login/check_expired')
  return data.expired === true
}

// 调用 /login/refresh_credential 刷新凭据，将返回的新凭据合并进 Cookie 并写回设置
export const refreshCredential = async (): Promise<void> => {
  const data = await apiGet<CredentialResponse>('/login/refresh_credential')

  for (const field of CREDENTIAL_FIELDS) {
    const value = data[field]
    if (value == null || String(value) === '') continue
    cookiePairs.set(field, String(value))
  }
  // refresh 返回的 musicid 是数字，musicid 字段以字符串形式保存
  if (data.str_musicid) cookiePairs.set('str_musicid', data.str_musicid)

  serializedCookie = serializeCookie(cookiePairs)
  lastRefreshAt = Date.now()
  void persistState()

  // 写回设置，让设置界面始终展示当前生效的 Cookie
  try {
    await configuration.setConfigs({ cookie: serializedCookie })
  } catch (err) {
    console.warn('[qqmusic] failed to write refreshed cookie back to settings:', err)
  }
  console.log(`[qqmusic] credential refreshed, musicid=${getMusicId()}`)
}

export class CredentialMissingError extends Error {
  constructor() {
    super(t('qqmusic.cookieMissing'))
  }
}

export class CredentialInvalidError extends Error {
  constructor() {
    super(t('qqmusic.cookieInvalid'))
  }
}

export const isCredentialMissingError = (err: unknown): err is CredentialMissingError => {
  return err instanceof CredentialMissingError
}

export const isCredentialInvalidError = (err: unknown): err is CredentialInvalidError => {
  return err instanceof CredentialInvalidError
}

export interface EnsureCredentialResult {
  refreshed: boolean
}

// 取播放链接前调用：节流检查登录态，过期则自动续期。
// - 检查/续期的网络错误不阻塞播放（凭据可能仍然有效），force 模式下向上抛出
// - 续期遇到“鉴权无效”抛 CredentialInvalidError，提示用户重新粘贴 Cookie
export const ensureCredential = async (opts: { force?: boolean } = {}): Promise<EnsureCredentialResult> => {
  if (!hasCredential()) throw new CredentialMissingError()
  if (!opts.force && Date.now() - lastCheckAt < CHECK_THROTTLE_MS) return { refreshed: false }

  let expired: boolean
  try {
    expired = await checkExpired()
  } catch (err) {
    // 检查失败不记录节流时间戳，下次播放立即重试；网络类错误静默放过不阻塞播放
    if (isAuthError(err)) throw new CredentialInvalidError()
    if (opts.force) throw err
    return { refreshed: false }
  }
  lastCheckAt = Date.now()
  void persistState()

  if (!expired) return { refreshed: false }
  try {
    await refreshCredential()
  } catch (err) {
    // 续期接口返回鉴权无效 → Cookie 彻底失效，提示用户重新粘贴
    if (isAuthError(err)) throw new CredentialInvalidError()
    throw err
  }
  return { refreshed: true }
}

let stateRestored = false

export const initCredentialState = async (cookieSetting: unknown) => {
  applyCookieSetting(cookieSetting)
  // 磁盘状态只在启动时恢复一次；之后更换 Cookie 时保持 lastCheckAt=0 强制重新检查
  if (!stateRestored) {
    stateRestored = true
    await restoreState()
  }
}
