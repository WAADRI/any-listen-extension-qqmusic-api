// 过期 Cookie 全流程测试：验证 自动检测过期 → 自动续期 → 取播放链接 的完整链路。
// 用法：QQ_COOKIE='...' node test/renewal-flow.mjs
import { readFileSync } from 'node:fs'

const cookie = process.env.QQ_COOKIE
if (!cookie) {
  console.error('missing QQ_COOKIE env')
  process.exit(1)
}

const registered = {}
const commands = {}
const files = {}
const configCallbacks = []
const settings = {
  cookie,
  apiBaseUrl: 'https://qqmusic.api.waadri.top',
  autoRefresh: true,
  refreshIntervalHours: '12',
  preferHttpsCdn: true,
}

const mask = (value) => (value ? `${value.slice(0, 24)}…(${value.length} chars)` : '(empty)')

const mockApi = {
  logcat: {
    info: (...args) => console.log('[ext-log]', ...args),
    error: (...args) => console.error('[ext-err]', ...args),
    warn: (...args) => console.warn('[ext-warn]', ...args),
  },
  env: { version: '1.3.1', extensionVersion: '0.1.0', platform: 'test', locale: 'zh-cn' },
  registerResourceAction: (actions) => Object.assign(registered, actions),
  app: {
    showMessage: async (message, options) => console.log(`[toast:${options?.type ?? 'info'}]`, message),
    showInputDialog: async () => '',
  },
  configuration: {
    getConfigs: async (keys) => keys.map((key) => settings[key]),
    setConfigs: async (data) => Object.assign(settings, data),
    onConfigChanged: (cb) => {
      configCallbacks.push(cb)
      return () => {}
    },
  },
  storage: {
    writeFile: async (path, content) => {
      files[path] = content
    },
    readFile: async (path, encoding) => (encoding === 'utf-8' ? files[path] : new TextEncoder().encode(files[path] ?? '')),
    removeFile: async (path) => delete files[path],
    fileExists: async (path) => path in files,
    listFiles: async () => Object.keys(files),
    statFile: async () => ({ isFile: true, size: 0, createTime: 0, updateTime: 0 }),
  },
  command: {
    registerCommand: async (name, cb) => {
      commands[name] = cb
      return () => {}
    },
    executeCommand: async () => undefined,
    getCommands: async () => Object.keys(commands),
  },
  request: async (url, options = {}) => {
    const resp = await fetch(url, {
      method: options.method ?? 'GET',
      headers: options.headers,
      signal: AbortSignal.timeout(options.timeout ?? 15000),
    })
    return { statusCode: resp.status, body: await resp.text(), headers: Object.fromEntries(resp.headers) }
  },
  t: (key, data) => {
    let out = key
    if (data) for (const [k, v] of Object.entries(data)) out = out.replaceAll(`{${k}}`, String(v))
    return out
  },
}

const bundle = readFileSync(new URL('../dist/main.js', import.meta.url), 'utf-8')
new Function('require', bundle)((name) => {
  if (name === 'any-listen') return mockApi
  throw new Error(`unexpected require: ${name}`)
})

const assert = (label, condition, detail) => {
  console.log(`${condition ? 'PASS' : 'FAIL'} - ${label}${condition ? '' : ` :: ${detail ?? ''}`}`)
  if (!condition) process.exitCode = 1
}

await new Promise((resolve) => setTimeout(resolve, 500))

const initialMusickey = settings.cookie.match(/musickey=([^;]+)/)?.[1] ?? ''
console.log('=== 初始 Cookie musickey ===', mask(initialMusickey))

// 1. 搜索拿一首歌
const search = await registered.musicSearch({ extensionId: 'x', source: 'qq', name: '晴天', artist: '周杰伦', page: 1, limit: 3 })
assert('搜索可用', search.list.length > 0)
const target = search.list[0]
console.log('目标歌曲:', target.name, '-', target.singer, 'id=', target.id)

// 2. 取播放链接（应触发: 检查过期 → 自动续期 → 拿到真实 URL）
let urlResult
try {
  urlResult = await registered.musicUrl({ extensionId: 'x', source: 'qq', musicInfo: target, quality: '128k' })
  assert('musicUrl 返回链接', typeof urlResult.url === 'string' && urlResult.url.length > 10, JSON.stringify(urlResult))
  console.log('播放链接:', urlResult.url.slice(0, 100) + '…')
  console.log('实际音质:', urlResult.quality)
} catch (err) {
  assert('musicUrl 返回链接', false, err.message)
}

// 3. 续期后 Cookie 是否写回设置
const newMusickey = settings.cookie.match(/musickey=([^;]+)/)?.[1]
console.log('=== 续期后 Cookie musickey ===', mask(newMusickey))
assert('Cookie 已更新写回设置', typeof newMusickey === 'string' && newMusickey.length > 50 && newMusickey !== initialMusickey)
assert('新 Cookie 保留 refresh_token 字段', /refresh_token=[^;]+/.test(settings.cookie))

// 4. 用返回的链接做 HEAD 验证可访问性
if (urlResult?.url) {
  try {
    const resp = await fetch(urlResult.url, { method: 'HEAD', signal: AbortSignal.timeout(15000) })
    console.log('链接 HEAD 状态:', resp.status, 'Content-Type:', resp.headers.get('content-type'), '大小:', resp.headers.get('content-length'))
    assert('播放链接可访问', resp.ok, `status ${resp.status}`)
  } catch (err) {
    assert('播放链接可访问', false, err.message)
  }
}

process.exit(process.exitCode ?? 0)
