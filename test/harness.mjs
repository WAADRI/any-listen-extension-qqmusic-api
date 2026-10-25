// 模拟 any-listen 扩展宿主环境，加载 dist/main.js 并对真实 API 做端到端验证。
// 用法：node test/harness.mjs
import { readFileSync } from 'node:fs'

const registered = {}
const commands = {}
const files = {}
const configCallbacks = []
const settings = {
  cookie: '',
  apiBaseUrl: 'https://qqmusic.api.waadri.top',
  autoRefresh: true,
  refreshIntervalHours: '12',
  preferHttpsCdn: true,
}

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
const run = new Function('require', bundle)
run((name) => {
  if (name === 'any-listen') return mockApi
  throw new Error(`unexpected require: ${name}`)
})

const assert = (label, condition, detail) => {
  console.log(`${condition ? 'PASS' : 'FAIL'} - ${label}${condition ? '' : ` :: ${detail ?? ''}`}`)
  if (!condition) process.exitCode = 1
}

await new Promise((resolve) => setTimeout(resolve, 500))

// 1. 搜索（无需登录）
try {
  const result = await registered.musicSearch({ extensionId: 'qqmusic-api', source: 'qq', name: '晴天', artist: '周杰伦', page: 1, limit: 5 })
  assert('musicSearch 返回列表', Array.isArray(result.list) && result.list.length > 0)
  const first = result.list[0]
  assert('musicSearch id 前缀', String(first.id).startsWith('qq:v1:'), JSON.stringify(first.id))
  assert('musicSearch 有 meta.musicId', typeof first.meta?.musicId === 'string' && first.meta.musicId.length > 0)
  assert('musicSearch 音质档位', first.meta?.qualitys && Object.keys(first.meta.qualitys).length > 0, JSON.stringify(first.meta?.qualitys))
  assert('musicSearch 封面 URL', typeof first.meta?.picUrl === 'string' && first.meta.picUrl.includes('y.gtimg.cn'))
  assert('musicSearch total', result.total > 0, String(result.total))
  globalThis.__firstMusic = first
} catch (err) {
  assert('musicSearch', false, err.message)
}

// 2. 热搜 / 联想
try {
  const hot = await registered.hotSearch({ extensionId: 'qqmusic-api', source: 'qq' })
  assert('hotSearch', Array.isArray(hot) && hot.length > 0, JSON.stringify(hot).slice(0, 200))
} catch (err) {
  assert('hotSearch', false, err.message)
}
try {
  const tips = await registered.tipSearch({ extensionId: 'qqmusic-api', source: 'qq', keyword: '周杰伦' })
  assert('tipSearch', Array.isArray(tips) && tips.length > 0, JSON.stringify(tips).slice(0, 200))
} catch (err) {
  assert('tipSearch', false, err.message)
}

// 3. 歌词（无需登录）
try {
  const musicInfo = globalThis.__firstMusic ?? { id: 'qq:v1:0027oMO61wWi55', name: '发如雪', singer: '周杰伦', interval: '04:59', meta: { musicId: '0027oMO61wWi55' } }
  const lyric = await registered.musicLyric({ extensionId: 'qqmusic-api', source: 'qq', musicInfo })
  assert('musicLyric LRC', typeof lyric.lyric === 'string' && lyric.lyric.includes('[00:'), lyric.lyric?.slice(0, 80))
} catch (err) {
  assert('musicLyric', false, err.message)
}

// 4. 封面
try {
  const musicInfo = globalThis.__firstMusic
  const pic = await registered.musicPic({ extensionId: 'qqmusic-api', source: 'qq', musicInfo })
  assert('musicPic', typeof pic === 'string' && pic.startsWith('https://y.gtimg.cn/'), pic)
} catch (err) {
  assert('musicPic', false, err.message)
}

// 5. 未配置 Cookie 时取链接 → 应抛出“未配置 Cookie”
try {
  await registered.musicUrl({ extensionId: 'qqmusic-api', source: 'qq', musicInfo: globalThis.__firstMusic, quality: '128k' })
  assert('musicUrl 无 Cookie 应报错', false, 'expected throw')
} catch (err) {
  const msg = String(err.message)
  assert('musicUrl 无 Cookie 报错明确', /Cookie|cookie/.test(msg), msg)
}

// 6. 无效 Cookie → 自动续期失败 → 报“Cookie 无效”
try {
  for (const cb of configCallbacks) cb(['cookie'], { ...settings, cookie: 'musicid=123456; musickey=FAKEKEY' })
  await new Promise((resolve) => setTimeout(resolve, 300))
  await registered.musicUrl({ extensionId: 'qqmusic-api', source: 'qq', musicInfo: globalThis.__firstMusic, quality: '128k' })
  assert('musicUrl 无效 Cookie 应报错', false, 'expected throw')
} catch (err) {
  const msg = String(err.message)
  assert('musicUrl 无效 Cookie 报错明确', /无效|过期|invalid|expired/i.test(msg), msg)
}

// 7. 命令已注册
assert('命令已注册', Object.keys(commands).length === 3, Object.keys(commands).join(','))

console.log('\n=== settings cookie 现值（前 80 字符）===', settings.cookie.slice(0, 80))
process.exit(process.exitCode ?? 0)
