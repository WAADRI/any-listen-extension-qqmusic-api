import type { ExtensionConfig } from '@any-listen/extension-kit/config'

import pkg from './package.json' with { type: 'json' }

const DEFAULT_API_BASE_URL = 'https://qqmusic.api.waadri.top'

const config: ExtensionConfig = {
  id: 'qqmusic-api',
  name: 'QQ音乐 (waadri API)',
  description:
    '基于 qqmusic.api.waadri.top 接口的 QQ 音乐音源扩展。支持使用初始 Cookie 自动续期登录凭证，提供歌曲搜索、播放链接获取、封面与歌词显示。高音质需要 QQ 音乐 VIP 账号的 Cookie。接口服务基于开源项目 l-1124/QQMusicApi (GPL-3.0) 部署。',
  version: pkg.version,
  homepage: pkg.homepage,
  license: pkg.license,
  author: pkg.author,
  target_engine: '1.3.1',
  categories: ['music'],
  tags: ['qqmusic', 'music-source'],
  download_url_template: 'https://github.com/WAADRI/any-listen-extension-qqmusic-api/releases/download/v{version}',
  icon: './resources/icon.png',
  grant: ['internet'],
  buildConfig: {
    srcDir: 'src',
    distDir: 'dist',
    outputDir: 'build',
    i18nDir: 'i18n',
    resourcesDir: 'resources',
    isIsolateMode: false,
    mainEntry: 'src/index.ts',
  },
  contributes: {
    resource: [
      {
        id: 'qq',
        name: 'QQ音乐',
        resource: ['musicSearch', 'musicUrl', 'musicPic', 'musicLyric', 'hotSearch', 'tipSearch'],
      },
    ],
    commands: [
      {
        command: 'qqmusic.checkCredential',
        name: '检查/续期 QQ 音乐登录凭证',
        description: '立即检查 Cookie 是否过期，过期时自动调用接口续期。',
      },
      {
        command: 'qqmusic.showStatus',
        name: '查看 QQ 音乐凭证状态',
        description: '查看当前登录账号、上次检查与续期时间等信息。',
      },
      {
        command: 'qqmusic.setCookie',
        name: '粘贴/更新 QQ 音乐 Cookie',
        description: '通过输入框粘贴新的初始 Cookie。',
      },
    ],
    settings: [
      {
        field: 'cookie',
        name: '初始 Cookie',
        description:
          '从浏览器登录 y.qq.com 后复制完整 Cookie 粘贴到这里即可：扩展会自动识别网页版字段（uin/qm_keyst/psrf_* 前缀等）并转换为接口所需格式，过期时自动续期并写回。也支持直接粘贴 musicid/musickey 格式。',
        type: 'input',
        textarea: true,
        default: '',
      },
      {
        field: 'apiBaseUrl',
        name: 'API 地址',
        description: 'QQ 音乐 API 服务地址，默认为 https://qqmusic.api.waadri.top ，可替换为自部署实例。',
        type: 'input',
        default: DEFAULT_API_BASE_URL,
      },
      {
        field: 'autoRefresh',
        name: '自动续期登录凭证',
        description: '开启后定期检查 Cookie 是否过期，过期时自动刷新并写回。',
        type: 'boolean',
        default: true,
      },
      {
        field: 'refreshIntervalHours',
        name: '自动续期检查间隔',
        description: '多久检查一次登录凭证是否过期。',
        type: 'selection',
        default: '12',
        enum: ['6', '12', '24'],
        enumName: ['每 6 小时', '每 12 小时', '每 24 小时'],
      },
      {
        field: 'preferHttpsCdn',
        name: '优先使用 HTTPS CDN',
        description:
          '播放链接默认将 CDN 域名替换为 https 协议，以兼容纯 HTTPS 部署的 Web 端；遇到无法播放的情况可尝试关闭。',
        type: 'boolean',
        default: true,
      },
    ],
  },
}

export default config
