import { apiGet, ApiError, isAuthError, setApiBaseUrl } from './shared/api'
import {
  ensureCredential,
  getLastCheckAt,
  getLastRefreshAt,
  getMusicId,
  hasCredential,
  initCredentialState,
  isCredentialInvalidError,
  isCredentialMissingError,
  refreshCredential,
} from './shared/credential'
import { app, command, console, configuration, registerResourceAction, request, t } from './shared/hostApi'
import { buildMusicInfo, buildPicUrl, getRawMusicId, type QqSongItem } from './shared/musicInfo'
import { fileTypeToQuality, getFileTypeChain } from './shared/quality'

const CONFIG_COOKIE = 'cookie'
const CONFIG_API_BASE_URL = 'apiBaseUrl'
const CONFIG_AUTO_REFRESH = 'autoRefresh'
const CONFIG_REFRESH_INTERVAL = 'refreshIntervalHours'
const CONFIG_PREFER_HTTPS = 'preferHttpsCdn'

let autoRefresh = true
let refreshIntervalHours = 12
let preferHttpsCdn = true

// ============ 错误提示 toast（限频，避免连续播放失败时刷屏） ============

let lastErrorNotifyAt = 0
const ERROR_NOTIFY_INTERVAL = 5000

const showErrorToast = (message: string) => {
  const now = Date.now()
  if (now - lastErrorNotifyAt < ERROR_NOTIFY_INTERVAL) return
  lastErrorNotifyAt = now
  try {
    const p = app?.showMessage?.(message, { type: 'error' })
    if (p && typeof (p as Promise<unknown>).catch === 'function') void (p as Promise<unknown>).catch(() => {})
  } catch (err) {
    console.error('[qqmusic] failed to show toast:', err)
  }
}

// ============ CDN 域名 ============

let cdnCache: { sips: string[]; at: number } | undefined

const FALLBACK_CDN_BASE = 'https://isure.stream.qqmusic.qq.com/'

// 播放链接的 purl 是相对路径，需要与 /song/get_cdn_dispatch 返回的 CDN 域名（sip）拼接。
const getSips = async (): Promise<string[]> => {
  if (cdnCache && Date.now() - cdnCache.at < 30 * 60 * 1000) return cdnCache.sips
  try {
    const data = await apiGet<{ sip?: string[] }>('/song/get_cdn_dispatch', undefined, { noCookie: true })
    const sips = (data.sip || []).filter(Boolean)
    if (sips.length) {
      cdnCache = { sips, at: Date.now() }
      return sips
    }
  } catch (err) {
    console.warn('[qqmusic] cdn dispatch failed, fallback to isure:', err)
  }
  cdnCache = { sips: [FALLBACK_CDN_BASE], at: Date.now() }
  return cdnCache.sips
}

const IP_HOST_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/

