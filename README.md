# any-listen QQ音乐扩展 (waadri API)

[English](#english) | 简体中文

基于 [qqmusic.api.waadri.top](https://qqmusic.api.waadri.top/docs) 接口的 [Any Listen](https://github.com/any-listen/any-listen) Web 端音源扩展：

- **Cookie 自动续期**：只需提供一次初始 Cookie，扩展会定期调用 `/login/check_expired` 检查登录态，过期时自动调用 `/login/refresh_credential` 续期，并把刷新后的新凭据写回设置
- **歌曲搜索**：`/search/search_by_type`，支持分页，附带音质档位、封面、时长等元信息
- **播放链接**：`/song/{mid}/url`，支持 128k / 192k / 320k / 无损 / Hi-Res / 母带 / 杜比等多档音质，按账号权益自动降级
- **封面与歌词**：封面走 y.qq.com 公开 CDN 规则；歌词支持 LRC + 翻译 + 罗马音 + 逐字歌词（QRC）
- **热搜与搜索联想**

搜索、歌词、封面、热搜**无需登录**即可使用；获取播放链接需要有效的 QQ 音乐 Cookie（高音质需要 VIP）。

## 安装

仓库地址：https://github.com/WAADRI/any-listen-extension-qqmusic-api

### 方式一：安装打包好的扩展

1. 构建产出位于 `build/qqmusic-api_v0.1.0.alix`
2. 在 Any Listen Web 端打开 **设置 → 扩展 → 安装扩展**，选择该 `.alix` 文件

### 方式二：从源码构建

```bash
pnpm install   # 或 npm install
# 生成签名密钥（首次）
node -e "const c=require('crypto');const {privateKey,publicKey}=c.generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});const s=p=>p.split('\n').filter(l=>l&&!l.startsWith('-----')).join('');require('fs').writeFileSync('.env','PRI_KEY='+s(privateKey)+'\nPUB_KEY='+s(publicKey)+'\n')"
npm run build  # 产出 build/qqmusic-api_v0.x.x.alix
```

> `.env` 中的密钥用于扩展包签名，请妥善保管；同一扩展升级时需使用同一对密钥。

## 获取初始 Cookie

1. 在浏览器打开 [y.qq.com](https://y.qq.com) 并登录（建议使用 QQ 音乐 VIP 账号以解锁高音质）
2. 按 F12 打开开发者工具 → **Network（网络）** 标签，刷新页面，点击任意一个 `y.qq.com` 的请求
3. 在 **Request Headers（请求标头）** 中找到 `Cookie:` 一行，复制**完整**的 Cookie 值
4. 粘贴到本扩展设置的 **初始 Cookie** 输入框中并保存

Cookie 至少需要包含 `musicid` 和 `musickey` 两个字段；若包含 `refresh_token` / `refresh_key`，自动续期的成功率更高（取决于登录方式）。

## 使用

安装后进入 **设置 → 在线音乐音源**（或播放页音源选择），选择 **QQ音乐** 源即可搜索播放。

### 设置项

| 设置项 | 说明 |
| --- | --- |
| 初始 Cookie | 完整 Cookie 字符串；续期后此字段会被自动更新为最新凭据 |
| API 地址 | 默认 `https://qqmusic.api.waadri.top`，可改为自部署实例 |
| 自动续期登录凭证 | 开启后按间隔自动检查并续期 |
| 自动续期检查间隔 | 每 6 / 12 / 24 小时 |
| 优先使用 HTTPS CDN | 播放链接域名默认升级为 https，Web 端 HTTPS 部署时必须；遇到无法播放可尝试关闭 |

### 扩展命令

在扩展管理页可使用：

- **检查/续期 QQ 音乐登录凭证**：立即检查并续期
- **查看 QQ 音乐凭证状态**：查看当前账号、上次检查/续期时间
- **粘贴/更新 QQ 音乐 Cookie**：弹窗快速更新 Cookie

### 自动续期机制

- 扩展启动、以及每次获取播放链接前（间隔 30 分钟以上才会发起检查）都会调用 `/login/check_expired`
- 检测到过期 → 调用 `/login/refresh_credential` 获取新凭据（`musickey`、`refresh_token` 等）→ 更新内存状态并**写回设置里的 Cookie 字段**
- 定时器按设置的间隔后台检查（仅 Any Listen 运行期间有效；长期不使用导致的过期会在下次使用时自动补救）
- 续期失败（Cookie 彻底失效）时会弹提示，需要重新粘贴 Cookie

## 开发

```bash
npm run build              # 构建 .alix
npm test                   # 模拟宿主环境 + 真实 API 的端到端测试（node test/harness.mjs）
```

项目结构：

```
src/
├── index.ts              # 入口：注册音源动作、命令、配置监听、续期定时器
├── shared/
│   ├── hostApi.ts        # require('any-listen') 宿主 API 引出
│   ├── api.ts            # HTTP 封装（Cookie 头注入、统一错误处理）
│   ├── credential.ts     # Cookie 解析/序列化、过期检查、自动续期核心
│   ├── musicInfo.ts      # QQ 音乐歌曲对象 → any-listen MusicInfoOnline
│   └── quality.ts        # 音质档位 ↔ file_type 映射、qualitys 元信息
test/harness.mjs          # 端到端测试（无需 Any Listen 宿主）
```

## 致谢

- 本扩展依赖的 API 服务 [qqmusic.api.waadri.top](https://qqmusic.api.waadri.top/docs) 基于开源项目 [l-1124/QQMusicApi](https://github.com/l-1124/QQMusicApi)（GPL-3.0）部署搭建，感谢原作者的封装与维护
- [Any Listen](https://github.com/any-listen/any-listen) 及其官方扩展项目提供了扩展体系与开发参考

> 音乐平台不易，请尊重版权，支持正版。本扩展仅供个人学习与研究使用。

## 常见问题

- **搜索正常但无法播放 / 提示无权限**：Cookie 未配置或已失效，请在设置中粘贴新 Cookie；特定歌曲的高音质需要 VIP 权限，扩展会自动降级到可用音质
- **提示「Cookie 无效或已过期，自动续期失败」**：refresh_token 已失效（常见于长期未使用或账号在别处修改密码），重新从浏览器复制 Cookie
- **播放链接无法访问**：尝试关闭/开启「优先使用 HTTPS CDN」设置
- **API 被限流**：可自部署该 API 服务并修改「API 地址」设置

## English

An [Any Listen](https://github.com/any-listen/any-listen) music source extension built on the [qqmusic.api.waadri.top](https://qqmusic.api.waadri.top/docs) API. It provides automatic Cookie credential renewal (via `/login/check_expired` + `/login/refresh_credential`, writing refreshed credentials back to the settings), music search, playback URL retrieval with quality fallback (128k up to master), covers, and lyrics (LRC + translation + QRC word-by-word).

Search works without login; playback URLs require a valid QQ Music Cookie (VIP account for lossless qualities).

The API service [qqmusic.api.waadri.top](https://qqmusic.api.waadri.top/docs) is deployed from [l-1124/QQMusicApi](https://github.com/l-1124/QQMusicApi) (GPL-3.0). Many thanks to its author. Build with `npm install && npm run build` and install the resulting `.alix` file in Any Listen's extension manager, then paste your y.qq.com Cookie into the extension settings.
