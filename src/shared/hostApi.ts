// eslint-disable-next-line @typescript-eslint/no-require-imports
const api = require('any-listen')

export const console = {
  log: api.logcat.info,
  error: api.logcat.error,
  warn: api.logcat.warn,
}

export const registerResourceAction = api.registerResourceAction
export const app = api.app
export const configuration = api.configuration
export const storage = api.storage
export const command = api.command

export const request = api.request!
export const t = api.t as (key: string, data?: Record<string, string | number | null | undefined>) => string
