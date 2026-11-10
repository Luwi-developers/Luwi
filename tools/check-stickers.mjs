/**
 * "她自己攒表情"那一条的判据表 (2026-11-10, 方案 F)
 *
 * 那一批补的是断掉的中间一环: `lw_sticker` 原来只有 `list` / `say`, 素材全靠主人往
 * `$DSH_HOME/lw/stickers` 里放; 而 `lw_download` 落的是系统下载目录 (共享存储), 拿不到 app 私有目录.
 * `op=fetch` 就是"网络上的一张图 -> 那个目录"这条路
 *
 * 这条路有三样东西**静默坏掉**最贵, 所以逐样钉:
 *
 *   1. **类型按魔数判**: URL 后缀是调用方随手写的, 一张名义 `.png` 的 jpeg 落进目录之后, 应用照
 *      `.png` 去解会得到空图, 而盘上看不出哪里错了
 *   2. **名字受限**: 带斜杠 / 点 / 空格的名字不许进目录 (`lw_say` 按裸名字引用, 带路径的名字它不认)
 *   3. **三道上限**: 单张 2 MB / 目录 200 张 / 总 40 MB —— 与 `BallStickers.MAX_BYTES`、门户那条
 *      加表情的路是同一个数
 *
 * 跑法: `node tools/check-stickers.mjs`
 * 它**直接取 `host-plugin/index.mjs` 里那一段源码来跑** (不复制第二份) 另外用几行正则钉住源码里那
 * 几道闸, 所以测的是上线那一份
 */

import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')

const host = await read('host-plugin/index.mjs')
const simSetting = await read('app/src/main/java/io/github/yuloong07star/luwi/tool/SimSetting.kt')
const ball = await read('app/src/main/java/io/github/yuloong07star/luwi/overlay/BallStickers.kt')
const portal = await read('app/src/main/java/io/github/yuloong07star/luwi/ui/PortalBridge.kt')
const page = await read('app/src/main/java/io/github/yuloong07star/luwi/ui/SimSettingsScreen.kt')
const persona = await read('presets/luwi/cordis.patch.yml')

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

/* ── 一、抽那一段纯函数 ─────────────────────────────────────────────────── */

const start = host.indexOf('/* ── 她攒的表情')
// 切到下一段的注释开头为止 (不能切进那一段注释里: 半截注释会让 `new Function` 直接报语法错)
const end = host.indexOf('/**\n * 把模型给的那一份**复制**', start)
if (start < 0 || end < 0 || end < start) {
  console.error('FAIL the sticker block is not in host-plugin/index.mjs any more')
  process.exit(1)
}
const section = host.slice(start, end)
const api = new Function(
  `${section}\nreturn { stickerExtOf, stickerNameOf, STICKER_MAX_BYTES, STICKER_MAX_COUNT,`
    + ' STICKER_DIR_MAX_BYTES, STICKER_FETCH_TIMEOUT_MS, STICKER_FILE_OK, STICKER_NAME_OK,'
    + ' STICKER_MB_RANGE, STICKER_COUNT_RANGE }',
)()

/** `lw_sticker` 那一条工具定义 (描述 + 参数表 + execute): 那几道闸都在这里面 */
const tool = host.slice(host.indexOf("name: 'lw_sticker'"), host.indexOf("name: 'lw_say'"))
if (tool === '') {
  console.error('FAIL the lw_sticker tool is not in host-plugin/index.mjs any more')
  process.exit(1)
}

/* ── 二、类型只认字节 ───────────────────────────────────────────────────── */