const hostOf = (base: string): string => {
  const noProtocol = base.replace(/^https?:\/\//, '')
  return noProtocol.split('/')[0]
}

// 生成按优先级排序的 CDN 基址候选：
// - 开启 HTTPS 优先时：域名节点升级 https 在前，公共 isure 域名兜底，IP 节点（证书不匹配只能 http）最后
// - 关闭时按调度顺序原样使用
const buildCdnCandidates = (sips: string[]): string[] => {
  const normalize = (base: string) => (base.endsWith('/') ? base : `${base}/`)
  const candidates: string[] = []
  const domains = sips.filter((base) => !IP_HOST_PATTERN.test(hostOf(base)))
  const ips = sips.filter((base) => IP_HOST_PATTERN.test(hostOf(base)))
  if (preferHttpsCdn) {
    for (const base of domains) candidates.push(normalize(base.replace(/^http:/, 'https:')))
    candidates.push(FALLBACK_CDN_BASE)
    for (const base of ips) candidates.push(normalize(base))
  } else {
    for (const base of sips) candidates.push(normalize(base))
  }
  return Array.from(new Set(candidates))
}

// 用 HEAD 探测候选 CDN，返回第一个可访问的完整 URL；全部失败时返回首个域名候选（交给播放器兜底）
const buildPlayableUrl = async (purl: string): Promise<string> => {
  const candidates = buildCdnCandidates(await getSips())
  let firstCandidate = ''
  for (const base of candidates) {
    const url = base + purl
    if (!firstCandidate) firstCandidate = url
    try {
      const resp = (await request(url, { method: 'HEAD', timeout: 5000 })) as { statusCode?: number }
      if (resp.statusCode && resp.statusCode < 400) return url
    } catch {
      // 尝试下一个候选
    }
  }
  return firstCandidate || FALLBACK_CDN_BASE + purl
}

// ============ 资源实现：搜索 ============

interface SearchResponse {
  total_num?: number
  nextpage?: number
  perpage?: number
  song?: QqSongItem[]
}

const musicSearch = async (params: {
  source: string
  name: string
  artist?: string
  albumName?: string
  page?: number
  limit?: number
}) => {
  const page = params.page || 1
  const limit = Math.min(Math.max(params.limit || 30, 1), 50)
  const keyword = params.artist ? `${params.name} ${params.artist}` : params.name

  let data: SearchResponse
  try {
    data = await apiGet<SearchResponse>('/search/search_by_type', {
      keyword,
      search_type: 0,
      num: limit,
      page,
      highlight: false,
    })
  } catch (err) {
    if (!(err instanceof ApiError)) throw err
    showErrorToast(t('qqmusic.searchFailed', { message: err.message }))
    throw err
  }

  const list = (Array.isArray(data.song) ? data.song : []).map((item) => buildMusicInfo(item))
  return {
    list,
    total: data.total_num ?? list.length,
    page,
    limit,
  }
}

// ============ 资源实现：播放链接 ============

interface SongUrlResponse {
  expiration?: number
  data?: Array<{
    mid?: string
    purl?: string
    vkey?: string
    result?: number
  }>
}

const RESULT_NO_PERMISSION = 104003

const requestSongUrl = async (mid: string, mediaMid: string | null, songType: number, fileType: number): Promise<string | null> => {
  const data = await apiGet<SongUrlResponse>(`/song/${encodeURIComponent(mid)}/url`, {
    file_type: fileType,
    ...(mediaMid ? { media_mid: mediaMid } : {}),
    ...(songType != null ? { song_type: songType } : {}),
  })
  const item = data.data && data.data[0]
  if (!item) return null
  if (item.result !== 0 || !item.purl) {
    if (item.result === RESULT_NO_PERMISSION) console.log(`[qqmusic] no permission file_type=${fileType} mid=${mid}`)
    return null
  }
  return item.purl
}

const musicUrl = async (params: {
  source: string
  musicInfo: Record<string, unknown>
  quality?: string
}) => {
  const musicInfo = params.musicInfo
  const meta = musicInfo.meta as Record<string, unknown> | undefined
  const mid = getRawMusicId(musicInfo)
  const mediaMid = typeof meta?._mediaMid === 'string' ? meta._mediaMid : null
  const songType = typeof meta?._songType === 'number' ? meta._songType : 1

  // 播放前做节流的登录态检查（过期自动续期）；未配置 Cookie 直接报错
  await ensureCredential()

  const tryChain = async (): Promise<{ url: string; quality: string } | null> => {
    const chain = getFileTypeChain(params.quality)
    for (const fileType of chain) {
      try {
        const purl = await requestSongUrl(mid, mediaMid, songType, fileType)
        if (purl) {
          const url = await buildPlayableUrl(purl)
          return { url, quality: fileTypeToQuality(fileType) }
        }
      } catch (err) {
        if (isAuthError(err)) throw err // 鉴权无效，向上触发强制续期
        console.warn(`[qqmusic] url request failed file_type=${fileType}:`, err)
      }
    }
    return null
  }

  let result: { url: string; quality: string } | null = null
  try {
    result = await tryChain()
  } catch (err) {
    if (isAuthError(err)) {
      // Cookie 失效：强制续期一次后整体重试
      try {
        await refreshCredential()
      } catch (refreshErr) {
        if (isAuthError(refreshErr)) throw new Error(t('qqmusic.cookieInvalid'))
        throw refreshErr
      }
      result = await tryChain()
    } else {
      throw err
    }
  }

  if (result) return result

  const reason = hasCredential() ? t('qqmusic.noPermission') : t('qqmusic.cookieMissing')
  showErrorToast(t('qqmusic.urlUnavailable', { reason }))
  throw new Error(`[qq] No URL available for ${mid}: ${reason}`)
}

// ============ 资源实现：封面 / 歌词 ============

const musicPic = async (params: { source: string; musicInfo: Record<string, unknown> }) => {
  const meta = params.musicInfo.meta as Record<string, unknown> | undefined
  const picUrl = buildPicUrl(
    typeof meta?._pmid === 'string' ? meta._pmid : undefined,
    typeof meta?._albumMid === 'string' ? meta._albumMid : undefined
  )
  if (!picUrl) throw new Error(t('qqmusic.picNotFound'))
  return picUrl
}

interface LyricResponse {
  songid?: number
  lyric?: string
  trans?: string
  roma?: string
  qrc_t?: number
}

const musicLyric = async (params: { source: string; musicInfo: Record<string, unknown> }) => {
  const mid = getRawMusicId(params.musicInfo)
  // 两个请求并行：默认 LRC + 翻译/罗马音；qrc=true 返回逐字歌词（QRC XML）
  const [lrcResult, qrcResult] = await Promise.allSettled([
    apiGet<LyricResponse>(`/song/${encodeURIComponent(mid)}/lyric`, { trans: true, roma: true }),
    apiGet<LyricResponse>(`/song/${encodeURIComponent(mid)}/lyric`, { qrc: true }),
  ])

  const lrcData = lrcResult.status === 'fulfilled' ? lrcResult.value : undefined
  const qrcData = qrcResult.status === 'fulfilled' ? qrcResult.value : undefined

  const lyric = (lrcData?.lyric || '').trim()
  const tlyric = (lrcData?.trans || '').trim() || null
  const rlyric = (lrcData?.roma || '').trim() || null
  const awlyric = qrcData && qrcData.qrc_t !== 0 ? (qrcData.lyric || '').trim() || null : null

  if (!lyric && !awlyric) {
    if (lrcResult.status === 'rejected') throw lrcResult.reason
    throw new Error(t('qqmusic.lyricNotFound'))
  }

  return {
    lyric: lyric || (awlyric as string),
    tlyric,
    rlyric,
    awlyric,
    name: String(params.musicInfo.name || ''),
    singer: String(params.musicInfo.singer || ''),
    interval: (params.musicInfo.interval as string) || null,
  }
}

// ============ 资源实现：热搜 / 联想 ============

const hotSearch = async () => {
  const data = await apiGet<{ vec_hotkey?: Array<{ query?: string }> }>('/search/get_hotkey', undefined, { noCookie: true })
  const list = (data.vec_hotkey || [])
    .map((item) => String(item.query || '').trim())
    .filter(Boolean)
  return Array.from(new Set(list)).slice(0, 20)
}

const tipSearch = async (params: { keyword: string }) => {
  try {
    const data = await apiGet<{ items?: Array<{ hint?: string }> }>(
      '/search/complete',
      { keyword: params.keyword },
      { noCookie: true }
    )
    const list = (data.items || [])
      .map((item) => String(item.hint || '').trim())
      .filter(Boolean)
    if (list.length) return Array.from(new Set(list)).slice(0, 10)
  } catch (err) {
    console.warn('[qqmusic] complete failed, fallback to hotkey:', err)
  }
  return hotSearch()
}

// 与宿主的精确类型在类型层面刻意宽松（meta 为不透明口袋），注册边界统一收口
registerResourceAction({
  musicSearch,
  musicUrl,
  musicPic,
  musicLyric,
  hotSearch,
  tipSearch,
} as never)

// ============ 自动续期定时器 ============

let renewalTimer: ReturnType<typeof setTimeout> | undefined
let lastRenewalErrorToastAt = 0

const scheduleRenewalTimer = () => {
  if (renewalTimer) {
    clearTimeout(renewalTimer)
    renewalTimer = undefined
  }
  if (!autoRefresh) return
  const intervalMs = refreshIntervalHours * 60 * 60 * 1000
  const run = async () => {
    renewalTimer = undefined
    try {
      if (hasCredential()) {
        const result = await ensureCredential({ force: true })
        if (result.refreshed) {
          console.log('[qqmusic] credential auto refreshed')
        }
      }
    } catch (err) {
      const now = Date.now()
      if (now - lastRenewalErrorToastAt > 30 * 60 * 1000) {
        lastRenewalErrorToastAt = now
        if (isCredentialInvalidError(err)) showErrorToast(err.message)
        else console.error('[qqmusic] auto renewal failed:', err)
      }
    } finally {
      scheduleRenewalTimer()
    }
  }
  renewalTimer = setTimeout(() => void run(), intervalMs)
}

// ============ 命令 ============

const formatTime = (timestamp: number): string => {
  if (!timestamp) return t('qqmusic.statusNever')
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

void (async () => {
  try {
    await command.registerCommand('qqmusic.checkCredential', async () => {
      try {
        const result = await ensureCredential({ force: true })
        await app.showMessage(
          result.refreshed
            ? t('qqmusic.credentialRefreshed', { musicid: getMusicId() })
            : t('qqmusic.credentialOk', { musicid: getMusicId() }),
          { type: 'info' }
        )
      } catch (err) {
        const message = isCredentialInvalidError(err) || isCredentialMissingError(err) ? (err as Error).message : (err as Error)?.message || String(err)
        await app.showMessage(t('qqmusic.credentialCheckFailed', { message }), { type: 'error' })
      }
      return undefined
    })

    await command.registerCommand('qqmusic.showStatus', async () => {
      const lines: string[] = []
      lines.push(hasCredential() ? t('qqmusic.statusConfigured', { musicid: getMusicId() }) : t('qqmusic.statusNotConfigured'))
      lines.push(t('qqmusic.statusLastCheck', { time: formatTime(getLastCheckAt()) }))
      lines.push(t('qqmusic.statusLastRefresh', { time: formatTime(getLastRefreshAt()) }))
      lines.push(
        t('qqmusic.statusAuto', {
          state: autoRefresh ? t('qqmusic.statusOn') : t('qqmusic.statusOff'),
          interval: `${refreshIntervalHours}h`,
        })
      )
      await app.showMessage(lines.join('\n'), { type: 'info' })
      return undefined
    })

    await command.registerCommand('qqmusic.setCookie', async () => {
      const value = await app.showInputDialog({
        title: t('qqmusic.setCookieTitle'),
        prompt: t('qqmusic.setCookiePrompt'),
      })
      if (value && value.trim()) {
        await configuration.setConfigs({ [CONFIG_COOKIE]: value.trim() })
        await app.showMessage(t('qqmusic.cookieSaved'), { type: 'info' })
        try {
          const result = await ensureCredential({ force: true })
          await app.showMessage(
            result.refreshed
              ? t('qqmusic.credentialRefreshed', { musicid: getMusicId() })
              : t('qqmusic.credentialOk', { musicid: getMusicId() }),
            { type: 'info' }
          )
        } catch (err) {
          await app.showMessage(t('qqmusic.credentialCheckFailed', { message: (err as Error)?.message || String(err) }), { type: 'error' })
        }
      }
      return undefined
    })
  } catch (err) {
    console.error('[qqmusic] failed to register commands:', err)
  }
})()

// ============ 配置初始化与变更监听 ============

const applyConfigs = async (config: Record<string, unknown>) => {
  const cookie = config[CONFIG_COOKIE]
  const baseUrl = config[CONFIG_API_BASE_URL]
  autoRefresh = config[CONFIG_AUTO_REFRESH] !== false
  preferHttpsCdn = config[CONFIG_PREFER_HTTPS] !== false
  const intervalRaw = String(config[CONFIG_REFRESH_INTERVAL] ?? '12')
  refreshIntervalHours = Math.min(Math.max(parseInt(intervalRaw, 10) || 12, 1), 24 * 7)

  if (typeof baseUrl === 'string' && baseUrl.trim()) setApiBaseUrl(baseUrl)
  await initCredentialState(cookie)
  scheduleRenewalTimer()
}

const configReady = configuration
  .getConfigs<[string | undefined, string | undefined, boolean | undefined, string | undefined, boolean | undefined]>([
    CONFIG_COOKIE,
    CONFIG_API_BASE_URL,
    CONFIG_AUTO_REFRESH,
    CONFIG_REFRESH_INTERVAL,
    CONFIG_PREFER_HTTPS,
  ])
  .then(([cookie, baseUrl, auto, interval, preferHttps]) =>
    applyConfigs({
      [CONFIG_COOKIE]: cookie ?? '',
      [CONFIG_API_BASE_URL]: baseUrl ?? '',
      [CONFIG_AUTO_REFRESH]: auto,
      [CONFIG_REFRESH_INTERVAL]: interval,
      [CONFIG_PREFER_HTTPS]: preferHttps,
    })
  )
  .catch((err: unknown) => {
    console.error('[qqmusic] failed to load configs:', err)
  })

configuration?.onConfigChanged?.((keys: string[], config: Record<string, unknown>) => {
  void configReady.then(() => applyConfigs(config)).catch((err: unknown) => {
    console.error('[qqmusic] failed to apply config change:', err)
  })
})

// 启动后做一次静默检查（带节流，不影响启动速度）
void configReady
  .then(() => ensureCredential().catch((err: unknown) => {
    if (isCredentialInvalidError(err)) showErrorToast(err.message)
    else console.warn('[qqmusic] startup credential check failed:', err)
  }))
  .catch(() => {})
