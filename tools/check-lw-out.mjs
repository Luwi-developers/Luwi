/**
 * 对话层 (`lw/out`) 的十条判据 (2026-11-08, 方案 §9)
 *
 * 这一层坏起来全是**静默**的: 她的话写歪一行、水位卡住、两边节奏不一样 —— 屏幕上只是"她不说话",
 * 而日志一切正常。所以十条分开钉, 每一条对应方案里的一句口径:
 *
 *   1. jsonl 每行字段 (`seq/at/gapMs/kind`, `text` 或 `rel`) 与 `kind` 取值
 *   2. `seq` 单调: 起来时从文件尾取 `max`, 之后 +1
 *   3. 同一场里只有第一行 `gapMs` 可以是 0 (拦"每调一次 lw_say 就有一个串首 0")
 *   4. `gapMs` 与 `SimSetting.Send` 那个算式对得上 (容差 ±1 ms), 并与方案 §3.3 那组真值逐个相等
 *   5. `portalOut` 的 `next <= 0` 全量 / `next > 0` 尾巴两条分支都在, Kotlin 里只有一处水位判据
 *   6. 图片行必带 `rel/thumb/w/h`, `rel` 落在 `assets/` 下
 *   7. 图路由前缀在宿主与 Kotlin 各一份且字符串相同, 注册行里有 `kind: 'prefix'` 与 `effect`
 *   8. `deliverBurst` 不动 `outboxSession`, `deliverReply` 不在 `op=reply` 时清队
 *   9. 一个发言工具 / 一份数据: `lw_say` 是唯一写入口, `OutFile.kt` 是唯一解析器,
 *      球那一侧不在这一条流上再 `gapFor` / `limitOf` 一次
 *  10. `luwi` 在 `BALL_SILENT_PRESETS` 里, 且 persona 不再把 `lw_overlay op=say` 当发言通道
 *
 * 跑法: node tools/check-lw-out.mjs   (不需要设备, 也不需要 host)
 */

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')

const host = await read('host-plugin/index.mjs')
const outFile = await read('app/src/main/java/io/github/yuloong07star/luwi/tool/OutFile.kt')
const outWatch = await read('app/src/main/java/io/github/yuloong07star/luwi/tool/OutWatch.kt')
const bridge = await read('app/src/main/java/io/github/yuloong07star/luwi/ui/PortalBridge.kt')
const overlay = await read('app/src/main/java/io/github/yuloong07star/luwi/overlay/OverlayService.kt')
const outbox = await read('app/src/main/java/io/github/yuloong07star/luwi/overlay/BallOutbox.kt')
const sim = await read('app/src/main/java/io/github/yuloong07star/luwi/tool/SimSetting.kt')
const client = await read('presets/luwi-portal/lib/client.js')
const persona = await read('presets/luwi/cordis.patch.yml')

let failures = 0
let count = 0

/**
 * 一条判据
 * @param name 判据名
 * @param ok 成立没有
 * @param detail 不成立时说清"差在哪"
 */
