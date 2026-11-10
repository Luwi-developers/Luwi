/**
 * 人格卡"运行时读"那一节的行为判据 (2026-11-10)
 *
 * 抽 `host-plugin/index.mjs` 里那一段源码真跑 (不复制第二份), 钉住五件在设备上很难复现的事:
 *
 *   1. 设备卡在 -> 原样交给模型 (trim 之后), 并且内容变了会重读 (按 mtime + size)
 *   2. 卡不在 -> 退包内默认 (`node_modules/luwi-channel/persona.txt`)
 *   3. 两个都不在 -> 四行兜底, 不让人设整段消失
 *   4. 超长 -> 截断到 20000 字并写明; 卡里出现 `{{` 也原样留着 (变量值不二次扫描)
 *   5. 非 `luwi` 档一个字都不给; provider 永不抛 (I/O 炸了也回兜底)
 *
 * 跑法: `node tools/check-persona-live.mjs`
 */

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const host = readFileSync(join(root, 'host-plugin', 'index.mjs'), 'utf8')

const START = '/** `$DSH_HOME` 底下的一条路径'
const END = '/**\n * 现在在哪一个模式'
const start = host.indexOf(START)
const end = host.indexOf(END)
if (start < 0 || end < 0 || end <= start) throw new Error('the persona section is not in host-plugin/index.mjs')
const section = host.slice(start, end)

