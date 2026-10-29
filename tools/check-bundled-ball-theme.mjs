/**
 * 随包的浮标外观那一份 (2.8.0 起)
 *
 * 这一条链上有**四段接缝**, 每一段漂开了都不会当场报错, 只会在设备上变成"球变回内置画法"或者
 * "那个插件永远装不上":
 *
 *   1. **文件名三处一致**: `app/build.gradle.kts` 里 `bundledBallTheme` 那个路径、`LwPluginSeed.ASSET`
 *      那一段、以及 `luwi-plugins/packages/` 里真实存在的那个文件
 *   2. **版本两处一致**: `LwPluginSeed.VERSION` 与那份 `.lwp` 里 `plugin.json` 的 `version` —— 漂开了的
 *      样子是"每次都装一遍" (永远比不过记号) 或者"记号说补过了, 其实装的是别的版本"
 *   3. **`minLw` 不许高过本包的 `versionName`**: 高一点点的后果是这份外观**在设备上永远装不上**,
 *      而日志里只有 [PluginInstaller] 一句"这个插件要 x 及以上"
 *   4. **挂载的那一行在一个对象里**: 装 (`PluginInstaller`) -> 启用 (`PluginManager.enable`) ->
 *      挑外观 (`BallTheme.choose`) 三步都在, 少一步就是"装了但没启用"或"装了但球不变"
 *
 * 不需要设备, 也不需要 host: 全是拿真文件对着核。`.lwp` 是只存不压的 zip, 这里自己按局部头读一份
 * `plugin.json` 出来 (不引任何解压依赖)
 *
 * 用法: node tools/check-bundled-ball-theme.mjs
 */

import { readFile, readdir } from 'node:fs/promises'
import { inflateRawSync } from 'node:zlib'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')