const pad = (prefix, size = 16) => Buffer.concat([Buffer.from(prefix, 'ascii'), Buffer.alloc(size)])
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0])
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
const gif = pad('GIF89a')
const webp = Buffer.concat([
  Buffer.from('RIFF', 'ascii'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBP', 'ascii'), Buffer.alloc(8),
])

check('四种图各按魔数认出来', [
  api.stickerExtOf(png),
  api.stickerExtOf(jpg),
  api.stickerExtOf(gif),
  api.stickerExtOf(webp),
], ['png', 'jpg', 'gif', 'webp'])

check('认不出来的 (文本 / 太短 / 空) 一律回空串', [
  api.stickerExtOf(Buffer.from('这不是一张图, 只是几十个字节的文字而已啊', 'utf8')),
  api.stickerExtOf(Buffer.from([0x89, 0x50])),
  api.stickerExtOf(Buffer.alloc(0)),
  api.stickerExtOf('not a buffer'),
], ['', '', '', ''])

/* ── 三、名字 ───────────────────────────────────────────────────────────── */

check('名字取 URL 的 basename, 扩展名丢掉', [
  api.stickerNameOf('', 'https://example.com/a/开心.gif'),
  api.stickerNameOf('', 'https://example.com/a/cat.webp?size=200'),
  api.stickerNameOf('', 'https://example.com/%E7%AC%91%E5%93%AD.jpg'),
], ['开心', 'cat', '笑哭'])

check('给了 name 就用它, 扩展名照样丢', [
  api.stickerNameOf('她的小猫.png', 'https://example.com/x/a.gif'),
  api.stickerNameOf('sticker_1', 'https://example.com/a.gif'),
], ['她的小猫', 'sticker_1'])

check('带路径 / 点 / 空格 / 太长 / 空的一律拒', [
  api.stickerNameOf('a/b', 'https://example.com/a.gif'),
  api.stickerNameOf('../x', 'https://example.com/a.gif'),
  api.stickerNameOf('a b', 'https://example.com/a.gif'),
  api.stickerNameOf('.hidden', 'https://example.com/a.gif'),
  api.stickerNameOf('一'.repeat(25), 'https://example.com/a.gif'),
  api.stickerNameOf('', 'https://example.com/'),
  api.stickerNameOf('😀', 'https://example.com/a.gif'),
], ['', '', '', '', '', '', ''])

check('24 字正好收下 (边界在这一头)', api.stickerNameOf('一'.repeat(24), 'https://example.com/a.gif'),
  '一'.repeat(24))

/* ── 四、三道上限与那两道闸 (源码) ─────────────────────────────────────── */

check('单张上限的缺省是 2 MB, 而真值由 更多设置 → 表情 那一格给', [
  api.STICKER_MAX_BYTES,
  /const val MAX_BYTES = 2L \* 1024 \* 1024/.test(ball),
  /private val STICKER_MAX_BYTES = 2 \* 1024 \* 1024/.test(portal),
  /val STICKER_MB_RANGE = 1\.\.20/.test(simSetting),
  /const val STICKER_MAX_MB = 2/.test(simSetting),
], [2 * 1024 * 1024, true, true, true, true])

check('三处读者都读同一格 (下载闸 / 解码闸 / 门户那条加表情的路)', [
  /fun capBytes\(context: Context\): Long = runCatching \{/.test(ball),
  /SimSetting\.plan\(context\)\.sticker\.maxBytes/.test(ball),
  /private fun stickerCap\(\): Long = runCatching \{ SimSetting\.plan\(context\)\.sticker\.maxBytes \}/.test(portal),
  /const limits = await readLwStickerLimits\(\)/.test(tool),
], [true, true, true, true])

check('设置页那两行在 (标题 / 说明 / 范围 / 落盘)', [
  /settings_sim_sticker_group/.test(page),
  /settings_sim_sticker_max_summary,/.test(page),
  /range = SimSetting\.STICKER_MB_RANGE/.test(page),
  /plan\.copy\(sticker = plan\.sticker\.copy\(maxMb = it\)\)/.test(page),
  // 2026-11-10 主人: "表情包加上数量限制"
  /settings_sim_sticker_count_summary,/.test(page),
  /range = SimSetting\.STICKER_COUNT_RANGE/.test(page),
  /plan\.copy\(sticker = plan\.sticker\.copy\(maxCount = it\)\)/.test(page),
], [true, true, true, true, true, true, true])

check('张数的缺省 200 / 范围 20..500, 超了拒并列出最旧的五张', [
  api.STICKER_MAX_COUNT,
  api.STICKER_COUNT_RANGE,
  api.STICKER_DIR_MAX_BYTES,
  /the oldest are \$\{oldest\.join\(', '\)\}/.test(tool),
  /the limit is\s*\+? ?`? \$\{limits\.maxCount\}/.test(tool) || /\$\{limits\.maxCount\} in 更多设置/.test(tool),
], [200, [20, 500], 40 * 1024 * 1024, true, true])

check('两个写入方都按张数拦 (她 op=fetch / 门户里加)', [
  /held\.length >= limits\.maxCount/.test(tool),
  /private fun stickerMaxCount\(\): Int = runCatching \{ SimSetting\.plan\(context\)\.sticker\.maxCount \}/.test(portal),
  /if \(present >= maxCount\)/.test(portal),
  /val maxCount = stickerMaxCount\(\)/.test(portal),
], [true, true, true, true])

check('只收 https, GET, 8 秒超时', [
  api.STICKER_FETCH_TIMEOUT_MS,
  /if \(!url\.startsWith\('https:\/\/'\)\) throw new Error/.test(tool),
  /AbortSignal\.timeout\(STICKER_FETCH_TIMEOUT_MS\)/.test(tool),
  /redirect: 'follow'/.test(tool),
], [8000, true, true, true])

check('体积两头都看: content-length 预检 + 读完之后再量一次', [
  /response\.headers\.get\('content-length'\)/.test(tool),
  (tool.match(/over the \$\{capMb\} MB limit/gu) ?? []).length >= 2,
], [true, true])

// 2026-11-10 主人要的"表情包图片上限设置"与"表情包加上数量限制": 两条都读 更多设置 → 表情 那一格
check('单张与张数都读 更多设置 那一格 (不是写死的 2 MB / 200 张)', [
  /async function readLwStickerLimits\(\)/.test(host),
  /const limits = await readLwStickerLimits\(\)/.test(tool),
  /const mb = clamp\(raw\?\.maxMb, STICKER_MB_RANGE,/.test(host),
  /maxCount: clamp\(raw\?\.maxCount, STICKER_COUNT_RANGE, STICKER_MAX_COUNT\)/.test(host),
  api.STICKER_MB_RANGE,
  api.STICKER_COUNT_RANGE,
], [true, true, true, true, [1, 20], [20, 500]])

check('落盘是 .tmp + rename, 写完读回字节数', [
  /const temporary = temporaryName\(join\(folder, target\)\)/.test(tool),
  /await rename\(temporary, join\(folder, target\)\)/.test(tool),
  /saved\.size !== bytes\.length/.test(tool),
], [true, true, true])

check('同名覆盖 = "换一张": 已经在目录里就不算新增, 也不再占一格', [
  /!held\.some\(\(one\) => one\.name === target\) && held\.length >= limits\.maxCount/.test(tool),
  /held\.filter\(\(one\) => one\.name !== target\)/.test(tool),
], [true, true])

check('回执说清"存下了, 但没贴出去"', [
  /op=list shows it; lw_say \{sticker:"\$\{target\}"\} puts it in the conversation/.test(tool),
  /this call/.test(tool),
], [true, true])

/* ── 五、工具面与那张闸表 ───────────────────────────────────────────────── */

check('参数表有 url 与 name, op 三档', [
  /url: \{/.test(tool),
  /name: \{/.test(tool),
  /enum: \['list', 'fetch', 'say'\]/.test(tool),
], [true, true, true])

check('三张表里那只 B 表认识它 (list / say 是只读那一面, fetch 要 act 以上)', [
  /'lw_sticker', new Set\(\['list', 'say'\]\)/.test(host),
], [true])

check('persona 教的是"攒下来仍然用 lw_say 贴"', [
  /lw_sticker op=fetch/.test(persona),
  /lw_say\(\{ sticker/.test(persona),
  /op=list/.test(persona),
], [true, true, true])

check('应用侧那张白名单与本条同一个集合 (png / gif / webp / jpg)', [
  api.STICKER_FILE_OK.source,
  api.STICKER_FILE_OK.test('a.png'),
  api.STICKER_FILE_OK.test('a.JPEG'),
  api.STICKER_FILE_OK.test('a.txt'),
], ['\\.(png|gif|webp|jpg|jpeg)$', true, true, false])

console.log(`\n${checks - failures} / ${checks} 条通过`)
if (failures > 0) process.exit(1)
