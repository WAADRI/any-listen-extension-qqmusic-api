# QQ音乐 (waadri API) 更新日志

## 0.1.1

- 新增对 API 服务上游项目 l-1124/QQMusicApi (GPL-3.0) 的致谢与引用说明
- CI 未配置签名密钥时自动生成临时密钥兜底；Release 自动附带 .alix 产物

## 0.1.0

- 首个版本
- 支持配置初始 Cookie，自动检查过期并调用 `/login/refresh_credential` 续期，续期后的新凭据自动写回设置
- 歌曲搜索（`/search/search_by_type`）、热搜与搜索联想
- 播放链接获取（`/song/{mid}/url`），支持 128k ~ 臻品母带多档音质按 VIP 权益自动降级
- 封面（y.gtimg.cn 公开规则）与歌词（LRC + 翻译 + 逐字 QRC）
