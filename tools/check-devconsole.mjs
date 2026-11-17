/**
 * 开发台与工具链那两件的判据 (2.8.1)
 *
 * 手写 Binder 没有编译器帮着对描述符与编号, 所以"两侧同一份接口"只能靠这份脚本盯:
 *
 *   1. `:lwdev-api` 里的常量 (权限名 / action / 包名 / 描述符) 与开发台的 manifest 逐字一致
 *   2. 开发台那一侧实现 `IDevConsole`, intent-filter 的 action 对得上, 且有 LAUNCHER (它是看得见的那一半)
 *   3. `DevTools.kt` 的下载表与 `DevApi` 的包名逐字一致 (下错包 = 装了也用不上)
 *   4. **工具链不再是一个应用**: 仓库里没有 `:devtools` 模块与 `IDevTools`, 工具链走的是
 *      `ToolchainPack` (下 zip → 摊开 → `forge.stage`), 包里那份名字与 `DevTools.TOOLCHAIN_ASSET` 一致
 *
 * 跑法: node tools/check-devconsole.mjs   (不需要设备)
 */

import { readFile, readdir } from 'node:fs/promises'

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

const api = await read('lwdev-api/src/main/java/io/github/yuloong07star/luwi/dev/api/DevApi.kt')
const consoleService = await read('devconsole/src/main/java/io/github/yuloong07star/luwi/devconsole/ConsoleService.kt')
const consoleManifest = await read('devconsole/src/main/AndroidManifest.xml')
const devTools = await read('app/src/main/java/io/github/yuloong07star/luwi/tool/DevTools.kt')
const pack = await read('app/src/main/java/io/github/yuloong07star/luwi/tool/ToolchainPack.kt')
const settings = await read('settings.gradle.kts')
const luwiManifest = await read('app/src/main/AndroidManifest.xml')

function constant(name) {
  const at = api.indexOf(`const val ${name}`)
  if (at < 0) return null
  const line = api.slice(at, api.indexOf('\n', at))
  return (line.match(/"([^"]+)"/u) ?? [])[1] ?? null
}

const permission = constant('PERMISSION')
const bindConsole = constant('BIND_CONSOLE')
const packageConsole = constant('PACKAGE_CONSOLE')
const descriptorConsole = constant('DESCRIPTOR_CONSOLE')

check('DevApi 的权限名读得到', permission, 'io.github.yuloong07star.luwi.permission.DEV')
check('开发台的 action 读得到', bindConsole, 'io.github.yuloong07star.luwi.devconsole.BIND')
check('开发台的包名读得到', packageConsole, 'io.github.yuloong07star.luwi.devconsole')
check('开发台的描述符读得到', descriptorConsole, 'io.github.yuloong07star.luwi.dev.api.IDevConsole')

check('开发台的 manifest 用了那条权限', consoleManifest.includes(`android:permission="${permission}"`), true)
check('开发台的 action 对得上', consoleManifest.includes(`android:name="${bindConsole}"`), true)
check('开发台有 LAUNCHER', /android.intent.category.LAUNCHER/.test(consoleManifest), true)
check('开发台要文件访问 (读项目目录)', consoleManifest.includes('MANAGE_EXTERNAL_STORAGE'), true)
check('开发台那一侧实现 IDevConsole', /: IDevConsole\(\)/.test(consoleService), true)
check('开发台引了同一份 DevApi', consoleService.includes('DevApi.'), true)

check('Luwi 声明了那条权限', new RegExp(`<permission\\s+android:name="${permission}"`).test(luwiManifest), true)
check('Luwi 自己也 uses-permission', luwiManifest.includes(`<uses-permission android:name="${permission}" />`), true)
check('下载表的开发台包名与 DevApi 一致', devTools.includes(packageConsole), true)

/* ── 工具链不再是一个应用 ─────────────────────────────────────────────── */

check('settings 里没有 :devtools 模块', /include\(":devtools"\)/.test(settings), false)
const devApiDir = await readdir(new URL('lwdev-api/src/main/java/io/github/yuloong07star/luwi/dev/api', root))
check('lwdev-api 只剩 DevApi 与 IDevConsole', devApiDir.sort(), ['DevApi.kt', 'IDevConsole.kt'])
check('DevApi 里没有工具那一套常量', /API_TOOLS|BIND_TOOLS|PACKAGE_TOOLS|DESCRIPTOR_TOOLS/.test(api), false)
check('工具链包名写在 DevTools 一处', /TOOLCHAIN_ASSET = "luwi-toolchain\.zip"/.test(devTools), true)
check('ToolchainPack 走 forge.stage', pack.includes('operation = "forge.stage"'), true)
check('ToolchainPack 逐条挡穿越', /name\.split\('\/'\)\.any \{ it == "\.\." \}/.test(pack), true)

const modules = await readdir(new URL('.', root), { withFileTypes: true })
check('仓库根没有 devtools 目录', modules.filter((entry) => entry.isDirectory()).map((entry) => entry.name).includes('devtools'), false)

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${checks - failures}/${checks}`)
process.exit(failures === 0 ? 0 : 1)
