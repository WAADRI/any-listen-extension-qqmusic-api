// any-listen 的逐字歌词为 LX 规范：行时间用 LRC 格式 [mm:ss.ms]，
// 字级时间用尖括号 <offset,duration>（line-player 的 awlrcTimeRxp 只认尖括号）。
// QQ 音乐 QRC XML 的行时间却是 [startMs,durationMs] 逗号格式、字级为圆括号，
// 直接透传会导致解析器丢弃所有行（歌词空白），需要先转换。

const decodeXmlEntities = (text: string): string => {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

const formatLrcTime = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000)
  const msPart = String(ms % 1000).padStart(3, '0')
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${msPart}]`
}

// QRC XML → LX 逐字歌词。无法识别时返回 null（调用方回退普通 LRC）。
export const qrcToAwlrc = (qrcXml: string): string | null => {
  if (!qrcXml.includes('LyricContent')) return null
  const matched = qrcXml.match(/LyricContent="([^"]*)"/) ?? qrcXml.match(/LyricContent='([^']*)'/)
  if (!matched) return null

  const lines = decodeXmlEntities(matched[1]).split(/\r\n|\n|\r/)
  const converted: string[] = []
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    const qrcLine = line.match(/^\[(\d+),(\d+)\](.*)$/)
    if (qrcLine) {
      const startMs = parseInt(qrcLine[1], 10)
      // 字级时间 (offset,duration) → <offset,duration>
      const text = qrcLine[3].replace(/\((\d+),(\d+)\)/g, '<$1,$2>')
      if (text) converted.push(formatLrcTime(startMs) + text)
    } else if (/^\[[a-z]+:/i.test(line) || /^\[\d{1,3}:\d{1,3}(?:[.:]\d{1,3})?]/.test(line)) {
      // [ti:..] 等头部标签以及已是 LRC 时间格式的行原样保留
      converted.push(line)
    }
  }
  return converted.length ? converted.join('\n') : null
}
