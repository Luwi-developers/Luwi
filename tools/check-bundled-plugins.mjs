/**
 * 随包发的第三方插件 (2.7.8 批次 4)
 *
 * 现在有两个: 生图 `@dickpy/dsh-imagegen` 与记忆 `@modusensus/dsh-mneme`。后者是这一批新加的, 而
 * "加一个随包插件"这件事有**四段接缝**, 每一段漂开了都不会当场报错, 只会在设备上变成"这个功能
 * 整块不见了"或者"工作区里多出一坨东西":
 *
 *   1. **树里得有它**: `tools/pack-host.mjs` 把它取进 `node_modules/<包名>`, 并且**装完 import 一次**
 *      —— 少一个运行时依赖时 npm 不会说话, 到加载时才抛
 *   2. **挂的那一层要对**: 配置要在 dsh 设置面板里改得动的那些行必须写进 **profile 自己的 patch**
 *      (`PluginRows`), 不能写进命令行覆盖层 —— 写在那一层上面时 config-editor 会回
 *      "overridden by a home patch or command-line overlay"
 *   3. **盘上 `name:` 要是 `file://` 形态**: dsh 读 patch 时会把绝对路径锚成 URL, 而面板追加的
 *      config 行抄的是锚过之后那个名字 —— 盘上留裸路径, 那条 config 行会被按 "name mismatch" 丢掉
 *   4. **数据目录不许落在工作区**: mneme 的缺省记忆库是 `~/.dsh/memory` 而 `HOME` 指着工作区, 所以
 *      它的 `memoryDir` 由 `PluginRows` 按本机 filesDir 代写成绝对路径; 自管运行时那一档走
 *      `DSH_MNEME_RUNTIME_DIR`, 由 `DshHost` 给
 *
 * 另外它只用 `node:sqlite` (`lib/store.js` 的 `DatabaseSync`), 所以随包的 node 必须带那个内建模块
 * — 这一条拿不到源码里核, 是在真机上量的 (2026-10-17, node v26.4.0 上 ok)
 *
 * 不需要设备, 也不需要 host: 全是拿真源码对着核。
 *
 * 用法: node tools/check-bundled-plugins.mjs
 */

import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')

const packer = await read('tools/pack-host.mjs')
const rows = await read('app/src/main/java/io/github/yuloong07star/luwi/host/PluginRows.kt')
const overlay = await read('app/src/main/java/io/github/yuloong07star/luwi/host/PluginOverlay.kt')
const host = await read('app/src/main/java/io/github/yuloong07star/luwi/host/DshHost.kt')

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

/* ── 一、取进树的那两样 ────────────────────────────────────────────────── */

