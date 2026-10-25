// any-listen 的逐字歌词为 LX 规范：行时间用 LRC 格式 [mm:ss.ms]，
// 字级时间用尖括号 <offset,duration> 且标签在字**前面**（font-player 按
// /(?=<\d+,\d+>).*?/g 分割后要求每个片段都以 <\d+,\d+> 开头），
// offset 为行内相对毫秒（用于字序定位与动画 delay）。
// QQ 音乐 QRC XML 的行时间是 [startMs,durMs] 逗号格式、字级为圆括号且标签在字
// **后面**（"字(偏移,时长)"），偏移为歌曲绝对毫秒——直接透传会导致解析器
// 走整行回退（_handleLineParse 原样显示带标签的文本），必须先转换。

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

// 单行 QRC 内容 → LX 逐字格式。无法识别时返回 null（调用方回退普通 LRC）。
const convertQrcLine = (line: string): string | null => {
  const qrcLine = line.match(/^\[(\d+),(\d+)\](.*)$/)
  if (!qrcLine) return null
  const startMs = parseInt(qrcLine[1], 10)
  let out = formatLrcTime(startMs)
  let pending = '' // 尚未拿到时间标记的文本（QRC 标记跟在文本后面）
  const tokenRxp = /([^()]+)|\((\d+),(\d+)\)/g
  for (const m of qrcLine[3].matchAll(tokenRxp)) {
    if (m[2] != null) {
      const relStart = Math.max(parseInt(m[2], 10) - startMs, 0)
      // 标记作用于它前面的整段文本（单字或英文词组）；空文本时跳过标记
      if (pending) {
        out += `<${relStart},${m[3]}>${pending}`
        pending = ''
      }
    } else {
      pending += m[1]
    }
  }
  // 行尾剩余的无标记文本原样保留
  out += pending
  return out
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
    const convertedLine = convertQrcLine(line)
    if (convertedLine != null) {
      converted.push(convertedLine)
    } else if (/^\[[a-z]+:/i.test(line) || /^\[\d{1,3}:\d{1,3}(?:[.:]\d{1,3})?]/.test(line)) {
      // [ti:..] 等头部标签以及已是 LRC 时间格式的行原样保留
      converted.push(line)
    }
  }
  return converted.length ? converted.join('\n') : null
}
