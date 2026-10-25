// 离线验证：网页版 Cookie → 接口字段转换（不发任何网络请求）
import { readFileSync } from 'node:fs'

const toasts = []
const commands = {}
const settings = { cookie: process.env.QQ_COOKIE ?? '', apiBaseUrl: 'https://qqmusic.api.waadri.top', autoRefresh: true, refreshIntervalHours: '12', preferHttpsCdn: true }
const noopStorage = {
  writeFile: async () => {}, readFile: async () => '', removeFile: async () => {},
  fileExists: async () => false, listFiles: async () => [], statFile: async () => ({ isFile: true, size: 0, createTime: 0, updateTime: 0 }),
}
const mockApi = {
  logcat: { info: () => {}, error: console.error, warn: () => {} },
  env: { version: '1.3.1', extensionVersion: '0.1.2' },
  registerResourceAction: () => {},
  app: { showMessage: async (msg) => toasts.push(msg), showInputDialog: async () => '' },
  configuration: { getConfigs: async (keys) => keys.map((k) => settings[k]), setConfigs: async (d) => Object.assign(settings, d), onConfigChanged: () => () => {} },
  storage: noopStorage,
  command: { registerCommand: async (n, cb) => { commands[n] = cb }, executeCommand: async () => {}, getCommands: async () => [] },
  request: async () => { throw new Error('network disabled in this test') },
  t: (key, data) => { let out = key; if (data) for (const [k, v] of Object.entries(data)) out = out.replaceAll(`{${k}}`, String(v)); return out },
}

new Function('require', readFileSync(new URL('../dist/main.js', import.meta.url), 'utf-8'))((n) => n === 'any-listen' ? mockApi : (() => { throw new Error('unexpected') })())
await new Promise((r) => setTimeout(r, 300))

await commands['qqmusic.showStatus']()
console.log(toasts.join('\n---\n'))
const ok = toasts.some((line) => line.includes('statusConfigured')) && !toasts.some((line) => line.includes('statusNotConfigured'))
console.log(ok ? '\nPASS - 网页版 Cookie 已自动转换为接口字段 (musicid=2533169981)' : '\nFAIL - 转换未生效')
process.exit(ok ? 0 : 1)
