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
const proactive = await read('presets/proactive/cordis.patch.yml')
const said = host.slice(host.indexOf("name: 'lw_say'"), host.indexOf("name: 'lw_persona'"))
const stringsZh = await read('app/src/main/res/values-zh/strings.xml')
const stringsEn = await read('app/src/main/res/values/strings.xml')

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
    + ' STICKER_MB_RANGE, STICKER_COUNT_RANGE,'
    + ' stickerStemOf, stickerWordHit, stickerTagsOf, pickSticker, stickerTagMapOf,'
    + ' stickerMoodLine, stickerCatalogText, STICKER_TAG_OK, STICKER_TAG_MAX,'
    + ' stickerUntaggedOf, stickerUntaggedText,'
    + ' STICKER_EVERY_N, STICKER_EVERY_RANGE, STICKER_PROMPT_LIMIT }',
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

check('参数表有 url / name / query / tags, op 五档', [
  /url: \{/.test(tool),
  /name: \{/.test(tool),
  /query: \{/.test(tool),
  /tags: \{/.test(tool),
  /enum: \['list', 'pick', 'tag', 'fetch', 'say'\]/.test(tool),
], [true, true, true, true, true])

check('三张表里那只 B 表认识它 (list / say / pick 是只读那一面, fetch 与 tag 要 act 以上)', [
  /'lw_sticker', new Set\(\['list', 'say', 'pick'\]\)/.test(host),
  !/'lw_sticker', new Set\(\[[^\]]*'tag'/.test(host),
], [true, true])

check('persona 教的是"攒下来仍然用 lw_say 贴", 而且不必先列目录', [
  /lw_sticker op=fetch/.test(persona),
  /lw_say\(\{ sticker/.test(persona),
  /op=list/.test(persona),
  /不必先列/.test(persona),
  /lw_sticker op=tag/.test(persona),
  /多久贴一张/.test(persona),
  /\{\{lw_stickers\}\}/.test(persona),
  /\{\{lw_stickers\}\}/.test(proactive),
], [true, true, true, true, true, true, true, true])

check('应用侧那张白名单与本条同一个集合 (png / gif / webp / jpg)', [
  api.STICKER_FILE_OK.source,
  api.STICKER_FILE_OK.test('a.png'),
  api.STICKER_FILE_OK.test('a.JPEG'),
  api.STICKER_FILE_OK.test('a.txt'),
], ['\\.(png|gif|webp|jpg|jpeg)$', true, true, false])

/* ── 六、按情绪词挑一张 (2026-11-15 主人: "当前发送表情包的概率太小") ────── */

// 那一批补的是"她会贴"而不是"她能贴": 库有了、通道有了、渲染有了, 只差三样 —— 不必先列目录就知道
// 有什么 (提示词变量), 说一句情绪词就能挑到一张 (pickSticker), 挑不到时当场回候选。这三样都不会崩,
// 崩起来都是"静默不贴", 所以逐样钉

const lib = [
  { name: '开心.png', tags: ['开心', '赞'] },
  { name: '无语.gif', tags: ['无语', '难绷'] },
  { name: '晚安.webp', tags: ['晚安', '困'] },
  { name: 'a.png', tags: [] },
]

check('挑一张: 准确文件名与去掉扩展名的名字都逐字命中', [
  api.pickSticker(lib, '开心.png', () => 0)?.name,
  api.pickSticker(lib, '开心', () => 0)?.name,
  api.pickSticker(lib, '晚安.webp', () => 0)?.name,
], ['开心.png', '开心.png', '晚安.webp'])

check('挑一张: 标签命中, 名字里带着这个词也命中', [
  api.pickSticker(lib, '赞', () => 0)?.name,
  api.pickSticker(lib, '难绷', () => 0)?.name,
  api.pickSticker(lib, '无', () => 0)?.name,
], ['开心.png', '无语.gif', '无语.gif'])

check('挑一张: 多张命中随机取一张 (rand 头取第一, 尾取最后)', [
  api.pickSticker([{ name: 'a1.png', tags: ['开心'] }, { name: 'a2.png', tags: ['开心'] }], '开心', () => 0)?.name,
  api.pickSticker([{ name: 'a1.png', tags: ['开心'] }, { name: 'a2.png', tags: ['开心'] }], '开心', () => 0.99)?.name,
], ['a1.png', 'a2.png'])

check('挑一张: 单字的拉丁名不许乱命中 (a 不命中 happy), 对不上就回 null', [
  api.pickSticker(lib, 'happy', () => 0),
  api.pickSticker(lib, '完全没有这个词', () => 0),
  api.pickSticker([], '开心', () => 0),
  api.pickSticker(lib, '  ', () => 0),
], [null, null, null, null])

check('挑一张: 叫"开心"的那张也找得到"不开心"这种反话', api.pickSticker(lib, '不开心', () => 0)?.name,
  '开心.png')

check('标签只收干净的那几条 (去重 / 切空白与标点 / 限 6 条)', [
  api.stickerTagsOf(['开心', '开心', '赞']),
  api.stickerTagsOf('开心 赞、无语'),
  api.stickerTagsOf(['坏/的', 'has space', '', 'ok_1']),
  api.stickerTagsOf(Array.from({ length: 9 }, (_, i) => `t${i}`)).length,
], [['开心', '赞'], ['开心', '赞', '无语'], ['ok_1'], api.STICKER_TAG_MAX])

check('标签账读坏了不废整本 (坏值当没有, 好名字留着)', [
  api.stickerTagMapOf({ '开心.png': { tags: ['开心', '赞'], used: 2, lastUsedAt: 5 }, 'x.png': 'nope' }),
  api.stickerTagMapOf(null),
], [{ '开心.png': { tags: ['开心', '赞'], used: 2, lastUsedAt: 5 } }, {}])

check('目录摘要给的是名字 + 标签 + 用过几次, 库再大也只列 30 张', [
  api.stickerCatalogText([{ name: '开心.png', tags: ['开心'], used: 3 }, { name: '无语.gif', tags: [], used: 0 }]),
  api.STICKER_PROMPT_LIMIT,
  api.stickerCatalogText(Array.from({ length: 40 }, (_, i) => ({ name: `s${i}.png`, tags: [] })))
    .split(' / ').length,
], ['开心（开心·用过3次） / 无语', 30, 30])

check('lw_say 收的是"文件名或词", 一律先过一遍库', [
  /const stickerRaw = String\(args\?\.sticker \?\? ''\)\.trim\(\)/.test(said),
  /await resolveStickerForSay\(stickerRaw\)/.test(said),
  /const hit = pickSticker\(entries, query\)/.test(host),
], [true, true, true])

check('挑不到就把库里的候选带回去 (把静默失败换成教学反馈)', [
  /nothing matched "\$\{query\}": the folder has/.test(host),
  /she has no stickers yet/.test(host),
], [true, true])

check('说一句再补一张: 文字行写完照样追加一条表情行, 表情自己一个气泡 (不带占位正文)', [
  /if \(sticker !== '' && problems\.length === 0\) \{/.test(said),
  /\{ kind: 'sticker', sticker \}\)/.test(said) && !/text: '\[…\]'/.test(said),
  /including the sticker \$\{sticker\}/.test(said),
  /void markStickerUsed\(/.test(said),
], [true, true, true, true])

check('贴出去记一次账, 标签账落在同目录的 tags.json (它不占张数也不当图)', [
  /async function markStickerUsed\(folder, name\)/.test(host),
  /async function readStickerTags\(folder\)/.test(host),
  /async function writeStickerTags\(folder, map\)/.test(host),
  /const STICKER_TAG_FILE = 'tags\.json'/.test(host),
  api.STICKER_FILE_OK.test('tags.json'),
], [true, true, true, true, false])

check('提示词变量 lw_stickers 注册在 lw_persona 旁边, 只喂会说话的那两档', [
  /scope\.systemPrompt\.variable\('lw_stickers', stickersFor\)/.test(host),
  /function stickersFor\(context\)/.test(host),
  /preset !== 'luwi' && preset !== 'proactive'/.test(host),
  /\{\{lw_stickers\}\}/.test(persona),
  /\{\{lw_stickers\}\}/.test(proactive),
], [true, true, true, true, true])

check('密度那一格: 0 = 不贴, 缺省每 4 条一张, 范围 0..20, 设置页与 sim.json 都认', [
  /不要贴表情/.test(api.stickerMoodLine(0)),
  api.stickerMoodLine(4).includes('每 4 条'),
  api.stickerMoodLine(9).includes('每 9 条'),
  api.STICKER_EVERY_N,
  api.STICKER_EVERY_RANGE,
  /val STICKER_EVERY_RANGE = 0\.\.20/.test(simSetting),
  /const val STICKER_EVERY_N = 4/.test(simSetting),
  /everyN = sticker\.int\("everyN", Default\.STICKER_EVERY_N, STICKER_EVERY_RANGE\)/.test(simSetting),
  /put\("everyN", plan\.sticker\.everyN\)/.test(simSetting),
], [true, true, true, 4, [0, 20], true, true, true, true])

check('设置页多一行「多久贴一张」, 两种语言的键都在', [
  /settings_sim_sticker_every\b/.test(page),
  /settings_sim_sticker_every_summary,/.test(page),
  /range = SimSetting\.STICKER_EVERY_RANGE/.test(page),
  /plan\.sticker\.copy\(everyN = it\)/.test(page),
  /settings_sim_sticker_every_summary/.test(stringsZh),
  /settings_sim_sticker_every_summary/.test(stringsEn),
], [true, true, true, true, true, true])

/* ── 七、没标签的图 (2026-11-16 主人: "使用表情包时列出没有标签的图, 有就顺便标上") ────────── */

// 一张没有标签的图对"情绪词检索"等于不存在 (只认文件名, 而她的名字常常是流水号), 所以
// 三处都要点名: 提示词摘要 / op=list / 贴出去的回执 —— 最后那条是最便宜的"顺手标"落点

check('未标名单: 只挑 tags 空的, 压成一行, 超过 6 张就 +N, 全标了回空串', [
  api.stickerUntaggedText([{ name: 'a.jpg', tags: [] }, { name: 'b.png', tags: ['开心'] }]),
  api.stickerUntaggedText([{ name: 'a.jpg', tags: ['开心'] }, { name: 'b.png', tags: ['赞'] }]),
  api.stickerUntaggedText([]),
  api.stickerUntaggedText(Array.from({ length: 9 }, (_, i) => ({ name: `s${i}.png`, tags: [] }))),
  api.stickerUntaggedOf([{ name: 'a.jpg', tags: [] }, { name: 'b.png', tags: ['开心'] }]).length,
  api.stickerUntaggedText([{ name: '1.jpg', tags: [] }], 12),
], ['a.jpg', '', '', 's0.png / s1.png / s2.png / s3.png / s4.png / s5.png 等 9 张', 1, '1.jpg'])

check('三处都点名"还没标签": 提示词摘要 / op=list / 贴出去的回执', [
  /【还没标签】/.test(host),
  /only their file names find them/.test(tool),
  /no tags on it yet: 1-3 words with lw_sticker op=tag/.test(said),
], [true, true, true])

check('回执里那句只在"这一张没标签"时出现 (标过的不再唠叨)', [
  /\(stickerHit\.tags \?\? \[\]\)\.length === 0/.test(said),
  /stickerNote/.test(said),
], [true, true])

check('persona 教了"顺手标一张" (luwi 与 proactive 都要)', [
  /顺手 `lw_sticker op=tag`/.test(persona),
  /还没.?有标签/.test(persona),
  /lw_sticker op=tag/.test(proactive),
  /还没.?有标签/.test(proactive),
], [true, true, true, true])

check('op=tag 的说明写清"没标签只认文件名" (工具描述里)', [
  /a sticker with no tags can only be found by its/.test(tool),
  /exact file name\*\*/.test(tool),
], [true, true])

console.log(`\n${checks - failures} / ${checks} 条通过`)
if (failures > 0) process.exit(1)
