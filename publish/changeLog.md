# QQ音乐 (waadri API) 更新日志

## 0.1.3

- 修复歌词不显示：QRC 逐字歌词从原始 XML 转换为 Any Listen 支持的 LX 格式（行时间 [mm:ss.ms]、字级 <offset,duration>）
- 修复宿主 VM 下自定义错误类赋值 name 抛 TypeError 的问题

## 0.1.2

- 粘贴 y.qq.com 网页版 Cookie 时自动识别并转换为接口字段（uin→musicid、qm_keyst→musickey、psrf_* 前缀系列），无需手动改字段名

## 0.1.1

- 新增对 API 服务上游项目 l-1124/QQMusicApi (GPL-3.0) 的致谢与引用说明
- CI 未配置签名密钥时自动生成临时密钥兜底；Release 自动附带 .alix 产物

## 0.1.0

- 首个版本
- 支持配置初始 Cookie，自动检查过期并调用 `/login/refresh_credential` 续期，续期后的新凭据自动写回设置
- 歌曲搜索（`/search/search_by_type`）、热搜与搜索联想
- 播放链接获取（`/song/{mid}/url`），支持 128k ~ 臻品母带多档音质按 VIP 权益自动降级
- 封面（y.gtimg.cn 公开规则）与歌词（LRC + 翻译 + 逐字 QRC）
