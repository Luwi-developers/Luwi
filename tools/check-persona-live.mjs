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
      + ' personaFor, ensurePersonaCard, personaCache, PERSONA_MAX_CHARS, PERSONA_FALLBACK,'
      + ' personaCoreOf, personaForPreset, PERSONA_PRESETS, readAffectBlock, affectPromptCache }',
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

// ── 5. 分档: 会说话的两档共用同一张卡 (2026-11-20 方案 §4) ──────────────────
{
  const home = await freshHome()
  putCard(home, '开头一句\n\n## 二之二、她这个人\n慢热但稳\n\n## 三、事实\n主动场不该读这一节\n')
  const a = instance(home)
  check('探索档一个字都不给', a.personaFor({ agent: { session: { meta: { agentPreset: 'explore' } } } }), '')
  check('酒馆档一个字都不给', a.personaFor({ agent: { session: { meta: { agentPreset: 'tavern' } } } }), '')
  check('没有 agent 时照给全文 (主会话)', a.personaFor({}).startsWith('开头一句'), true)
  check('对话场给全文', a.personaFor({ agent: { session: { meta: { agentPreset: 'luwi' } } } }).includes('## 三、事实'), true)
  check('主动场只给「二之二」那一段 (方案 §4.3)', a.personaFor({ agent: { session: { meta: { agentPreset: 'proactive' } } } }), '## 二之二、她这个人\n慢热但稳')
  const another = await freshHome()
  putCard(another, '只有一张普通卡\n')
  check('主动场没有「二之二」时退全文 (宁可多给, 不可空着)',
    instance(another).personaFor({ agent: { session: { meta: { agentPreset: 'proactive' } } } }),
    '只有一张普通卡')
}

// ── 8. 对话场末尾拼一段〔此刻〕(2026-11-20 方案 §5.5) ─────────────────────
{
  const home = await freshHome()
  putCard(home, '卡正文\n')
  const a = instance(home)
  const luwi = { agent: { session: { meta: { agentPreset: 'luwi' } } } }
  check('没有 affect.json 时只有卡', a.personaFor(luwi), '卡正文')
  mkdirSync(dirname(join(home, 'lw', 'memory', 'affect.json')), { recursive: true })
  writeFileSync(join(home, 'lw', 'memory', 'affect.json'),
    JSON.stringify({ v: 1, at: 1, block: '〔此刻〕他在打游戏' }), 'utf8')
  check('有 affect.json 时拼在卡后面', a.personaFor(luwi), '卡正文\n\n〔此刻〕他在打游戏')
  check('主动场不拼这一段 (它走开场正文)', a.personaFor({ agent: { session: { meta: { agentPreset: 'proactive' } } } }), '卡正文')
  writeFileSync(join(home, 'lw', 'memory', 'affect.json'), '{ 坏掉的 json', 'utf8')
  a.affectPromptCache.key = ''
  check('affect.json 坏了只剩卡 (状态不许把人设带走)', a.personaFor(luwi), '卡正文')
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

// ── 7. 默认卡那份正文 ──────────────────────────────────────────────────────
{
  // 2026-11-20: 语气那一条从主动场提示词 (persona 第 14 条) 搬进了人格卡 —— 卡里必须在
  const card = readFileSync(join(root, 'presets', 'luwi', 'persona', 'xiaojingyu.md'), 'utf8')
  check('默认卡里有语气那一条 (从主动场提示词搬过来的)', [
    card.includes('- **语气柔和客气**: 不催他, 不哄他, 不煽情, 也别连着发好几条'),
    card.includes('他要是不想理会, 也不会觉得被催'),
  ], [true, true])
  check('默认卡还写着"先像人, 再像小鲸鱼" (最高原则没被搬动)', card.includes('先像人, 再像小鲸鱼'), true)
}

// 自取自清: 临时目录全在 `.lwtmp` 下, 跑完删掉 (失败也删, 报告先打)
for (const dir of made.reverse()) await rm(dir, { recursive: true, force: true })

if (failures > 0) {
  console.error(`check-persona-live: FAIL (${failures}/${checks})`)
  process.exit(1)
}
console.log(`check-persona-live: PASS (${checks})`)
