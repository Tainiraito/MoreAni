import { gzipSync } from 'node:zlib'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const DIST_ASSETS = new URL('../dist/assets/', import.meta.url)
const MAX_MAIN_RAW_BYTES = 480_000
const MAX_MAIN_GZIP_BYTES = 150_000

const assetNames = await readdir(DIST_ASSETS)
const mainAssets = assetNames.filter((name) => /^index-[^/]+\.js$/.test(name))

if (mainAssets.length !== 1) {
  throw new Error(`期望恰好找到一个主入口 chunk，实际找到 ${mainAssets.length} 个`)
}

const mainAsset = mainAssets[0]
const content = await readFile(join(DIST_ASSETS.pathname, mainAsset))
const rawBytes = content.byteLength
const gzipBytes = gzipSync(content, { level: 9 }).byteLength

console.log(`${mainAsset}: raw=${rawBytes} bytes, gzip=${gzipBytes} bytes`)

if (rawBytes > MAX_MAIN_RAW_BYTES || gzipBytes > MAX_MAIN_GZIP_BYTES) {
  throw new Error(
    `主入口超过体积门禁：raw <= ${MAX_MAIN_RAW_BYTES}、gzip <= ${MAX_MAIN_GZIP_BYTES}`,
  )
}
