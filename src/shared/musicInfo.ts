import { buildQualitys } from './quality'

// QQ 音乐搜索结果单项（SongSearch 模型的宽松子集）
export interface QqSongItem {
  id?: number
  mid?: string
  name?: string
  type?: number
  singer?: Array<{ name?: string }>
  album?: { mid?: string; name?: string; pmid?: string }
  file?: {
    media_mid?: string
    size_128mp3?: number
    size_192ogg?: number
    size_192aac?: number
    size_320mp3?: number
    size_flac?: number
    size_dolby?: number
    size_new?: number[]
  }
  interval?: number
  time_public?: string
}

// id 加前缀避免与其他 QQ 音乐扩展的裸 mid 冲突（与 gdstudio 的 gd:v1:{source}:{id} 同思路）
export const SOURCE_ID = 'qq'
export const buildMusicId = (songMid: string) => `qq:v1:${songMid}`

export const getRawMusicId = (musicInfo: Record<string, unknown>): string => {
  const meta = musicInfo.meta as Record<string, unknown> | undefined
  if (typeof meta?.musicId === 'string' && meta.musicId) return meta.musicId
  const id = musicInfo.id
  if (typeof id === 'string') return id.startsWith('qq:v1:') ? id.slice(6) : id
  return id == null ? '' : String(id)
}

// QQ 音乐公开封面规则：y.gtimg.cn 的 photo_new 路径，pmid 缺失时退回专辑 mid
export const buildPicUrl = (pmid: string | undefined, albumMid: string | undefined): string | null => {
  const id = pmid || albumMid
  return id ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${id}.jpg` : null
}

const formatInterval = (seconds: number | undefined): string | null => {
  if (!seconds || seconds <= 0) return null
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const parseSinger = (singers: Array<{ name?: string }> | undefined): string => {
  if (!Array.isArray(singers)) return ''
  return singers
    .map((singer) => String(singer?.name || '').trim())
    .filter(Boolean)
    .join('、')
}

// MusicInfoOnline 的宽松实现（meta 作为不透明口袋读写），注册边界统一 as never 收口
export const buildMusicInfo = (item: QqSongItem): Record<string, unknown> => {
  const now = Date.now()
  const songMid = String(item.mid || item.id || '')
  return {
    id: buildMusicId(songMid),
    name: String(item.name || ''),
    singer: parseSinger(item.singer),
    interval: formatInterval(item.interval),
    isLocal: false,
    meta: {
      musicId: songMid,
      albumName: String(item.album?.name || ''),
      picUrl: buildPicUrl(item.album?.pmid, item.album?.mid),
      source: SOURCE_ID,
      qualitys: buildQualitys(item.file),
      _mediaMid: item.file?.media_mid || null,
      _songType: item.type ?? 1,
      _pmid: item.album?.pmid || null,
      _albumMid: item.album?.mid || null,
      createTime: now,
      updateTime: now,
      posTime: now,
    },
  }
}