function check(name, ok, detail) {
  count += 1
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === undefined ? '' : `\n     ${detail}`}`)
}

/**
 * 从源码里抠一个函数的函数体 (按大括号配平)
 * @param source 正文
 * @param signature 函数签名开头 (例如 `function lwGapFor(chars`)
 * @returns 函数体 (不含外层大括号), 找不到时空串
 */
function bodyOf(source, signature) {
  const at = source.indexOf(signature)
  if (at < 0) return ''
  const open = source.indexOf('{', at)
  if (open < 0) return ''
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    const ch = source[index]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open + 1, index)
    }
  }
  return ''
}

/**
 * Kotlin 里 `const val NAME = 1_000L` 那个数 (去掉下划线与后缀)
 * @param source 源码
 * @param name 常量名
 * @returns 数值; 找不到时 NaN
 */
function kotlinConst(source, name) {
  const match = new RegExp(`const val ${name} = (-?[\\d_.]+)`).exec(source)
  return match === null ? Number.NaN : Number(match[1].replaceAll('_', ''))
}

/* ── 一、写侧的那一行: 字段与 kind 取值 ─────────────────────────────────────── */

const rowShape = /const row = \{ seq, at, gapMs,[^\n]*\n/.exec(host)
check('写侧那一行带 seq / at / gapMs', rowShape !== null, `抠不到那行: ${rowShape === null}`)
check('写侧把 roll 也记下来 (两个渲染器照同一份放, 读数也留得下)', /roll: Math\.round\(roll \* 10_000\)/.test(host))
for (const kind of ['text', 'sticker', 'image', 'file']) {
  check(`写侧会写 kind:"${kind}"`, new RegExp(`kind: '${kind}'|fields = \\{ kind: 'text'|kind: '${kind}'`).test(host))
}
const kindsInParser = /private val KINDS = setOf\(([^)]*)\)/.exec(outFile)
const kindList = kindsInParser === null
  ? []
  : kindsInParser[1].split(',').map((one) => one.trim().replaceAll('"', ''))
check('解析器认的 kind 正好是 text / sticker / image / file / voice', JSON.stringify(kindList.sort()) === JSON.stringify(['file', 'image', 'sticker', 'text', 'voice']), JSON.stringify(kindList))
check('图片行必带 rel / thumb / w / h', /return \{ rel, thumb: rel, w: size\.w, h: size\.h \}/.test(host))
check('rel 落在 assets/ 下', /const rel = `assets\/\$\{id\}\/\$\{basename\(target\)\}`/.test(host))

/* ── 二、seq 单调: 起来时从文件尾取 max, 之后 +1 ───────────────────────────── */

const markBody = bodyOf(host, 'async function lwOutMark(')
check('lwOutMark 从文件尾取 max(seq)', /if \(seq <= mark\.seq\) continue/.test(markBody) && /mark\.seq = seq/.test(markBody))
check('写行时是 mark.seq + 1', /const seq = mark\.seq \+ 1/.test(host))
check('Kotlin 也拿同一个文件名规则 (safeId)', /fun safeId\(sessionId: String\): String/.test(outFile))
check(
  '两侧的 id 规则逐字相同 (只留 [0-9A-Za-z._-], 其余换下划线, 最长 96)',
  /const LW_OUT_BAD_CHARS = \/\[\^0-9A-Za-z\._-\]\/g/.test(host) && /take\(96\)/.test(outFile),
)

/* ── 三、只有会话第一行 gapMs 可以是 0 ────────────────────────────────────── */

const appendBody = bodyOf(host, 'async function lwOutAppend(')
check(
  'gapMs: 只有第一行是 0, 其余一律按上一行字数算',
  /const gapMs = seq === 1 \? 0 : lwGapFor\(mark\.chars, send, roll\)/.test(appendBody),
  appendBody.slice(0, 200),
)
check('没有第二处"串首 0" (写侧只这一处判 seq === 1)', (host.match(/const gapMs = seq === 1 \? 0 :/g) ?? []).length === 1)
check('表情 / 图片 / 语音按 0 字算 (只有 kind:"text" 计字)', /row\?\.kind \?\? 'text'\) !== 'text'\) return 0/.test(host))

/* ── 四、gapMs 与 SimSetting.Send 是同一套数 ──────────────────────────────── */

const defaults = {
  gapMinMs: kotlinConst(sim, 'SEND_GAP_MIN_MS'),
  gapMaxMs: kotlinConst(sim, 'SEND_GAP_MAX_MS'),
  perCharMs: kotlinConst(sim, 'SEND_PER_CHAR_MS'),
  longGapMinMs: kotlinConst(sim, 'LONG_GAP_MIN_MS'),
  longGapMaxMs: kotlinConst(sim, 'LONG_GAP_MAX_MS'),
  longGapProbability: kotlinConst(sim, 'LONG_GAP_PROBABILITY'),
}
const hostDefaults = /const LW_SEND_DEFAULTS = Object\.freeze\(\{([\s\S]*?)\}\)/.exec(host)
const hostNums = {}
if (hostDefaults !== null) {
  for (const line of hostDefaults[1].split('\n')) {
    const found = /^\s*([A-Za-z]+): ([\d.]+),/.exec(line)
    if (found !== null) hostNums[found[1]] = Number(found[2])
  }
}
const shared = Object.keys(defaults)
const hostShared = {}
for (const key of shared) hostShared[key] = hostNums[key]
check(
  '宿主那侧写的缺省值与 Kotlin 的 SimSetting.Default 逐个相同',
  JSON.stringify(hostShared) === JSON.stringify(defaults),
  `host=${JSON.stringify(hostShared)} kotlin=${JSON.stringify(defaults)}`,
)

const gapBody = bodyOf(host, 'function lwGapFor(')
check('lwGapFor 抽得到', gapBody !== '')
const gapFor = gapBody === '' ? () => Number.NaN : new Function('chars', 'send', 'roll', gapBody)
const send = {
  burstEnabled: true,
  burstMaxMessages: 6,
  gapMinMs: defaults.gapMinMs,
  gapMaxMs: defaults.gapMaxMs,
  perCharMs: defaults.perCharMs,
  longGapProbability: defaults.longGapProbability,
  longGapMinMs: defaults.longGapMinMs,
  longGapMaxMs: defaults.longGapMaxMs,
  maxMessageChars: 600,
}

// 方案 §3.3 那组数就是"缺省参数下的真值": 3 字 1060 / 12 字 1240 / 表情 0 字 1000
const truth = [
  [0, 0.99, 1000],
  [3, 0.99, 1060],
  [12, 0.99, 1240],
  [0, 0.1, 5500],
  [999, 0.99, 3000],
]
for (const [chars, roll, want] of truth) {
  const got = gapFor(chars, send, roll)
  check(`gapMs(${chars} 字, roll=${roll}) = ${want}`, Math.abs(got - want) <= 1, `got ${got}`)
}

// 与球那侧同一个算式: BallOutbox.gapFor 也得给同一组数 (两处实现, 判据比对)
const ballGapBody = bodyOf(outbox, 'fun gapFor(')
check('球那侧 gapFor 还在 (老路径兜底用)', ballGapBody !== '')
check(
  '两边算式同形: 先判长停顿概率, 再按字数夹在上下限之间',
  /bounded < send\.longGapProbability/.test(gapBody) && /bounded < send\.longGapProbability/.test(ballGapBody),
)

/* ── 五、portalOut 两条分支 ───────────────────────────────────────────────── */

check('Kotlin 有 portalOut(id, next)', /fun portalOut\(id: String, next: Int\): String/.test(bridge))
check(
  'next <= 0 走全量 / next > 0 只回尾巴',
  /if \(next > 0 && line\.seq <= next\) continue/.test(outFile),
  bodyOf(outFile, 'fun page(').slice(0, 300),
)
check('水位判据在 Kotlin 里只有这一处', (outFile.match(/seq <= next/g) ?? []).length === 1)
check('页面那侧两段水位都在 (reset 拿全量 / 否则取尾巴)', /function loadOut\(reset\)/.test(client)
  && /call2\('portalOut', sessionId, 0\)/.test(client)
  && /call2\('portalOut', sessionId, outNext\)/.test(client))
check('末行解不开就跳过, 不推进水位 (解析失败 continue)', /val line = parse\(raw\) \?: continue/.test(outFile))
check('页面那侧取水位在入队时推进 (onOut 重入不会把同一批再取一遍)', /if \(Number\(fresh\[fresh\.length - 1\]\.seq\) > outNext\) outNext = Number\(fresh\[fresh\.length - 1\]\.seq\)/.test(client))
check('画只认 releasedIds (上屏那一刻才标, 撤队不会让取过的条再冒出来)', /releasedIds\[head\.seq\] = true/.test(client) && /if \(seenSeq\[one\.seq\] === true\) continue/.test(client))

/* ── 六、图路由: 前缀两处相同 + kind: 'prefix' + effect ───────────────────── */

const routeHost = /const LW_OUT_ROUTE = '([^']+)'/.exec(host)
const routeKotlin = /const val ROUTE = "([^"]+)"/.exec(outFile)
check('路由前缀在宿主与 Kotlin 各一份且相同', routeHost !== null && routeKotlin !== null && routeHost[1] === routeKotlin[1], `${routeHost?.[1]} vs ${routeKotlin?.[1]}`)
check('页面拼的也是同一串 (`/lw-out/` + rel)', /img\.src = '\/lw-out\/' \+ rel/.test(client))
check('注册行里 kind: \'prefix\'', /register\(\{ kind: 'prefix', path: LW_OUT_ROUTE, handler: serveLwOut \}\)/.test(host))
check('注册走 ctx.inject + effect, 收了 disposer', /ctx\.inject\(\['webServer'\]/.test(host)
  && /webCtx\.effect\(\(\) => \{/.test(host) && /off\(\)/.test(bodyOf(host, "ctx.inject(['webServer']")))
check('只服务回环两头 (LAN 模式下这条前缀不存在)', /!lwLoopback\(req\.socket\?\.remoteAddress\) \|\| !lwLoopback\(req\.socket\?\.localAddress\)/.test(host))
check('非 GET/HEAD 一律 405', /reply\(405, 'only GET and HEAD'/.test(host))
check('只认 assets/ 下、拒 .. 与反斜杠', /!rel\.startsWith\('assets\/'\) \|\| rel\.includes\('\.\.'\)/.test(host))

/* ── 六之二、Office 的类型表与大小闸 (2026-11-09: 预览窗要自己解 docx / pptx / xlsx) ── */

check('三个 Office MIME 都在 LW_OUT_TYPES 里 (少了哪一个都是 404, 界面只会说"取不到")', [
  /docx: 'application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document'/.test(host),
  /pptx: 'application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation'/.test(host),
  /xlsx: 'application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet'/.test(host),
  /\.\.\.LW_OUT_OFFICE_TYPES/.test(host),
], [true, true, true, true])
check('老二进制格式不进那张表 (doc / ppt / xls 照旧交给系统里接它们的应用)', [
  /doc: 'application\/msword'/.test(host),
  /xls: 'application\/vnd\.ms-excel'/.test(host),
], [false, false])
check('Office 超过 12 MB 直接 413, 不把它读进来再解', [
  /const LW_OUT_OFFICE_MAX = 12 \* 1024 \* 1024/.test(host),
  /LW_OUT_OFFICE_SET\.has\(type\) && body\.length > LW_OUT_OFFICE_MAX/.test(host),
  /reply\(413, 'too large'/.test(host),
  /'X-Lw-Too-Large': '1'/.test(host),
], [true, true, true, true])

/* ── 七、队列: op=reply 不清队, burst 不动 outboxSession ──────────────────── */

const replyBody = bodyOf(overlay, 'private fun deliverReply(')
const burstBody = bodyOf(overlay, 'private fun deliverBurst(')
check('deliverReply 不再清队', !/outbox\.clear\(\)\s*\n\s*outboxBusy = false/.test(replyBody) && !/outboxSession = ""/.test(replyBody), replyBody.slice(0, 200))
check('deliverBurst 不动 outboxSession', !/outboxSession =/.test(burstBody), burstBody.slice(0, 200))
check('新的 user turn 才清队 (`ask` 里那一段)', /private fun ask\(text: String\): Boolean \{[\s\S]{0,900}?outboxGeneration \+= 1/.test(overlay))
check('世代闸: 撤队之后回来那一拍不许再动 busy', /if \(generation != outboxGeneration\) return/.test(overlay))

/* ── 八、一个发言工具 / 一份数据 ──────────────────────────────────────────── */

check('lw_say 是唯一写入口 (写 jsonl 的只有它)', (host.match(/lwOutAppend\(/g) ?? []).length >= 1
  && (host.match(/appendFile\(path, `\$\{JSON\.stringify\(row\)\}\\n`\)/g) ?? []).length === 1)
check('jsonl 只有一个解析器 (OutFile.kt 里的 parse)', /fun parse\(text: String\): Line\?/.test(outFile)
  && !/JSONObject\(trimmed\)/.test(overlay) && !/JSONObject\(line\)/.test(overlay))
check('球那侧走 OutFile.page (不是自己 split)', /val page = OutFile\.page\(this, id, mark\)/.test(overlay))
check('球那侧不在 out 流上再 gapFor / limitOf 一次', !/gapFor\(|limitOf\(/.test(bodyOf(overlay, 'private fun enqueueOut(')))
check('门户那侧走 portalOut (不是自己读文件)', /call2\('portalOut'/.test(client))
check('两个界面读的是同一份 OutFile/Watch (一个 observer)', /OutWatch\.watch\(/.test(bridge) && /OutWatch\.watch\(this\)/.test(overlay))
check('触发源在 Kotlin 那侧: FileObserver 推 __LUWI_PORTAL__.onOut()', /__LUWI_PORTAL__\.onOut\(\)/.test(bridge) && /onOut: function \(\) \{ portal\.onOut\(\) \}/.test(client))
check('每场一个水位, 球起来那一拍取文件尾', /val max = OutFile\.maxSeq\(this, id\)/.test(overlay)
  && /outWatermark\[id\] = max/.test(overlay))
// 2026-11-10: 起来那一拍仍取文件尾, 但**变更事件里第一次见到一场**可能是新会话的第一条 —— 取最后一条,
// 不整场跳过 (否则新会话第一句话在球上永远不出现, 门户却有)
check('新会话的第一条也上球 (第一次见到的变更不整场跳过)', [
  /var mark = outWatermark\[id\]/.test(overlay),
  /mark = \(max - 1\)\.coerceAtLeast\(0\)/.test(overlay),
  /if \(changed\.isEmpty\(\)\) \{/.test(overlay),
], [true, true, true])

/* ── 九、浮球那侧的正文闸 + persona 的出口 ──────────────────────────────── */

check('luwi 在 BALL_SILENT_PRESETS 里 (正文不进框、不念)', /const BALL_SILENT_PRESETS = new Set\(\['explore', 'luwi'\]\)/.test(host))
check('persona 不再把 lw_overlay op=say 当发言通道', !/lw_overlay op=say/.test(persona) && !/lw_sticker op=say/.test(persona))
check('persona 里 lw_say 是唯一出口', /发言只走 lw_say/.test(persona) && /正文不发言/.test(persona))
// 2026-11-10 主人这一轮把口径说死了: 图走 lw_say 的 image (副本), 表情走 lw_say 的 sticker (引用),
// lw_sticker 只留着 op=list 找素材, op=say 是宿主底层 (球的回复框那条路)
check('persona 写死「表情只走 lw_say 的 sticker, lw_sticker 只 op=list」',
  /lw_say\(\{ sticker/.test(persona) && /op=list/.test(persona)
    && /op=say/.test(persona) && /底层/.test(persona))
check('persona 里图是副本、表情是引用', /复制一份副本/.test(persona) && /只\*\*引用\*\*|只引用/.test(persona))

/* ── 十、图片写侧的路径规矩 + 清理规则 ───────────────────────────────────── */

// 2026-11-09: 图片与文件共用同一段落盘 (`lwOutPayload`), `lwOutImage` 只是把扩展名换成图片那一套
const payloadBody = bodyOf(host, 'async function lwOutPayload(')
check('写侧只取 basename, 拒 .. 与 NUL', /const name = basename\(source\)/.test(payloadBody)
  && /name\.includes\('\.\.'\)/.test(payloadBody) && /includes\('\\u0000'\)/.test(payloadBody))
check('扩展名白名单且一律小写重写', /const ext = dot > 0 \? name\.slice\(dot \+ 1\)\.toLowerCase\(\) : ''/.test(payloadBody)
  && /exts\.has\(ext\)/.test(payloadBody))
check('目标必须落在 assets/ 下面 (canonical path 复核, 不靠拼字符串)', /assetsRoot/.test(payloadBody) && /startsWith\(assetsRoot\)/.test(payloadBody))
check('同名顺延, 不覆盖', /existsSync\(target\); n \+= 1\) target = /.test(payloadBody))
check('写完读回: 字节数 > 0 且宽高解析得出来才落行', /written\.size <= 0/.test(payloadBody) && /size === null \|\| size\.w <= 0/.test(payloadBody))
check('20 MB 拒收且说清是哪一份、多大', /MB limit - she cannot send it/.test(payloadBody))
check('她也能递文件: lw_say 认 file, 落成 kind:file 那一行 (与图同一条路)',
  /const file = String\(args\?\.file \?\? ''\)\.trim\(\)/.test(host)
    && /const art = await lwOutPayload\(session, seq, files\[0\], LW_FILE_EXTS, 'file'\)/.test(host)
    && /const LW_FILE_EXTS = new Set\(\[/.test(host))
check('图与文件互斥 (同一次只说一样)', /one call carries either an image or a file, not both/.test(host))
check('清理规则: 留最近 10 场 + 512 MB 兜底', /LW_OUT_KEEP_SESSIONS = 10/.test(host) && /LW_OUT_MAX_BYTES = 512 \* 1024 \* 1024/.test(host))
check('清理只删 jsonl 与 assets/<id>/', /rm\(join\(assetsDir, one\.id\), \{ recursive: true, force: true \}\)/.test(host))

/* ── 十一、你发给她 + 门户画表情 (2026-11-08 的补齐) ─────────────────────── */

check('你发给她: 图与文件都走 lw-in 落盘 + 正文路径 (安卓上 image 块必失败)',
  /function imageBlocks\(/.test(client) && /return \[\]/.test(bodyOf(client, 'function imageBlocks('))
    && /图片用 read_image 打开/.test(client) && /session\.prompt\(blocks/.test(client))
check('其它文件走 portalStash 落 lw-in (dsh 的 attachment 上传在安卓上必失败)',
  /portalStash/.test(client) && /fun portalStash\(payload: String\): String/.test(bridge))
// 每个用到的局部函数都得真有定义 (2026-11-08 真机上踩过: 删块时把 conversationService 一起带走,
// 界面上只是"点了 + 没反应", 只有 console 里那句 Uncaught ReferenceError)
for (const name of [
  'conversationService', 'stashOne', 'renderAttach', 'attachLines', 'attachReady', 'pickFile',
  // 2026-11-09 那一批 (图真显示 / 文件预览 / 表情面板 / 自动开一场)
  'splitAttach', 'hasImageBlock', 'fileChip', 'sizeText', 'openPreview', 'closePreview',
  'stickerCell', 'loadStickers', 'openStickerPanel', 'closeStickerPanel', 'toggleStickerPanel',
  'pickSticker', 'onStickerChosen', 'sendSticker', 'stemOf', 'isImageName', 'isTextName', 'autoStart',
]) {
    const used = new RegExp(name + '\\(').test(client)
    const defined = new RegExp('function ' + name + '\\(').test(client)
    check('局部函数 ' + name + ' 有定义', !used || defined)
}
check('没落好不许发', /if \(!attachReady\(\)\) \{/.test(client) && /attach\[i\]\.status !== 'ready'/.test(client))
check('选文件走 <input type=file> (HostScreen 的 onShowFileChooser 那条路)',
  /els\.file\.type = 'file'/.test(client) && /els\.file\.accept = \[/.test(client))
check('自己发过的图真画出来: 发的时候落 lw-in, 画的时候走 /lw-out/in/',
  /function splitAttach\(/.test(client) && /function hasImageBlock\(/.test(client)
    && /image: 'in\/' \+ encodeURIComponent/.test(client)
    && /rel\.startsWith\('in\/'\)/.test(host))
check('只发了附件那条用户消息不会被当成空串丢掉 (attach 非空即上屏)',
  /one\.attach && one\.attach\.length > 0\)\) shown\.push/.test(client))
check('门户也能画表情那张小图 (路由服务 stickers/ 下的裸名字)',
  /rel\.startsWith\('stickers\/'\)/.test(host) && /'\/lw-out\/stickers\/' \+ encodeURIComponent/.test(client))
check('她递来的文件只写文件名 (一颗蓝字按钮, 点开预览窗)',
  /function fileChip\(/.test(client) && /else if \(item\.file\) \{/.test(client))
check('文件挂在句子下方 (话在上, 文件在下)',
  /lwp-bubble', item\.text\)\)[\s\S]{0,140}?row\.appendChild\(fileChip\(item\.file/.test(client))
check('文档也能打开: 绝对路径走 portalAbsPath, 再交给 luwi-open 那条窄通道',
  /fun portalAbsPath\(rel: String\): String/.test(bridge)
    && /luwi-open:\/\/file\?path=/.test(client) && /call\('portalAbsPath'/.test(client))
check('表情面板在输入卡下面、一块键盘高 (不是卡片上方的浮层)',
  /#lwp-sticker-panel\{flex:none;display:block;width:100%;height:268px;max-height:30vh/.test(client)
    && /dock\.appendChild\(els\.stickerPanel\)/.test(client))
check('一次说几句时朗读等它们上完屏再开口 (耳朵不比眼睛快)',
  /async function lwSpeakLine\(script, waitMs\)/.test(host)
    && /if \(wait > 0\) await new Promise/.test(host)
    && /const spokenWait = written\.reduce/.test(host))
// 朗读与显示分离 (2026-11-10, 方案 docs/Luwi-朗读与显示分离-方案-2026-11-09.md §4.2):
// **jsonl 一个字节都不动**, `voice` 只走朗读流, 绝不进显示字段
check('jsonl 的显示字段没被朗读稿改动 (数组那三样还是 kind/text/sticker)',
  /const fields = \{ kind: 'text', text \}/.test(host)
    && !/const fields = \{[^}]*voice/.test(host)
    && !/lwOutAppend\([^)]*voice/.test(host))
check('`voice` 是念法不是说法: 只交给 readAloudScript, 差异落一行日志',
  /readAloudScript\(shownText, voice\)/.test(host)
    && /lw_say: the spoken line differs from the shown one/.test(host)
    && /const voice = String\(args\?\.voice \?\? ''\)\.trim\(\)/.test(host))
// 朗读流自己一本账: 走 op=read 排队 + op=cancel 打断 (念完当前段即停), 不再直连 op=speak
check('朗读走朗读流 (op=read), 新一轮先 op=cancel',
  /call\('speak', \{ op: 'read', text: segment \}\)/.test(host)
    && /call\('speak', \{ op: 'cancel' \}\)/.test(host)
    && /readAloudSegments/.test(host))
check('她的那几行时间单调不减 (时间回卷也不会两处排序不同)',
  /var floorAt = 0/.test(client) && /if \(at < floorAt\) kept\[m\]\.time = floorAt/.test(client))
// 状态点 (2026-11-10 主人: "旧的两处标识 新对话（绿）对话中（蓝）也加在那个点里"):
// 它贴在头像右下角, 一顆点三态; 旧的两颗/那行都撤了
check('状态点在头像右下角, 三态 (新对话 / 对话中 / 正在做), 旧标识都撤了',
  /id = 'lwp-busy'/.test(client) && /els\.busy\.setAttribute\('data-state', state\)/.test(client)
    && /mark\.appendChild\(els\.busy\)/.test(client) && /#lwp-busy\{position:absolute/.test(client)
    && /#lwp-head \.lwp-meta\{display:none\}/.test(client)
    && !/els\.meta\.textContent = parts\.join/.test(client)
    && !/lwp-badge/.test(client) && !/flowWorking/.test(client))
check('预览窗尺寸照「选择权限」那一窗 (居中 / 左右 20dp / 高封 78% / 遮罩 40%)',
  /#lwp-preview\{position:fixed;inset:0/.test(client) && /max-height:78vh/.test(client)
    && /padding:0 20px/.test(client) && /background:rgba\(0,0,0,\.4\)/.test(client))
check('`+` 右边多一颗表情钮, 面板里只有图 (一个字的 caption 都没有)',
  /els\.stickerBtn = h\('button'\)/.test(client) && /tools\.appendChild\(els\.stickerBtn\)/.test(client)
    && /#lwp-sticker-panel \.lwp-sticker-grid\{display:grid/.test(client))
check('表情面板就是她的表情包目录 (两个桥方法, 与 lw_sticker 同一处 lw/stickers)',
  /fun portalStickers\(\): String/.test(bridge) && /fun portalStickerAdd\(payload: String\): String/.test(bridge)
    && /lwFile\("stickers"\)/.test(bridge))
check('进门户自动开一场 (「开一场」那颗按钮撤了)',
  /function autoStart\(/.test(client) && /setTimeout\(autoStart, 800\)/.test(client)
    && !/lwp-start/.test(client))

/* ── 十二、安卓上的原子落盘兼容 (2026-11-08 晚: 新会话落不了盘的根) ───────────── */

const packHost = await read('tools/pack-host.mjs')
check('pack-host 带安卓 fs 兼容补丁 (硬链接退 rename + 目录 fsync 打不开就跳过)',
  /androidFsPatches/.test(packHost) && /lwRename\(tmp, finalPath\)/.test(packHost) && /constants\.O_RDONLY\)\.catch/.test(packHost))
check('补丁按"数替换处数"落地 (上游换形状就吵)',
  /expected exactly 1 occurrence/.test(packHost))
const packedPersistence = await read('app/build/host-tree/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js')
const packedAttachments = await read('app/build/host-tree/node_modules/@deepseek-ai/dsh-attachment-local/lib/index.js')
check('打出来的树里已经带上那个补丁 (新会话才落得下盘)',
  packedPersistence.includes('lwError') && packedAttachments.includes('lwError'),
  'persistence=' + String(packedPersistence.includes('lwError')) + ' attachments=' + String(packedAttachments.includes('lwError')))

/* ── 十三、档读自投影 (2026-11-08 晚: 非 luwi 档据此显示正文泡) ───────────── */

check('档从会话投影里读 (get/values), 读不到才退 header 与快照',
  /function readProjection\(/.test(client) && /store\.get\('agentPreset'\)/.test(client)
    && /session\.header && session\.header\.agentPreset/.test(client))
check('账本过期也跟随一次 (打开应用要看到刚聊过的那一场, 不是空 draft)',
  /ledger\.usable !== true && !staleFollowed/.test(client) && /staleFollowed = false/.test(client)
    && /if \(switchTo\(ledger\.id, 'ledger'\)\) staleFollowed = true/.test(client)
    && /function openBallWorkspace\(/.test(client))
check('冷启动按账本的 cwd 认工作区 (dsh 只加载当前工作区, 账本那一场不在列表里)',
  /function workspaceByPath\(/.test(client) && /workspaceByPath\(ballWorkspacePath\)/.test(client)
    && /ledger\.workspacePath/.test(client))
check('同一场再挂一次不许清界面 (否则冷启动每 3 s 在气泡与空态之间跳)',
  /var same = id === sessionId/.test(client) && /if \(!same\) \{/.test(client))
check('正文泡只在“这一轮没说出”时兜底画 (两档同一套, 不再按档一刀切)',
  /var assistantFallback = ''/.test(client) && /if \(!spoke\) \{/.test(client)
    && /fallback: true/.test(client)
    && />= lastUserTime/.test(client))

check('assistant 那一支的 assistantSaid 有声明 (少了它整个 renderFlow 抛 ReferenceError)',
  /var assistantSaid = textOf\(blocks\)/.test(client))

/* ── 十四、球那一侧的图与文件 (2026-11-09: 图不显示 / 空行 / 文件压成三个字) ────── */

const media = await read('app/src/main/java/io/github/yuloong07star/luwi/overlay/BallMedia.kt')
const preview = await read('app/src/main/java/io/github/yuloong07star/luwi/overlay/BallPreview.kt')
const picks = await read('app/src/main/java/io/github/yuloong07star/luwi/overlay/BallPicks.kt')
const boxView = await read('app/src/main/java/io/github/yuloong07star/luwi/overlay/BoxView.kt')
const lwIn = await read('app/src/main/java/io/github/yuloong07star/luwi/tool/LwIn.kt')
const pickActivity = await read('app/src/main/java/io/github/yuloong07star/luwi/ui/PickMediaActivity.kt')

check('图的上限与宿主同一个数 (原来借了表情包那档 2 MB, 截屏必挂)',
  /const val MAX_BYTES = 20L \* 1024 \* 1024/.test(media) && /const LW_IMAGE_MAX_BYTES = 20 \* 1024 \* 1024/.test(host))
check('那一格的高由 imageBox 先算好 (不再靠 adjustViewBounds 现量)', /fun imageBox\(/.test(media)
  && /BallMedia\.imageBox\(size\.first/.test(boxView))
check('贴图之后排一帧再摆一次 (滚动才正常的那条病)', /view\.post \{ runCatching \{ layoutChannel\(\) \} \}/.test(overlay))
check('读图失败一定留一句话, 不为失败开空框', /ball_image_missing/.test(overlay)
  && !/if \(bitmap == null\) \{\s*\n\s*if \(boxOnScreen\)/.test(overlay))
check('文件那一条不再压成「（文件）」(注释里可以提, 代码里不许再兜)',
  !/text = if \(line\.kind == "file" && line\.text\.isEmpty\(\)\) "（文件）"/.test(overlay)
    && /fileRel = if \(line\.kind == "file"\)/.test(overlay))
check('BallSay 带 file / fileRel / fileBytes', /val file: String = ""/.test(outbox)
  && /val fileRel: String = ""/.test(outbox) && /val fileBytes: Long = 0L/.test(outbox))
check('媒体那几种满了不合并 (丢最旧那条, 顺序不乱)', /queued\.drop\(1\) \+ line/.test(outbox))
check('预览窗走悬浮窗权限, 不跳 Activity', /TYPE_APPLICATION_OVERLAY/.test(preview) && /class BallPreview|object BallPreview/.test(preview)
  && !/startActivity/.test(bodyOf(preview, 'fun show(')))
check('预览窗尺寸照门户那一窗 (78% 屏高 / 左右 20dp)', /HEIGHT_PERCENT = 78/.test(preview) && /MARGIN_DP = 20/.test(preview))
check('预览窗分四路: 图 / 字 / PDF / office (2026-11-10: office 自己解, 不再"交给系统")',
  ['IMAGE', 'TEXT', 'PDF', 'OFFICE'].every((one) => new RegExp(`Kind\\.${one}`).test(preview))
    && /renderOffice/.test(preview) && !/OpenFile\.viewIntent/.test(preview))
check('office 那一份渲染核心随包 (与门户同一个 src 打出来的 lite bundle)',
  (/assets\.open\("web\/lw-office\.js"\)/).test(preview)
    && existsSync(new URL('app/src/main/assets/web/lw-office.js', root))
    && existsSync(new URL('tools/build-office-lite.mjs', root))
    && /presets\/docx-preview\/src\/index\.js/.test(await read('tools/build-office-lite.mjs')))
check('文件字节给页面走拦截器 (页面 fetch /file, 不塞大字符串)',
  /shouldInterceptRequest/.test(preview) && /url\.path != "\/file"/.test(preview)
    && /fetch\('\/file'/.test(preview))
check('外壳与门户那一窗同尺寸 (78% 屏高 / 圆角 28 / 左右 20dp)',
  /HEIGHT_PERCENT = 78/.test(preview) && /CARD_CORNER_DP = 28/.test(preview) && /MARGIN_DP = 20/.test(preview))
check('球的 `+` 与门户同一个落盘 (LwIn.put), 且是多选', /OpenMultipleDocuments/.test(pickActivity)
  && /LwIn\.put\(root, name, bytes\)/.test(pickActivity) && /LwIn\.put\(Workspace\.resolve\(context\)\.directory/.test(bridge))
check('附件从那个透明 Activity 交回服务 (一份内存队列)', /object BallPicks/.test(picks) && /BallPicks\.bind/.test(overlay))
check('发出去那一句带附件段 (与门户逐字相同), 桌面对话那一格去掉它',
  /BallAttach\.block\(picks\.map \{ it\.path \}\)/.test(overlay) && /BallAttach\.strip\(outgoing\)/.test(overlay))
check('摘掉/清空附件在框那一侧有实现', /fun addAttachment\(pick: LwIn\.Pick\)/.test(boxView)
  && /fun clearAttachments\(\)/.test(boxView) && /fun removeAttachment\(pick: LwIn\.Pick\)/.test(boxView))
check('门户那张图也有长宽上限, 点一下开预览窗 (2026-11-10 各收一半: 43% / 30vh)',
  /\.lwp-image\{max-width:43%/.test(client) && /max-height:30vh/.test(client)
    && /wrap\.onclick = function \(\) \{ openPreview/.test(client))
check('球那侧长宽各一半 (宽 50% 内容宽 / 高 18% 屏高)', /const val MAX_WIDTH_PERCENT = 50/.test(media)
  && /const val MAX_HEIGHT_PERCENT = 18/.test(media))
check('门户不再给每一张图垫 72px 幻影最小高', !/\.lwp-image\{max-width:86%;min-height:72px/.test(client))
check('`lw-in` 的规矩只剩一处实现 (门户桥改调 LwIn)',
  /LwIn\.put\(/.test(bridge) && !/STASH_EXTS/.test(bridge) && /BallAttach/.test(lwIn))

if (failures > 0) {
  console.error(`check-lw-out: FAIL (${failures}/${count})`)
  process.exit(1)
}
console.log(`check-lw-out: PASS (${count})`)
