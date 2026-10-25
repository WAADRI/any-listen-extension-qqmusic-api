// 生成扩展签名密钥对并写入 .env（本地开发或 CI 兜底使用）。
// 正式发布应使用固定的 PRI_KEY/PUB_KEY 环境变量/secrets，此脚本生成的临时密钥
// 产物可安装，但与其他密钥对不互通，跨版本升级需卸载重装。
import crypto from 'node:crypto'
import fs from 'node:fs'

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

const singleLine = (pem) =>
  pem
    .split('\n')
    .filter((line) => line && !line.startsWith('-----'))
    .join('')

fs.writeFileSync('.env', `PRI_KEY=${singleLine(privateKey)}\nPUB_KEY=${singleLine(publicKey)}\n`)
console.log('ephemeral signing keys written to .env')
