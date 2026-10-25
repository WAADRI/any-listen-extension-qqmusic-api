// any-listen 音质档位 与 QQ 音乐 file_type 的映射。
// file_type 取值来自 https://qqmusic.api.waadri.top/docs 的 /song/{mid}/url 接口：
//   1: 臻品母带  2: 臻品音质(Hi-Res)  5: 杜比全景声  7/8: SQ 无损
//   10: 192k OGG  12: 320k MP3  13: 128k MP3  14: 192k AAC
// 每个音质档位给出从目标档到最低档的降级链，按顺序尝试直到拿到可用链接。
const QUALITY_TO_FILE_TYPE_CHAIN: Record<string, number[]> = {
  master: [1, 2, 7, 12, 10, 13],
  flac24bit: [2, 1, 7, 12, 10, 13],
  flac: [7, 12, 10, 13],
  wav: [7, 12, 10, 13],
  dolby: [5, 1, 2, 7, 12, 10, 13],
  '320k': [12, 10, 13],
  '192k': [10, 14, 13],
  '128k': [13],
}

const DEFAULT_FILE_TYPE_CHAIN = [13, 12, 10, 7]

// file_type → 汇报给宿主的音质档位（实际返回按命中档位汇报）
const FILE_TYPE_TO_QUALITY: Record<number, string> = {
  1: 'master',
  2: 'flac24bit',
  5: 'dolby',
  7: 'flac',
  8: 'flac',
  10: '192k',
  12: '320k',
  13: '128k',
  14: '192k',
}

export const getFileTypeChain = (quality: string | undefined): number[] => {
  if (!quality) return DEFAULT_FILE_TYPE_CHAIN
  return QUALITY_TO_FILE_TYPE_CHAIN[quality] ?? DEFAULT_FILE_TYPE_CHAIN
}

export const fileTypeToQuality = (fileType: number): string => {
  return FILE_TYPE_TO_QUALITY[fileType] ?? '128k'
}

// QQ 音乐搜索结果 file 字段里的各个 size_* 字段 → 是否拥有该音质
// size_new 数组下标（来自文档 Song.file 说明）：0=母带 1=臻品音质 5=SQ 6=全景声 9=DTS
interface SongFile {
  size_128mp3?: number
  size_192ogg?: number
  size_192aac?: number
  size_320mp3?: number
  size_flac?: number
  size_dolby?: number
  size_new?: number[]
}

const formatSize = (bytes: number | undefined): string | null => {
  if (!bytes || bytes <= 0) return null
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

// 依据文件大小字段构建 any-listen 的 qualitys 元信息
export const buildQualitys = (file: SongFile | undefined): Record<string, { sizeStr: string | null }> => {
  const qualitys: Record<string, { sizeStr: string | null }> = {}
  if (!file) return qualitys
  const put = (quality: string, size: number | undefined) => {
    if (size && size > 0) qualitys[quality] = { sizeStr: formatSize(size) }
  }
  put('128k', file.size_128mp3)
  put('192k', file.size_192ogg ?? file.size_192aac)
  put('320k', file.size_320mp3)
  put('flac', file.size_flac ?? file.size_new?.[5])
  put('flac24bit', file.size_new?.[1])
  put('master', file.size_new?.[0])
  put('dolby', file.size_dolby)
  return qualitys
}