let failures = 0
let checks = 0
function check(name, got, want) {
  checks += 1
  const same = JSON.stringify(got) === JSON.stringify(want)
  if (!same) failures += 1
  console.log(
    `${same ? 'ok  ' : 'FAIL'} ${name}`
      + (same ? '' : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`),
  )
}

/* ── 一、文件名三处一致 ─────────────────────────────────────────────────── */

const gradle = await read('app/build.gradle.kts')
const seed = await read('app/src/main/java/io/github/yuloong07star/luwi/host/LwPluginSeed.kt')

const gradleName = /val bundledBallTheme: File =\s*\n?\s*rootProject\.file\("\.\.\/luwi-plugins\/packages\/([^"]+)"\)/.exec(gradle)
const seedAsset = /private const val ASSET = "\$FOLDER\/([^"]+)"/.exec(seed)
const seedVersion = /private const val VERSION = "([^"]+)"/.exec(seed)
const seedId = /private const val ID = "([^"]+)"/.exec(seed)

/** 按 `.` 与 `-` 分段比版本 (与 `PluginVersions.compare` 同一个口径, 1.1.10 > 1.1.4) */
function compareVersion(left, right) {
  const one = left.split(/[.-]/).map((part) => Number.parseInt(part, 10))
  const two = right.split(/[.-]/).map((part) => Number.parseInt(part, 10))
  for (let index = 0; index < Math.max(one.length, two.length); index += 1) {
    const a = one[index] ?? 0
    const b = two[index] ?? 0
    if (Number.isNaN(a) || Number.isNaN(b)) break
    if (a !== b) return a - b
  }
  return 0
}

// **不写死版本号**: 这份包换过三次 (1.1.0 → 1.1.1 → 1.1.2), 写死的那个数会替真正的问题打掩护 ——
// 这里只认 "构建脚本指的那一份真的在, 而且它就是 packages/ 里最新的那一份"
const packagesDir = new URL('../luwi-plugins/packages/', root)
const ballThemes = (await readdir(packagesDir))
  .map((name) => ({ name, version: /^whalegirl-balltheme-(\d+\.\d+\.\d+)\.lwp$/.exec(name)?.[1] ?? null }))
  .filter((entry) => entry.version !== null)
  .sort((left, right) => compareVersion(left.version, right.version))
const ballThemeNames = ballThemes.map((entry) => entry.name)
const newestBallTheme = ballThemes.at(-1)?.name ?? null
const gradleFile = gradleName?.[1] ?? null

check('构建脚本那一份真的在 packages/ 里', ballThemeNames.includes(gradleFile ?? ''), true)
check('构建脚本那一份就是 packages/ 里最新的', gradleFile, newestBallTheme)
check('LwPluginSeed 认的是同一个文件', seedAsset?.[1] ?? null, gradleName?.[1] ?? null)
check('LwPluginSeed 的版本号写在文件名里', seedAsset?.[1]?.includes(`-${seedVersion?.[1]}.lwp`) ?? false, true)

/* ── 二、那份 .lwp 真的在, 而且版本 / minLw 对得上 ──────────────────────── */

/** 只存不压的 zip 里读一格 (局部头 -> 名字 -> 数据; 压缩的那一档用 zlib 解) */
function zipEntry(buffer, wanted) {
  let at = 0
  while (at + 30 <= buffer.length && buffer.readUInt32LE(at) === 0x04034b50) {
    const method = buffer.readUInt16LE(at + 8)
    const size = buffer.readUInt32LE(at + 18)
    const nameLength = buffer.readUInt16LE(at + 26)
    const extraLength = buffer.readUInt16LE(at + 28)
    const name = buffer.subarray(at + 30, at + 30 + nameLength).toString('utf8')
    const start = at + 30 + nameLength + extraLength
    const data = buffer.subarray(start, start + size)
    if (name === wanted) return method === 8 ? inflateRawSync(data) : data
    at = start + size
  }
  return null
}

const packagePath = new URL(`../luwi-plugins/packages/${gradleName?.[1] ?? 'missing.lwp'}`, root)
let manifest = null
try {
  const bytes = await readFile(packagePath)
  const entry = zipEntry(bytes, 'plugin.json')
  manifest = entry === null ? null : JSON.parse(entry.toString('utf8'))
  check('那份 .lwp 里读得出 plugin.json', manifest !== null, true)
} catch {
  check('那份 .lwp 在 luwi-plugins/packages 里', false, true)
}

if (manifest !== null) {
  check('LwPluginSeed 的 VERSION 与包里那份一致', seedVersion?.[1] ?? null, manifest.version)
  check('LwPluginSeed 的 ID 与包里那份一致', seedId?.[1] ?? null, manifest.id)
  const versionName = /versionName = "([^"]+)"/.exec(gradle)?.[1] ?? ''
  // minLw 高过本包 versionName = 这份外观在设备上永远装不上 (PluginManifest.parse 会当场拒)
  const compare = (left, right) => {
    const one = left.split(/[.-]/).map((part) => Number.parseInt(part, 10))
    const two = right.split(/[.-]/).map((part) => Number.parseInt(part, 10))
    for (let index = 0; index < Math.max(one.length, two.length); index += 1) {
      const a = one[index] ?? 0
      const b = two[index] ?? 0
      if (Number.isNaN(a) || Number.isNaN(b)) break
      if (a !== b) return a - b
    }
    return 0
  }
  check(`minLw (${manifest.minLw}) 不高于本包的 versionName (${versionName})`, compare(manifest.minLw, versionName) <= 0, true)
}

/* ── 三、装 -> 启用 -> 挑外观, 三步都在 ────────────────────────────────── */

check(
  '装那一步走的是与"从链接装入"同一条链 (PluginInstaller, 开发者模式关着)',
  seed.includes('PluginInstaller.install(context, staging, developerMode = false)'),
  true,
)
check('装完启用一次 (art 域零能力, connect 是 null)', seed.includes('PluginManager.enable(context, ID)'), true)
check('首启挑外观 (主人选过就不动)', [
  seed.includes('private const val THEME_CHOICE = ".theme.json"'),
  seed.includes('BallTheme.choose(context, ID)'),
], [true, true])
check(
  '只补这一版一次: 记号放在 $DSH_HOME/lw/plugin-seed.txt',
  [seed.includes('private const val SEED_DIR = "lw"'), seed.includes('private const val SEED_FILE = "plugin-seed.txt"')],
  [true, true],
)
check(
  '装着的已经不比它旧就不装 (降级那条由 PluginInstaller 拒)',
  seed.includes('PluginVersions.compare(installed, VERSION) < 0'),
  true,
)
check(
  '排进 restore 那条后台线程, 而且在 restore 之前',
  /\n\s+LwPluginSeed\.ensure\(alone\)\n\s+PluginManager\.restore\(alone\)/.test(
    await read('app/src/main/java/io/github/yuloong07star/luwi/host/DshHostService.kt'),
  ),
  true,
)

console.log(`\n${checks - failures} / ${checks} 通过`)
if (failures > 0) process.exit(1)