const image = /const imagePlugin = \{ name: '([^']+)', version: '([^']+)' \}/.exec(packer)
const mneme = /const mnemePlugin = \{ name: '([^']+)', version: '([^']+)' \}/.exec(packer)

check('生图插件仍按自己那份声明取进树', [image?.[1], image?.[2]], ['@dickpy/dsh-imagegen', '1.15.6'])
check('记忆插件按自己那份声明取进树', [mneme?.[1], mneme?.[2]], ['@modusensus/dsh-mneme', '0.12.0'])

// 2026-10-30 主人: "删除 ourfreemodel 这个随包插件" —— 三处接缝 (取包 / 挂行 / 贴 config) 一起撤,
// 钉一条"它不在"的判据, 免得将来谁又把它按老文档加回去. 撤下的那一行还得从老设备上摘掉: OWNED 只管
// 还在发的几行, 所以另有一张 RETIRED 表 (真机上不摘的表现是每次起 host 一句 "1 entry did not activate")
check(
  '免费模型插件已经撤出随包 (取包那一段 / OWNED 那一行 / managed config 都不在), 且老设备上的行会被摘',
  [
    packer.includes('freeModelPlugin'),
    /Owned\(\s*"free-model"/u.test(rows),
    rows.includes('MANAGED_DISTRIBUTION'),
    rows.includes('private val RETIRED = listOf("free-model" to "dsh-our-free-model")'),
    rows.includes('val next = retired(patch, id, packageName, root.absolutePath)'),
  ],
  [false, false, false, true, true],
)

check(
  '两个包都走 `npm pack` + 解 tarball (不装依赖树), 并且各自 import 一次',
  [
    (packer.match(/'pack',\n\s+`\$\{imagePlugin\.name\}@\$\{imagePlugin\.version\}`/g) ?? []).length,
    packer.includes('`npm pack produced no tarball for ${mnemePlugin.name}'),
    packer.includes('await import(pathToFileURL(join(mnemeRoot, mnemeEntry)).href)'),
    packer.includes('await import(pathToFileURL(join(imageRoot, imageEntry)).href)'),
  ],
  [1, true, true, true],
)

check(
  '记忆插件裁掉的是"只有开发时才用"的那四样 (docs / test / src / scripts 里除运行时那一个 / lib 的 map)',
  [
    packer.includes("for (const name of ['docs', 'test', 'src']) rmSync(join(mnemeRoot, name)"),
    packer.includes("if (name !== 'mneme-runtime.mjs') rmSync(join(mnemeRoot, 'scripts', name)"),
    packer.includes("if (name.endsWith('.map')) rmSync(join(mnemeRoot, 'lib', name)"),
  ],
  [true, true, true],
)

// 2026-10-16 主人在手机上手工装过一份 (plugins-src + 裸包名那一行): 两行同时挂在启动时会报
// "an adapter for provider ... is already registered", 谁先全看 patch 次序 —— 所以被占时我们让位
check(
  '同一个包已被别人挂着时, 随包那一行主动让位 (不删别人的行)',
  [
    rows.includes('fun mountsPackage(patch: String, packageName: String, exceptId: String = ""): Boolean'),
    rows.includes('val mountedByRow = mountsPackage(patch, row.packageName, row.id)'),
    rows.includes('taken && hasInsertRow(patch, row.id) -> withoutRow(patch, row.id)'),
    rows.includes('fun packageOf(value: String): String'),
  ],
  [true, true, true, true],
)

// 2026-10-25 主人: "对于预装的插件要先检查本体有没有才安装, 不覆盖安装" —— 光看 patch 行不够,
// 主人自己那份可能只落在 profile 的 node_modules 里 (软链到 plugins-src), 而那一份同样会被 loader 解析
check(
  '先看本体: profile 里指向树外的那一份算"已经装了", 随包这行不覆盖也不装',
  [
    rows.includes('val userCopy = if (mountedByRow) null else userInstallOf(context, row.packageName, root)'),
    rows.includes('val taken = mountedByRow || userCopy != null'),
    rows.includes('fun isUserCopy(candidate: String, hostRoot: String): Boolean'),
    // 判的是解析之后的真实路径: 软链绕回树里那份时不能算成"主人的"
    rows.includes('candidate.canonicalPath'),
  ],
  [true, true, true, true],
)

/* ── 二、挂在哪一层 ────────────────────────────────────────────────────── */

/** `PluginRows` 的 OWNED 表: 每一行的 id 与入口 (config 那一段另算) */
const owned = [...rows.matchAll(/Owned\(\s*"([^"]+)",\s*"([^"]+)"/g)].map((one) => [one[1], one[2]])

check(
  'profile patch 里那两行指的都是树里的入口文件',
  owned,
  [
    ['imagegen', 'node_modules/@dickpy/dsh-imagegen/lib/index.js'],
    ['mneme', 'node_modules/@modusensus/dsh-mneme/lib/index.js'],
  ],
)

// 面板要能改的行挂在覆盖层上就永远存不进去, 见文件头第 2 条
check(
  '这两行都不在覆盖层那两张表里',
  [
    (overlay.match(/Row\("imagegen"/g) ?? []).length,
    (overlay.match(/Row\("mneme"/g) ?? []).length,
  ],
  [0, 0],
)

check(
  '盘上写的是 file:// 形态 (即 Loader 眼里那个名字)',
  [rows.includes('append("file://")'), rows.includes("name: '$name'")],
  [true, true],
)

/* ── 三、记忆库与运行时都不许落在工作区 ────────────────────────────────── */

check(
  'mneme 那一行由本应用代写 memoryDir (落在 $DSH_HOME/memory 里)',
  [
    rows.includes('config = ::memoryConfig'),
    rows.includes('memoryDir: \'${File(File(context.filesDir, DshHost.HOME_DIR), "memory").absolutePath}\''),
    rows.includes('config.forEach { add("        $it") }'),
  ],
  [true, true, true],
)

check(
  '自管运行时那一档由 DshHost 钉到 $DSH_HOME 里 (DSH_MNEME_RUNTIME_DIR)',
  [
    host.includes('put("DSH_MNEME_RUNTIME_DIR", File(File(home, "mneme"), "runtime").absolutePath)'),
  ],
  [true],
)

/* ── 三之二、酒馆会话不进记忆库 (2026-10-29) ─────────────────────────────── */

// 酒馆一场存档就是一场 DSH 会话 (preset 是 `tavern`), 而 mneme 的 autoSummarize 在每场会话的
// turn/end 上蒸馏写库 —— 主人报的"酒馆的对话进入记忆库了"就是这一条. 上游 0.9.0 没有"按 preset
// 排除"的配置, 所以由 pack-host 打三处补丁 (config / 蒸馏 / 注入), 配置那一半由 PluginRows 写
check(
  'mneme 补丁: 三处锚点都在, 缺省排除 tavern, 且上游自己实现了就跳过 (不硬打第二套语义)',
  [
    [
      'autoSummarize: z.boolean().default(true),',
      'async function summarize(session, triggerEvent, opts = {}) {',
      'text: (ctx) => {',
    ].filter((anchor) => !packer.includes(anchor)),
    packer.includes("excludeAgentPresets: z.array(z.string()).default(['tavern'])"),
    packer.includes('already carries excludeAgentPresets'),
    packer.includes('so tavern sessions stay out of memory'),
  ],
  [[], true, true, true],
)

check(
  'profile 里那一行把 tavern 排除掉 (排除按 preset 判, 不碰别的会话)',
  rows.includes("excludeAgentPresets: ['tavern']"),
  true,
)

// 面板前端就用 0.9.4 自带那一份 (2026-10-29 主人: "只用0.9.4即可"); 它在 rc.3 基座上渲染不出记忆
// 列表那一块, 这一档显示问题接受, 但**不许**为了面板好看把 client.js 换回 0.9.0 (那会把 0.9.4 的
// 新功能连设置项一起藏掉). 这条判据钉的是"没有那层替换"
check(
  '面板前端就是 0.9.4 自带那一份 (没有换回 0.9.0 的替换层)',
  [
    packer.includes('mnemeClientPlugin'),
    packer.includes("join(mnemeRoot, 'lib', 'client.js')"),
  ],
  [false, false],
)

// 产物级: 树在、且树里那份已经是声明的版本时才查 (旧树是升级前的, 查它只会红给"还没重新构建")
const treeMneme = 'app/build/host-tree/node_modules/@modusensus/dsh-mneme'
const patchedMneme = await read(`${treeMneme}/lib/config.js`).catch(() => null)
const treeManifest = await read(`${treeMneme}/package.json`).catch(() => null)
if (patchedMneme === null || treeManifest === null) {
  console.log('skip  树里还没有 mneme (先跑一次构建), 产物级补丁判据跳过')
} else if (JSON.parse(treeManifest).version !== mneme?.[2]) {
  console.log(
    `skip  树里那份 mneme 是 ${JSON.parse(treeManifest).version}, 还不是声明的 ${mneme?.[2]};`
      + ' 重新构建一次再查产物级补丁',
  )
} else {
  check('树里那份 mneme 真的带着 excludeAgentPresets', patchedMneme.includes('excludeAgentPresets'), true)
}

/* ── 四、别人那几行别被顺手改了 ─────────────────────────────────────────── */

check(
  '拆行那几段仍然是"只动 insert 段里自己那一行"',
  [
    rows.includes('fun withoutRow(patch: String, rowId: String): String'),
    rows.includes('val shell = (at - 1 downTo 0).firstOrNull { indentOf(lines[it]) < indent'),
  ],
  [true, true],
)

console.log(`\n${checks - failures} / ${checks} 通过`)
if (failures > 0) process.exit(1)
