// 在 node:vm 沙箱中按宿主方式加载扩展 bundle，复现 musicLyric 调用
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const registered = {}
const commands = {}
const settings = {
  cookie: process.env.QQ_COOKIE ?? '',
  apiBaseUrl: 'https://qqmusic.api.waadri.top',
  autoRefresh: true,
  refreshIntervalHours: '12',
  preferHttpsCdn: true,
}
const storageFiles = {}
const mockApi = {
  logcat: {
    info: (...a) => console.log('[log]', ...a),
    error: (...a) => console.error('[err]', ...a),
    warn: (...a) => console.warn('[warn]', ...a),
  },
  env: { version: '1.3.1', extensionVersion: '0.1.2' },
  registerResourceAction: (a) => Object.assign(registered, a),
  app: { showMessage: async (m, o) => console.log(`[toast:${o?.type ?? 'info'}]`, m), showInputDialog: async () => '' },
  configuration: {
    getConfigs: async (keys) => keys.map((k) => settings[k]),
    setConfigs: async (d) => Object.assign(settings, d),
    onConfigChanged: () => () => {},
  },
  storage: {
    writeFile: async (p, c) => { storageFiles[p] = c },
    readFile: async (p, e) => (e === 'utf-8' ? storageFiles[p] : new TextEncoder().encode(storageFiles[p] ?? '')),
    removeFile: async (p) => delete storageFiles[p],
    fileExists: async (p) => p in storageFiles,
    listFiles: async () => Object.keys(storageFiles),
    statFile: async () => ({ isFile: true, size: 0, createTime: 0, updateTime: 0 }),
  },
  command: { registerCommand: async (n, cb) => { commands[n] = cb }, executeCommand: async () => {}, getCommands: async () => [] },
  request: async (url, options = {}) => {
    const resp = await fetch(url, { method: options.method ?? 'GET', headers: options.headers, signal: AbortSignal.timeout(options.timeout ?? 15000) })
    return { statusCode: resp.status, body: await resp.text(), headers: Object.fromEntries(resp.headers) }
  },
  t: (key, data) => { let out = key; if (data) for (const [k, v] of Object.entries(data)) out = out.replaceAll(`{${k}}`, String(v)); return out },
}

const bundle = readFileSync(new URL('../dist/main.js', import.meta.url), 'utf-8')

// 关键: codeGeneration.strings=false（宿主同款限制），仅提供宿主式全局
const sandbox = {
  require: (name) => {
    if (name === 'any-listen') return mockApi
    throw new Error(`unexpected require: ${name}`)
  },
  setTimeout, clearTimeout, setInterval, clearInterval,
  console: { log: console.log, error: console.error, warn: console.warn },
}
const ctx = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } })
try {
  vm.runInContext(bundle, ctx, { filename: 'main.js' })
  console.log('bundle loaded OK')
} catch (err) {
  console.log('BUNDLE LOAD FAILED:', err.message)
  process.exit(1)
}

await new Promise((r) => setTimeout(r, 500))

// 搜索后调 musicLyric
const search = await registered.musicSearch({ extensionId: 'x', source: 'qq', name: '晴天', artist: '周杰伦', page: 1, limit: 3 })
const target = search.list[0]
console.log('search ok:', target.name, target.id)

try {
  const lyricInfo = await registered.musicLyric({ extensionId: 'x', source: 'qq', musicInfo: target })
  const hasTimeTag = /\[\d{1,2}:.*\d{1,4}\]/.test(lyricInfo.lyric ?? '')
  console.log('musicLyric OK, lyric len:', (lyricInfo.lyric ?? '').length)
  console.log('lyric 头部:', (lyricInfo.lyric ?? '').slice(0, 80).replace(/\n/g, ' | '))
  console.log('通过宿主 isValidLyric 校验:', hasTimeTag ? 'YES' : 'NO !!!')
  console.log('awlyric(qrc) len:', (lyricInfo.awlyric ?? '').length, '| tlyric len:', (lyricInfo.tlyric ?? '').length)
} catch (err) {
  console.log('musicLyric FAILED:', err && err.stack ? err.stack.split('\n').slice(0, 4).join('\n') : err)
}
process.exit(0)