let failures = 0
let checks = 0
function check(name, got, want) {
  checks += 1
  const same = JSON.stringify(got) === JSON.stringify(want)
  if (!same) failures += 1
  console.log(`${same ? 'ok  ' : 'FAIL'} ${name}` + (same ? '' : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`))
}

/** 临时的插件目录 (只放包内默认卡); 落在工作区 `.lwtmp` 下 —— 某些沙箱里 Node 在 %TEMP% 下建随机名字会 EPERM */
const scratch = join(root, '.lwtmp')
const made = []
async function tempDir(prefix) {
  await mkdir(scratch, { recursive: true })
  for (let i = 0; i < 100; i += 1) {
    const candidate = join(scratch, `${prefix}${process.pid}-${i}`)
    try {
      await mkdir(candidate)
      made.push(candidate)
      return candidate
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
    }
  }
  throw new Error('no temporary directory under .lwtmp')
}
const tree = join(await tempDir('lw-persona-tree-'), 'luwi-channel')
await mkdir(tree, { recursive: true })
await writeFile(join(tree, 'persona.txt'), '# packed card\n\n小鲸鱼默认卡\n', 'utf8')

/**
 * 造一份被测模块: `process` 是 stub (env 指临时 home, cwd 指临时树), 包内默认卡由 `PERSONA_PACKED`
 * 参数给进来 (线上那份是 `import.meta.url` 旁边的 persona.txt), 缓存每份独立
 */
function instance(homePath, cwd = tree, packed = join(tree, 'persona.txt')) {
  const proc = { env: homePath === null ? {} : { DSH_HOME: homePath }, cwd: () => cwd }
  return new Function(
    'join', 'dirname', 'readFileSync', 'statSync', 'mkdirSync', 'writeFileSync', 'process', 'console',
    'PERSONA_PACKED',
    `${section}\nreturn { homePath, personaCardPath, personaTextOf, readPersonaCard, packedPersonaText,`
      + ' personaFor, ensurePersonaCard, personaCache, PERSONA_MAX_CHARS, PERSONA_FALLBACK }',
  )(
    join, dirname, readFileSync, statSync, mkdirSync, writeFileSync, proc, { log() {}, warn() {} },
    packed,
  )
}
/** 一个空的 `$DSH_HOME` */
async function freshHome() {
  return tempDir('lw-persona-home-')
}

/** 卡文件路径 */
function cardPath(home) {
  return join(home, 'lw', 'persona', 'xiaojingyu.md')
}

/** 写一张卡 (目录不在就先建) */
function putCard(home, text) {
  mkdirSync(dirname(cardPath(home)), { recursive: true })
  writeFileSync(cardPath(home), text, 'utf8')
}

// ── 1. 卡在: 原样; 内容变了: 重读 ─────────────────────────────────────────
{
  const home = await freshHome()
  const a = instance(home)
  putCard(home, '第一版\n')
  check('设备卡在时原样返回', a.readPersonaCard(), '第一版')
  putCard(home, '第二版 (更长一点)\n')
  check('卡变了会重读 (mtime/size 变了)', a.readPersonaCard(), '第二版 (更长一点)')
  check(
    'personaFor 用设备卡',
    a.personaFor({ agent: { session: { meta: { agentPreset: 'luwi' } } } }),
    '第二版 (更长一点)',
  )
}

// ── 2. 卡不在: 包内默认 ───────────────────────────────────────────────────
{
  const a = instance(await freshHome())
  check('卡不在时读包内默认', a.readPersonaCard(), '')
  check('personaFor 退到包内默认', a.personaFor({}), '# packed card\n\n小鲸鱼默认卡')
}

// ── 3. 两个都不在: 四行兜底 ───────────────────────────────────────────────
{
  const a = instance(await freshHome(), '/nonexistent-tree', '/nonexistent/persona.md')
  check('没有卡也没有默认时回四行兜底', a.personaFor({}), a.PERSONA_FALLBACK)
  check('没有 DSH_HOME 时也给兜底', instance(null, '/nonexistent-tree', '/nonexistent/persona.md').personaFor({}), a.PERSONA_FALLBACK)
}

// ── 4. 超长截断 + 花括号安全 ──────────────────────────────────────────────
{
  const a = instance(await freshHome())
  const huge = 'x'.repeat(a.PERSONA_MAX_CHARS + 50)
  const cut = a.personaTextOf(huge)
  check('超长截断到上限', cut.startsWith('x'.repeat(a.PERSONA_MAX_CHARS)), true)
  check('截断带一行说明', cut.includes('已截断'), true)
  check('空卡回空串', a.personaTextOf('   \n'), '')
  check('卡里的 {{...}} 原样留着', a.personaTextOf('a {{b}} c'), 'a {{b}} c')
}

// ── 5. 分档 ────────────────────────────────────────────────────────────────
{
  const home = await freshHome()
  putCard(home, '卡\n')
  const a = instance(home)
  check('探索档一个字都不给', a.personaFor({ agent: { session: { meta: { agentPreset: 'explore' } } } }), '')
  check('主动档一个字都不给', a.personaFor({ agent: { session: { meta: { agentPreset: 'proactive' } } } }), '')
  check('没有 agent 时照给 (主会话)', a.personaFor({}), '卡')
}

// ── 6. 播种: 没有卡时从包内默认写一份; 已有内容不覆盖 ─────────────────────
{
  const home = await freshHome()
  const a = instance(home)
  const card = cardPath(home)
  const exists = () => {
    try {
      statSync(card)
      return true
    } catch {
      return false
    }
  }
  check('播种前没有文件', exists(), false)
  a.ensurePersonaCard()
  check('播种后文件在', a.readPersonaCard(), '# packed card\n\n小鲸鱼默认卡')
  writeFileSync(card, '主人改过的\n', 'utf8')
  a.personaCache.key = ''
  a.ensurePersonaCard()
  check('已有的卡不被播种覆盖', a.readPersonaCard(), '主人改过的')
}

// 自取自清: 临时目录全在 `.lwtmp` 下, 跑完删掉 (失败也删, 报告先打)
for (const dir of made.reverse()) await rm(dir, { recursive: true, force: true })

if (failures > 0) {
  console.error(`check-persona-live: FAIL (${failures}/${checks})`)
  process.exit(1)
}
console.log(`check-persona-live: PASS (${checks})`)
