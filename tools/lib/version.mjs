/**
 * 版本号**唯一**读法 (2.8.0 之后)
 *
 * 为什么单独有这么一份: `versionName` 原来在四处各用一条正则去抠 ——
 * `pipeline/steps/dev.mjs` (落实代码的开工闸)、`tools/check-plugins.mjs` (样例包 minLw)、
 * `tools/check-bundled-ball-theme.mjs` (随包外观的 minLw)、`tools/lw-release-check.ps1` (发版闸)。
 * 四条正则现在恰好都只看第一处赋值, 于是**哪天 `app/build.gradle.kts` 长出第二个 `versionName`**
 * (productFlavors / 变体 / 第二个 defaultConfig) 时, 四处会安静地各取一个, 谁都不报错 ——
 * 症状是"发版闸说这个数, 落实代码却按另一个数拦", 而两边都显示 green
 *
 * 判据只有一条, 但写得死: **`app/build.gradle.kts` 里 `versionName` 与 `versionCode` 各只许出现一次
 * 赋值**。多了就是本文件的 `ok: false`, 由调用方就地红掉 (不猜、不取第一个)。行首锚定 `^\s*`, 所以
 * `// versionName = "…"` 这种注释行不算赋值
 *
 * 谁在用:
 *   - `tools/check-plugins.mjs` / `tools/check-bundled-ball-theme.mjs` (node 侧判据)
 *   - `pipeline/steps/dev.mjs` (versionName 对本 `current.json`)
 *   - `tools/lw-release-check.ps1` (CLI 形态: exit 0/3 + 一行 JSON)
 *
 * 用法:
 *   node tools/lib/version.mjs                 打印 { ok, versionName, versionCode, line, codeLine }
 *   node tools/lib/version.mjs --file <path>   读别的构建脚本 (测试夹具用)
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

/** 仓库根: 本文件在 tools/lib/ 下 */
const ROOT = new URL('../../', import.meta.url)

/** 缺省的构建脚本 —— `versionCode` / `versionName` 由人写在这里 (AGENTS: 版本号由人定) */
export const GRADLE_FILE = new URL('app/build.gradle.kts', ROOT)

/**
 * 赋值形态: `versionName = "2.8.0"` / `versionCode = 19`
 *
 * 两个细节都得管住:
 *   - **单行块也算**: `flavorA { versionName = "2.8.0-a" }` 是合法 Kotlin, 行首锚定会漏掉它
 *   - **别人的属性不算**: `it.versionName = "x"` / `config.versionName = "x"` 前面的那个点排除掉,
 *     否则随便哪个 DSL 里同名属性都会冒充本包的版本
 */
const NAME = /(?<![\w.$])versionName[ \t]*=[ \t]*"([^"]*)"/g
const CODE = /(?<![\w.$])versionCode[ \t]*=[ \t]*([0-9]+)/g

/** 找 [pattern] 在 [text] 里的全部匹配, 带 1 起的行号; 落在 `//` 后面的不算赋值 */
function scan(text, pattern) {
  const found = []
  pattern.lastIndex = 0
  let match = pattern.exec(text)
  while (match !== null) {
    const at = match.index
    const lineStart = text.lastIndexOf('\n', at - 1) + 1
    const before = text.slice(lineStart, at)
    const line = text.slice(0, at).split('\n').length
    if (!before.includes('//')) found.push({ value: match[1], line, text: match[0].trim() })
    match = pattern.exec(text)
  }
  return found
}

/** 那几条赋值拼成一句人话, 给"多了"的那条错用 (指名行号, 不然不知道删哪个) */
function where(found) {
  return found.map((one) => `第 ${one.line} 行 \`${one.text}\``).join(' / ')
}

/**
 * 解析构建脚本文本 —— **严格版**, 少了或多了都抛
 *
 * 抛错的两种情形要分开说: `0 处` 是"这个文件里没有版本号", `2 处以上` 是"读哪个都不算数"。
 * 后者一定得抛, 因为一旦挑了一个, 四处判据就开始各自挑不同的那一个
 */
export function readGradleVersions(text) {
  const names = scan(text, NAME)
  const codes = scan(text, CODE)
  if (names.length === 0) throw new Error('build.gradle.kts 里找不到 versionName 赋值')
  if (names.length > 1) throw new Error(`versionName 出现 ${names.length} 次, 只许一处: ${where(names)}`)
  if (codes.length === 0) throw new Error('build.gradle.kts 里找不到 versionCode 赋值')
  if (codes.length > 1) throw new Error(`versionCode 出现 ${codes.length} 次, 只许一处: ${where(codes)}`)
  return {
    ok: true,
    versionName: names[0].value,
    versionCode: Number.parseInt(codes[0].value, 10),
    line: names[0].line,
    codeLine: codes[0].line,
  }
}

/** 同 [readGradleVersions], 但把"读不出"变成 `{ ok: false, error }` —— 判据脚本用它, 不让整脚本崩 */
export function tryReadGradleVersions(text) {
  try {
    return readGradleVersions(text)
  } catch (error) {
    return { ok: false, error: error.message, versionName: null, versionCode: null }
  }
}

/** 读一份文件 (缺省就是本仓库的 `app/build.gradle.kts`) 并解析 */
export async function gradleVersions(file = GRADLE_FILE) {
  return readGradleVersions(await readFile(file, 'utf8'))
}

/** 同 [gradleVersions], 读不动文件也归到 `ok: false` */
export async function tryGradleVersions(file = GRADLE_FILE) {
  try {
    return await gradleVersions(file)
  } catch (error) {
    return { ok: false, error: error.message, versionName: null, versionCode: null }
  }
}

/* ── CLI: 发版闸 (lw-release-check.ps1) 按这一个口子读 ──────────────────── */

const argv = process.argv.slice(2)
const at = argv.indexOf('--file')
const asScript = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (asScript) {
  const file = at >= 0 && argv[at + 1] ? resolve(argv[at + 1]) : fileURLToPath(GRADLE_FILE)
  const result = await tryGradleVersions(file)
  console.log(JSON.stringify({ ...result, file }, null, 2))
  process.exit(result.ok ? 0 : 3)
}
