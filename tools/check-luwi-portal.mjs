/**
 * 门户那一层的判据
 *
 * 三件事, 一条不成立就红:
 *
 * 1. **包里该有的都在**: `presets/luwi-portal` 的包声明 (带 `dsh.client`)、宿主那一半、以及
 *    `lib/client.js` 里那几个依赖 dsh 内部名字的调用 (`beginSubmission` / `prompt` / `uiConversation`)
 *    —— 上游改名时这一层会**静默失效** (界面还在, 只是发不出话), 所以名字要在这一层盯住
 * 2. **挂得上**: `PluginOverlay` 的 PLUGINS 与 OWN_PLUGINS 两张表都有这一行, `pack-host.mjs` 里
 *    也有把它拷进树的动作 (只加一张表的那一份, 在开着官方语音 bundle 的手机上根本不会挂, 2026-10-08
 *    在真机上踩过)
 * 3. **两处写死的量对得上**: 球那场账的 10 分钟窗口与工作区名在宿主 (`host-plugin/index.mjs`) 与
 *    Kotlin (`ui/PortalBridge.kt`) 各写了一份 —— 那是**同一件事的两处实现**, 漂了就会出现"球接的
 *    是这一场、门户看的是那一场"
 *
 * usage: node tools/check-luwi-portal.mjs
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const failures = []
const notes = []

/**
 * 读一份文件, 读不到就记一条失败
 * @param relative - repo 相对路径
 * @returns 文件正文, 读不到时为空串
 */
function read(relative) {
  try {
    return readFileSync(new URL(relative, `file://${root}/`), 'utf8')
  } catch (error) {
    failures.push(`${relative}: ${error.message}`)
    return ''
  }
}

/**
 * 断言一份正文里有某个片段
 * @param name - 判据名字
 * @param haystack - 被查的正文
 * @param needle - 必须出现的片段
 */
function expect(name, haystack, needle) {
  if (haystack.includes(needle)) notes.push(`ok   ${name}`)
  else failures.push(`${name}: missing ${JSON.stringify(needle)}`)
}

/**
 * 从一段正文里抓一个量 (第一个捕获组)
 * @param haystack - 被查的正文
 * @param pattern - 带一个捕获组的正则
 * @returns 捕获到的文本, 抓不到返回 null
 */
function grab(haystack, pattern) {
  const found = haystack.match(pattern)
  return found === null ? null : found[1]
}

// ── 一、包本身 ────────────────────────────────────────────────────────────────

const manifest = read('presets/luwi-portal/package.json')
expect('package.json', manifest, '"name": "luwi-portal"')
expect('package.json', manifest, '"dsh"')
expect('package.json', manifest, '"client"')
expect('package.json', manifest, '"./lib/client.js"')

const hostHalf = read('presets/luwi-portal/index.mjs')
expect('index.mjs', hostHalf, "export const name = 'luwi-portal'")
expect('index.mjs', hostHalf, 'export function apply')

const client = read('presets/luwi-portal/lib/client.js')
expect('client.js', client, 'window.__ModuleLoader__.load')
expect('client.js', client, "id: 'luwi-portal'")
expect('client.js', client, 'beginSubmission')
expect('client.js', client, '.prompt(')
expect('client.js', client, 'uiConversation')
expect('client.js', client, 'sessions.binding')
expect('client.js', client, 'uiWorkspace.openSession')
expect('client.js', client, 'window.LuwiPortal')
expect('client.js', client, 'window.__LUWI_PORTAL__')
expect('client.js', client, 'portalVisible')
// 边缘划入的接管 (2026-11-08): 3.3.0 自己那条会被 pointercancel 打断, 所以这一层自己接
expect('client.js', client, 'installEdgeSwipe')
expect('client.js', client, "window.__LW_EDGE_SWIPE__")
expect('client.js', client, "ctx.get('layout')")
// 界面上不放那两颗按钮: 进出都在 Luwi 菜单里 (2026-11-07 主人)
if (client.includes('回到 dsh')) {
  failures.push('client.js: 界面上还留着「回到 dsh」按钮 (应该只在 Kotlin 菜单里)')
} else {
  notes.push('ok   client.js 界面上没有进出按钮')
}
// 2026-11-10 主人: 门户里不再画「说完了」那行兜底 (宿主 turn end 会补一行 lw_say, 再挂一行就是重复)
if (client.includes('说完了') || client.includes("kind: 'note'")) {
  failures.push('client.js: 门户里还留着「说完了」兜底行')
} else {
  notes.push('ok   门户不再画「说完了」兜底行')
}
// 只画人话: 过程类节点名一个都不该出现在取数里
if (/kind === 'tool'|kind === 'reasoning'|turn-process/.test(client)) {
  failures.push('client.js: 门户取数里出现了过程类节点 (tool / reasoning / turn-process)')
} else {
  notes.push('ok   client.js 只取 user / assistant / error')
}
// **2026-11-08 起这条断言换成"哪一档才画 assistant"**: 原来只查"有没有 tool / reasoning", 而
// `nodesOf()` 一旦按档分支, 那条就会变成假绿 (它拦不住"luwi 档又把正文画回来")
// 2026-11-10: 兜底正文只给非 luwi 档 (luwi 档由宿主 turn end 往 jsonl 补一行, 两边逐字同源),
// 并且钉在它自己那一轮 (`pinnedTo`) —— 新消息进来不再改嫁到最新那条 user 上
if (client.includes('var assistantFallback') && client.includes('pinnedTo: assistantOwner')
  && client.includes('var allowFallback = !luwiFlow() || outLines.length === 0')) {
  notes.push('ok   正文泡只在这一轮没说出时兜底画 (luwi 档交给宿主补句, 非 luwi 档才兜)')
} else {
  failures.push('client.js: nodesOf() 里没有兜底那一段 / 或兜底没有按档收紧')
}
// 她说的话那份 jsonl: 取增量 / 两段水位 / 触发源 (方案 §3.2–3.4)
expect('client.js', client, 'function loadOut')
expect('client.js', client, 'portalOut')
expect('client.js', client, 'releasedIds')
expect('client.js', client, 'function pumpOut')
expect('client.js', client, 'function clearOut')
expect('client.js', client, 'onOut: function ()')
expect('client.js', client, 'visibilitychange')
// 2026-11-10: 一「说完了」那行连同它的状态机一起删了
if (client.includes('function notePhase') || client.includes('doneNoteAt')) {
  failures.push('client.js: 「说完了」那套状态机 (notePhase / doneNoteAt) 还留着')
} else {
  notes.push('ok   「说完了」的状态机已删干净')
}
// 你发给她 (2026-11-08 主人: `+` 就是上传文件的按钮, 图片与 docs 一样走这条; 命令菜单与右边那颗
// 发图按钮都已撤掉): 选文件 / 草稿 / 上传读数 / 带附件投递
expect('client.js', client, "id = 'lwp-attach'")
expect('client.js', client, 'function onFilesChosen')
expect('client.js', client, 'function stashOne')
// 2026-11-09: 附件那几个名字从正文里认 (`lw-in/` 路径), 图真画出来 —— 原来那个把图翻成「（图）」
// 的 `contentAttachments` 已经换成 `splitAttach` + `hasImageBlock`
expect('client.js', client, 'function splitAttach')
expect('client.js', client, 'function hasImageBlock')
if (client.includes("id = 'lwp-image'") || client.includes("openMenu('command')")) {
  failures.push('client.js: 命令菜单或右边那颗发图按钮还在 (主人 2026-11-08 要求取消)')
} else {
  notes.push('ok   命令菜单与右边那颗发图按钮都已撤掉')
}

// 那一张脸 (2026-11-08 主人): 输入卡照 dsh、预设 chip、背景层与玻璃
expect('client.js', client, 'portalLook')
expect('client.js', client, 'id = \'lwp-wall\'')
expect('client.js', client, '--lwp-wall-alpha')
expect('client.js', client, '--lwp-glass-fill')
expect('client.js', client, '--dsw-menu-surface-fill')
expect('client.js', client, '--dsw-menu-backdrop-filter')
expect('client.js', client, 'id = \'lwp-card\'')
// 工具行那两样 (2026-11-08 主人: 取消预设, `+` 改成上传文件, **权限选择也删掉**, 默认完全权限)
expect('client.js', client, 'id = \'lwp-plus\'')
expect('client.js', client, 'id = \'lwp-model\'')
expect('client.js', client, 'modelDirectories')
expect('client.js', client, 'danger-full-access')
expect('client.js', client, 'ensureFullAccess')
// 权限选择那颗 chip 已撤 (2026-11-08 主人: "权限选择也删掉") —— 拨档那一手要留着 (默认完全权限)
if (client.includes("id = 'lwp-perm'") || client.includes('remote.permissionPresets')) {
  failures.push('client.js: 权限选择 chip 还在 (主人 2026-11-08 要求删掉)')
} else {
  notes.push('ok   权限选择 chip 已撤, 默认完全权限那一手还在')
}
// 预设那一档已经取消: 名字与那条 API 都不该再出现在这一层
if (client.includes('remote.agentPresets') || client.includes('lwp-preset')) {
  failures.push('client.js: 预设 chip 还在 (主人 2026-11-08 要求取消预设选择)')
} else {
  notes.push('ok   client.js 已取消预设 chip')
}
expect('client.js', client, 'reloadLook')
// 顶条不显示会话标题 (2026-11-08 主人): 那一句读数只剩账本
if (client.includes('sessionTitle(')) {
  failures.push('client.js: 顶条还在画会话标题 (sessionTitle) —— 主人要的是不显示标题')
} else {
  notes.push('ok   client.js 不画会话标题')
}

// 这一屏的四件事 (2026-11-08 主人): 中间的品牌空态 / 左上角开新对话 / 30 分钟分段 / 会话记忆
// 品牌标记是内嵌的 data URL: 文件里没有那张图, 空态就只剩一行字 (静默失效, 所以名字要盯住)
const markMatch = /MARK_PNG = 'data:image\/png;base64,([A-Za-z0-9+/=]+)'/.exec(client)
if (markMatch !== null && markMatch[1].length >= 2000) {
  notes.push(`ok   client.js 内嵌了品牌标记 (base64 ${String(markMatch[1].length)} 字符)`)
} else {
  failures.push('client.js: MARK_PNG 没内嵌或太小 (跑 tools/make-portal-mark.py)')
}
expect('client.js', client, 'MARK_PNG:BEGIN')
expect('client.js', client, 'MARK_PNG:END')
expect('client.js', client, 'SECTION_GAP_MS = 30 * 60 * 1000')
expect('client.js', client, "'dsh.luwi.portal.session'")
expect('client.js', client, 'function newConversation')
expect('client.js', client, 'function restore')
expect('client.js', client, 'id = \'lwp-hero\'')
expect('client.js', client, 'id = \'lwp-brand\'')
expect('client.js', client, 'id = \'lwp-undo\'')
expect('client.js', client, 'function sectionsOf')
expect('client.js', client, 'function stamp(')
expect('client.js', client, 'function showNote')
// **流式那一帧** (2026-11-09 主人: "发信息的瞬间如图 1, agent 发送完成后才显示正常")
// 以前每放出一条就 `textContent = ''` 整段重建, 一轮还没说话时每 3 s 还因为兜底句换了
// `Date.now()` 再拆一遍 —— 屏上抓到的就是"贴图压在文字上"那一帧
expect('client.js', client, 'function flowPlan')
expect('client.js', client, 'function resetFlow')
expect('client.js', client, 'var flowRows = []')
expect('client.js', client, 'var sameHead')
if (client.includes("kept.push({ who: 'assistant', time: Date.now()")) {
  failures.push('client.js: 兜底那一句还拿 Date.now() 当时间 —— 每 3 s 轮询换一次签名, 整屏被拆一遍')
} else {
  notes.push('ok   兜底那一句的时间钉住了 (一轮一个, 签名不再每拍变)')
}
if (client.includes('if (follow) stickFlow()') && client.includes('function stickFlow')) {
  notes.push('ok   只有贴着底才跟着滚, 并且跟着布局重钉 (翻历史时不被拽下去)')
} else {
  failures.push('client.js: 画完流无条件 scrollTop = scrollHeight —— 翻历史会被硬拽到底')
}
// 图与表情: **解码前就要有高度**, 否则每次重建都把下面几条顶一下 (2026-11-09 真机那一帧)
expect('client.js', client, 'img.width = STICKER_BOX')
expect('client.js', client, 'width:120px;height:120px;object-fit:contain')
expect('client.js', client, 'img.style.aspectRatio')
expect('client.js', client, 'function settleDecode')
// **发送那一拍** (2026-11-09 主人: "agent 发的信息会合并在一起, 用户发的消息也合并到最上方")
// 1) 兜底正文只能在**这一轮结束之后**画: 跑着的那一轮画它, 等于把这一轮的多段正文塞进一个气泡
if (client.includes("if (assistantFallback !== '' && !phaseThinking())")) {
  notes.push('ok   兜底正文只在一轮结束之后才画 (发送瞬间不再合并成一条)')
} else {
  failures.push('client.js: 兜底正文没受 phaseThinking() 约束 —— 发送瞬间会把这一轮的话合并成一个气泡')
}
// 2026-11-10: 宿主没写 lw_say 时会补一行 jsonl, 它可能还在 gapMs 里排队 —— 已取到就算"她说了",
// 否则兜底先画一句、随后又冒出一个气泡, 同一句话画两遍
if (client.includes('Number(outLines[s].at) >= lastUserTime) spoke = true')
  && !client.includes('releasedIds[outLines[s].seq] === true && Number(outLines[s].at) >= lastUserTime')) {
  notes.push('ok   已取未放的 jsonl 行也算"她说了" (兜底不与真行并存)')
} else {
  failures.push('client.js: 兜底闸还只看已放出的行 —— 宿主补的那一行会让同一句画两遍')
}
// 2) 排序: 按「轮」排 (orderTimeline) —— 缺时间的 user 沉到最后, 同毫秒算上一轮, 不再用 sortAt
// running max (那一条会把刚发出去的消息排到她上一句回复上面)
// 2026-11-12 (#38): 排好的那一串再交给 `appendRecord` 接在门户记录后面 (自动换场带过来那一段)
if (client.includes('return appendRecord(carried, orderTimeline(users, rows, extras))')
  && !client.includes('sortAt') && !client.includes('sortFloor')) {
  notes.push('ok   排序走 orderTimeline 按轮排 (旧的 sortAt / running max 已拆)')
} else {
  failures.push('client.js: 排序还没改成按轮排 —— 缺时间 / 同毫秒时消息会跳到上一句回复上面')
}
// 跨工作区的那一场: sessions.retain 只认当前工作区, 所以注入里必须有 workspaces
expect('client.js', client, 'function workspaceOf')
expect('client.js', client, "'workspaces',")
// 开新对话必须顺手写账本: 不写的话 3 s 之后 pollLedger 会把刚清空的界面拽回旧场
const landBlock = /function land\(id\) \{[\s\S]*?\n        \}/.exec(client)
if (landBlock !== null && landBlock[0].includes('portalBind')) {
  notes.push('ok   开新对话写账本 (portalBind 在 land() 里)')
} else {
  failures.push('client.js: newConversation 的 land() 里没有 portalBind —— 会被账本拽回旧场')
}
// 记忆只该有一条写入口: 写进 localStorage 的那一句在 rememberSession 里
if (client.includes('function rememberSession') && client.includes('SESSION_KEY')) {
  notes.push('ok   client.js 记住了上次那一场')
} else {
  failures.push('client.js: 没有 rememberSession / SESSION_KEY')
}

// 内嵌的那张图是脚本产物: 脚本在, 换图时才有一键重出的路
const markTool = read('tools/make-portal-mark.py')
expect('make-portal-mark.py', markTool, 'MARK_PNG:BEGIN')
expect('make-portal-mark.py', markTool, 'MARK_PNG:END')

// ── 二、挂得上 ────────────────────────────────────────────────────────────────

const overlay = read('app/src/main/java/io/github/yuloong07star/luwi/host/PluginOverlay.kt')
const overlayRows = overlay.split('\n').filter(line => line.includes('luwi-portal')).length
if (overlayRows >= 2) notes.push(`ok   PluginOverlay 两张表都有一行 (${String(overlayRows)} 处)`)
else failures.push(`PluginOverlay: 需要 PLUGINS 与 OWN_PLUGINS 各一行, 现在只有 ${String(overlayRows)} 处`)

const pack = read('tools/pack-host.mjs')
expect('pack-host.mjs', pack, "'luwi-portal'")
expect('pack-host.mjs', pack, '../presets/luwi-portal')

const screen = read('app/src/main/java/io/github/yuloong07star/luwi/ui/HostScreen.kt')
expect('HostScreen.kt', screen, 'PortalBridge(')
expect('HostScreen.kt', screen, 'PORTAL_BRIDGE = "LuwiPortal"')
expect('HostScreen.kt', screen, 'PortalState.run = {')
expect('HostScreen.kt', screen, '回到前台')
expect('HostScreen.kt', screen, '回到后台')
expect('HostScreen.kt', screen, '__LUWI_PORTAL__')

// ── 三、两处写死的量 ──────────────────────────────────────────────────────────

const hostPlugin = read('host-plugin/index.mjs')
const portalBridge = read('app/src/main/java/io/github/yuloong07star/luwi/ui/PortalBridge.kt')

const hostBall = grab(hostPlugin, /const BALL_WORKSPACE_NAME = '([^']+)'/)
const kotlinBall = grab(portalBridge, /const val BALL_WORKSPACE = "([^"]+)"/)
if (hostBall !== null && hostBall === kotlinBall) notes.push(`ok   工作区名 ${hostBall}`)
else failures.push(`工作区名对不上: host-plugin ${String(hostBall)} / PortalBridge ${String(kotlinBall)}`)

const hostWindow = grab(hostPlugin, /const VOICE_SESSION_MS = (\d+) \* (\d+) \* (\d+)/)
const kotlinWindow = grab(portalBridge, /const val VOICE_SESSION_MS = (\d+) \* (\d+) \* (\d+)L/)
if (hostWindow !== null && hostWindow === kotlinWindow) notes.push(`ok   账本窗口 ${hostWindow} 秒 = 10 分钟`)
else failures.push(`账本窗口对不上: host-plugin ${String(hostWindow)} / PortalBridge ${String(kotlinWindow)}`)

const routerSource = grab(hostPlugin, /const val SOURCE_ROUTER = "([^"]+)"/) ??
  grab(hostPlugin, /const SOURCE_ROUTER = "([^"]+)"/)
if (routerSource === null) {
  // 那个常量在 Kotlin 的 VoiceInbox 里, 宿主只按字符串比较: 这里查宿主确实认 'router'
  if (hostPlugin.includes("source === 'router'")) notes.push('ok   宿主认 source=router')
  else failures.push("host-plugin: 找不到 source === 'router' 那一支")
}
if (hostPlugin.includes("source === 'explore'")) notes.push('ok   宿主认 source=explore')
else failures.push("host-plugin: 找不到 source === 'explore' 那一支")

const voiceInbox = read('app/src/main/java/io/github/yuloong07star/luwi/voice/VoiceInbox.kt')
expect('VoiceInbox.kt', voiceInbox, 'const val SOURCE_ROUTER = "router"')
expect('VoiceInbox.kt', voiceInbox, 'const val SOURCE_EXPLORE = "explore"')

// ── 四、那一张脸的两处实现 (2026-11-08) ───────────────────────────────────────

const portalFace = read('app/src/main/java/io/github/yuloong07star/luwi/tool/PortalFace.kt')
expect('PortalFace.kt', portalFace, 'const val FILE = "face.json"')
expect('PortalFace.kt', portalFace, 'const val IMAGE_DIRECTORY = "lw/face"')
expect('PortalFace.kt', portalFace, 'fun faceFrom(')
expect('PortalFace.kt', portalFace, 'fun dataUrl(')
expect('PortalBridge.kt', portalBridge, 'fun portalLook(')
expect('PortalBridge.kt', portalBridge, 'PortalFace.dataUrl(')
// 两边说的键名必须是同一套 (Kotlin 写 JSON, 页面读字段)
for (const key of ['alpha', 'wall', 'ver']) {
  expect(`PortalBridge.kt 的 ${key}`, portalBridge, `put("${key}"`)
}
for (const key of ['alpha', 'wall', 'ver']) {
  expect(`client.js 的 ${key}`, client, `data.${key}`)
}
// 设置 → 外观 那两行 (键只此一份)
const settingsScreen = read('app/src/main/java/io/github/yuloong07star/luwi/ui/SettingsScreen.kt')
expect('SettingsScreen.kt', settingsScreen, 'R.string.settings_portal_wall')
expect('SettingsScreen.kt', settingsScreen, 'R.string.settings_portal_alpha')
expect('SettingsScreen.kt', settingsScreen, 'PortalFace.setWall(')
expect('SettingsScreen.kt', settingsScreen, 'reloadLook()')
// 设置里那一行的口径与球菜单同一条: 门户 = 前台 (#40, 2026-11-13), 两侧资源同一句话
const stringsZh = read('app/src/main/res/values-zh/strings.xml')
const stringsEn = read('app/src/main/res/values/strings.xml')
expect('values-zh/strings.xml', stringsZh, '<string name="settings_portal_wall">前台背景</string>')
expect('values/strings.xml', stringsEn, '<string name="settings_portal_wall">Foreground background</string>')

// ── 五、她说的话那份 jsonl 的那两处实现 (2026-11-08) ─────────────────────────

const outFileSource = read('app/src/main/java/io/github/yuloong07star/luwi/tool/OutFile.kt')
expect('PortalBridge.kt', portalBridge, 'fun portalOut(')
expect('PortalBridge.kt', portalBridge, 'OutFile.page(')
expect('PortalBridge.kt', portalBridge, 'OutWatch.watch(')
expect('OutFile.kt', outFileSource, 'fun page(')
expect('OutFile.kt', outFileSource, 'fun safeId(')
// 两侧的文件名规则必须逐字相同 (宿主 lwOutId / 应用 safeId): 漂了就是"她的话写在一份、读另一份"
const hostIdRule = /const LW_OUT_BAD_CHARS = \/\[\^0-9A-Za-z\._-\]\/g/.test(hostPlugin)
const kotlinIdRule = /ch\.isLetterOrDigit\(\) && ch\.code < 128 \|\| ch == '\.' \|\| ch == '_' \|\| ch == '-'/.test(outFileSource)
if (hostIdRule && kotlinIdRule) notes.push('ok   out 文件名规则两侧同一套')
else failures.push(`out 文件名规则对不上: host=${String(hostIdRule)} kotlin=${String(kotlinIdRule)}`)

// ── 六、键盘那一格 (2026-11-09) ──────────────────────────────────────────────
//
// 主人: "呼出键盘时不应整个界面上移, 只要输入框和聊天记录向上移" —— 所以门户盖着时 WebView 尺寸
// **一点都不动**, 高度只推给页面; 页面把它写成 `--lwp-ime` (只抬对话区与输入卡)。这三句话分在
// Kotlin 与页面两边, 少一条就退回"整页被顶上去"

expect('HostScreen.kt', screen, 'val portalOpen = PortalState.open')
expect('HostScreen.kt', screen, 'if (portalOpen) modifier else modifier.padding(bottom = imeLift)')
expect('HostScreen.kt', screen, 'setOnApplyWindowInsetsListener')
expect('HostScreen.kt', screen, 'setInsets(WindowInsets.Type.ime(), Insets.NONE)')
expect('HostScreen.kt', screen, 'PortalState.imePx =')
// 推给页面的数必须是 dp (WebView 里 1 CSS px = 1 dp): 拿 roundToPx() 的 922 当 CSS px 写下去,
// 输入卡会被顶到顶栏下面 (2026-11-09 真机踩到)
expect('HostScreen.kt', screen, 'val imeLiftDp = imeLift.value.roundToInt()')
expect('HostScreen.kt', screen, '__LUWI_PORTAL__.setKeyboard($imeLiftDp)')
// 页面: 一个入口 + 一处 style + 挂载时自己来问
expect('client.js', client, 'var hostRequire')
expect('client.js', client, 'function applyIme')
expect('client.js', client, '--lwp-ime')
expect('client.js', client, 'root.setAttribute(\'data-ime\', \'on\')')
expect('client.js', client, 'setKeyboard: function (px)')
expect('client.js', client, "call('portalIme')")
// 挂上就要报 true: 只报 false 的那一版让宿主一直以为门户没开 (菜单方向与键盘让位都跟着错)
expect('client.js', client, "call('portalVisible', true)")
expect('PortalBridge.kt', portalBridge, 'var imePx: Int = 0')
expect('PortalBridge.kt', portalBridge, 'fun portalIme(')

// ── 七、预览窗里的 Office (2026-11-09) ────────────────────────────────────────
//
// 主人: "让 docx，pptx 等办公文件能在预览界面里显示" —— 渲染器是 `lw-docx-preview` 那一包,
// 门户籍模块表的 require 取它, 取不到退 `window.__LW_OFFICE__`, 再取不到就照实说并给系统那条路

expect('client.js', client, 'var OFFICE_EXTS = { docx: 1, pptx: 1, xlsx: 1 }')
expect('client.js', client, 'function officeRenderer')
expect('client.js', client, "hostRequire('lw-docx-preview')")
expect('client.js', client, 'window.__LW_OFFICE__')
expect('client.js', client, 'function openOfficePreview')
expect('client.js', client, 'api.renderOffice(raw, name)')
expect('client.js', client, 'attachShadow')
expect('client.js', client, 'lwp-preview-doc')
expect('client.js', client, '文件太大（超过 10 MB），请在电脑上打开')
expect('client.js', client, '预览模块没挂上，这一份解不开')
// 预览窗**固定大小** (2026-11-09 主人: "预览窗口应当固定大小"): 高度写死 78vh, 不跟着内容缩;
// 图在那一块里居中
expect('client.js', client, 'height:78vh;max-height:78vh')
expect('client.js', client, 'box-sizing:border-box;height:78vh')
expect('client.js', client, "'data-kind', 'image'")
expect('client.js', client, '[data-kind="image"]{display:flex;align-items:center;')
// 取字节那一条与宿主那张类型表必须对得上 (少了 docx 就是 404, 界面只说"取不到")
const lwTypes = read('host-plugin/index.mjs')
for (const suffix of ['docx', 'pptx', 'xlsx']) {
  expect(`host-plugin/index.mjs 的 ${suffix}`, lwTypes, `  ${suffix}: 'application/vnd.openxmlformats-officedocument`)
}

// ── 八、发送瞬间的整屏重建 (2026-11-10) ──────────────────────────────────────
//
// 方案 `docs/Luwi-门户发送瞬重建-方案-2026-11-10.md`: 修法 1 = 稳定身份, 修法 2 = 允许只重建末尾.
// 两处都只改这一份客户端 JS, 所以这一段把它抽出来真跑 (不复制第二份)

/** 从 client.js 里取一个 6 空格缩进的顶层函数源 */
function takeFunction(name) {
  const found = new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n      \\}`, 'u').exec(client)
  return found === null ? '' : found[0]
}

const itemKeySource = takeFunction('itemKey')
const signatureSource = takeFunction('flowSignature')
if (itemKeySource !== '' && signatureSource !== '') {
  const itemKey = new Function(`${itemKeySource}\nreturn itemKey`)()
  const flowSignature = new Function(
    'phaseThinking', `${itemKeySource}\n${signatureSource}\nreturn flowSignature`,
  )(() => false)

  const user = { who: 'user', id: 'user\u0001rpc-7', time: 1000, text: '在吗', attach: [], hasImage: false }
  // 修法 1 的正面: 同一节点的 `time` 两拍之间变了 (快照补齐 / 兜底重置), key 必须一样
  const later = { ...user, time: 2000 }
  const noTime = { ...user, time: 0 }
  const fallback = { who: 'assistant', id: 'fallback\u0001user\u0001rpc-7', time: 1000, text: '嗯', fallback: true }
  const fallbackLater = { ...fallback, time: 5_000 }
  const out = { who: 'assistant', id: 'out\u00015', seq: 5, time: 3_000, text: '好' }
  const outLater = { ...out, time: 3_600 }
  const edited = { ...user, text: '在吗?' }

  const pairs = [
    ['user 行换了 time', itemKey(user), itemKey(later)],
    ['user 行 time 读不到', itemKey(user), itemKey(noTime)],
    ['兜底行换了 time', itemKey(fallback), itemKey(fallbackLater)],
    ['她自己那行换了 time', itemKey(out), itemKey(outLater)],
  ]
  for (const [label, left, right] of pairs) {
    if (left === right) notes.push(`ok   itemKey: ${label} → 同一个 key (稳定身份)`)
    else failures.push(`client.js: itemKey 在「${label}」时换了 key —— 发送那一拍会整屏重建`)
  }
  if (itemKey(user) !== itemKey(edited)) {
    notes.push('ok   itemKey: 正文真的变了就换 key (该重建的那一条不省)')
  } else {
    failures.push('client.js: itemKey 对改了正文的同一行给了同一个 key —— 改了字屏上不更新')
  }
  // 没有 id 的老行 (重启前落下的? / 别的分支) 退回 seq+time, 与今天的行为一样
  const bare = { who: 'user', seq: 3, time: 1_000, text: 'x' }
  if (itemKey(bare) === itemKey({ ...bare, time: 2_000 })) {
    failures.push('client.js: 没有 id 的行也拿同一个 key —— 退回 time 的那条腿不见了')
  } else {
    notes.push('ok   itemKey: 没有 id 才退回 seq/time (与今天一样, 不会更糟)')
  }
  // 签名与身份必须是同一套键 (§2.2 第三条)
  if (flowSignature([user]) === flowSignature([later])) {
    notes.push('ok   flowSignature 与 itemKey 同一套键 (只有 time 变的那一拍签名不变)')
  } else {
    failures.push('client.js: flowSignature 还在看 time —— 签名说变了、身份说没变')
  }
  if (flowSignature([user]) !== flowSignature([edited])) {
    notes.push('ok   flowSignature: 正文变了签名就变 (闸门没有把这一拍挡掉)')
  } else {
    failures.push('client.js: flowSignature 对改了的正文没变 —— 那一拍不会重画')
  }
} else {
  failures.push('client.js: 抽不出 itemKey / flowSignature (名字或缩进改过?)')
}

// 修法 2: 前缀长度 + 尾部替换
expect('client.js', client, 'var common = 0')
expect('client.js', client, 'var tailOnly =')
expect('client.js', client, 'flowStats.tailReplaces += 1')
expect('client.js', client, 'var flowStats = { rebuilds: 0, appends: 0, tailReplaces: 0 }')
// 「正在做」的标识 (2026-11-10 主人: "正在做的标识改成右上角加黄色点表示"):
// 旧的两处 (左上角那颗会变蓝的点 / 流末尾那行「正在做…」) 都撤了, 只剩头栏那颗点
// 2026-11-10: 那颗点移到头像右下角, 并且一顆点三态 —— 绿 = 新对话, 蓝 = 对话中, 黄 = 正在做
if (client.includes("id = 'lwp-busy'")
  && /els\.busy\.setAttribute\('data-state', state\)/u.test(client)
  && client.includes('mark.appendChild(els.busy)')
  && client.includes('#lwp-busy{position:absolute')
  && client.includes('#lwp-busy[data-state="chat"]{background:#3b82f6}')
  && client.includes('#lwp-busy[data-state="busy"]{background:#f59e0b')) {
  notes.push('ok   状态点在头像右下角, 三态 (绿/蓝/黄) 由 updateBusy 给')
} else {
  failures.push('client.js: 状态点不在头像右下角, 或三态 (绿/蓝/黄) 没接上')
}
if (client.includes('flowWorking') || client.includes('lwp-badge') || client.includes("'lwp-working'")) {
  failures.push('client.js: 旧标识还留着 (flowWorking / lwp-badge / lwp-working) —— 本轮要的是只剩那颗黄点')
} else {
  notes.push('ok   旧标识已撤 (没有 flowWorking / lwp-badge / lwp-working)')
}
// 真的换场 / 删消息仍走整段重建 (判据 §4.3: 该涨的 rebuilds 仍要涨) —— 尾部替换那一条只能
// 放行"末尾 1~2 行", 而且它自己不许调 resetFlow
const tailAt = client.indexOf('var tailOnly =')
const tailCond = tailAt < 0 ? '' : client.slice(tailAt, client.indexOf('if (!sameHead && !tailOnly)', tailAt))
if (tailCond.includes('flowRows.length - 2') && tailCond.includes('plan.length - common <= 2')
  && !tailCond.includes('resetFlow')) {
  notes.push('ok   只有末尾 1~2 行变化才走尾部替换, 其余仍 resetFlow')
} else {
  failures.push('client.js: 尾部替换的门放得太宽 (不是"末尾 1~2 行"那一条)')
}

// ── 九、头栏改版 / 历史记录 / 身份 (2026-11-10) ──────────────────────────────
//
// 主人这一轮的四件事: ① 黄点 (上一节) ③ 头像与昵称 ④ 历史记录 + 「···」

// 「判断」「探索」合成一颗 `⋯`: 两颗旧按钮必须一个不剩, 菜单里那两行按新口径写 (#40, 2026-11-13)
if (!client.includes("'lwp-tab', '判断层'") && !client.includes("'lwp-tab', '工作'")) {
  notes.push('ok   头栏两颗旧按钮已撤 (判断 / 探索 收进 ⋯)')
} else {
  failures.push('client.js: 头栏还挂着「判断层」/「工作」两颗按钮')
}
// 菜单那两行与点进去的面板标题同口径: 点进去前后看到的是同一个词
expect('client.js', client, "['router', '判断',")
expect('client.js', client, "['work', '探索',")
expect('client.js', client, "h('h3', null, '判断')")
expect('client.js', client, "h('h3', null, '探索')")
expect('client.js', client, 'id = \'lwp-more-btn\'')
expect('client.js', client, 'id = \'lwp-history-btn\'')
expect('client.js', client, 'function renderMenuDrawer')
expect('client.js', client, "drawer === 'menu'")
expect('client.js', client, "'‹ 返回'")

// 历史窗: 搜索框 / 列表 / 底部那颗新建
expect('client.js', client, 'id = \'lwp-history\'')
expect('client.js', client, 'id = \'lwp-history-q\'')
expect('client.js', client, "'搜索历史对话'")
expect('client.js', client, "'开始新的对话'")
expect('client.js', client, 'function openHistory')
expect('client.js', client, 'function pickHistory')
expect('client.js', client, 'historyUnsub')
expect('client.js', client, "if (!switchTo(id, 'history'))")

// 身份: 头像与昵称从头栏一路到空态, 且**只用 textContent** (昵称是用户输入, 不许拼 HTML)
expect('client.js', client, 'function applyIdentity')
expect('client.js', client, 'els.brandName.textContent = name')
expect('client.js', client, 'els.heroName.textContent = name')
// 空态那张脸与头栏同一个形状 (2026-11-10 主人: "这个新对话屏幕中间的图案应用圆形, 与头像一致")
if (client.includes('#lwp-hero .lwp-hero-mark img{display:block;width:96px;height:96px;border-radius:999px;object-fit:cover}')) {
  notes.push('ok   空态那张脸也是圆裁 + 铺满 (与头栏头像同一个形状)')
} else {
  failures.push('client.js: 空态中间那张图不是圆形 (缺 border-radius:999px / object-fit:cover)')
}
expect('client.js', client, 'var AVATAR_CACHE = \'dsh.luwi.portal.avatar\'')
if (!/els\.brandName\.innerHTML|els\.heroName\.innerHTML/u.test(client)) {
  notes.push('ok   昵称只走 textContent (用户输入不拼 HTML)')
} else {
  failures.push('client.js: 昵称用了 innerHTML —— 名字里带尖括号就会炸')
}
// 头像那张图也要"版本没变不搬": 与背景同一个套路, 但缓存键分开
if (client.includes('cachedAvatar.ver === avatarVer') && client.includes('writeStored(AVATAR_CACHE')) {
  notes.push('ok   头像按版本缓存 (换头像才搬 base64, 与背景分两个键)')
} else {
  failures.push('client.js: 头像没有按版本缓存 —— 每次挂载都白搬一份 base64')
}

// 历史那一列的纯函数: 抽上线那份真跑
const historySource = takeFunction('historyRows')
if (historySource === '') {
  failures.push('client.js: 抽不出 historyRows (名字或缩进改过?)')
} else {
  const historyRows = new Function(`${historySource}\nreturn historyRows`)()
  const snapshot = {
    byId: {
      s_old: { id: 's_old', displayTitle: '上周那场', updatedAt: 100, blank: false },
      s_new: { id: 's_new', displayTitle: '最新那场', updatedAt: 900, blank: false },
      s_cur: { id: 's_cur', displayTitle: '当前这场', updatedAt: 500, blank: false },
      // 当前那场可能还没有标题, 也可能一句都没说 (blank)
      s_blank: { id: 's_blank', displayTitle: '', updatedAt: 950, blank: true },
      s_notime: { id: 's_notime', displayTitle: '没时间的', updatedAt: 0, blank: false },
    },
  }
  const rows = historyRows(snapshot, '', 's_cur')
  const ids = rows.map((row) => row.id)
  if (JSON.stringify(ids) === JSON.stringify(['s_cur', 's_new', 's_old', 's_notime'])) {
    notes.push('ok   historyRows: 当前置顶 + 其余按 updatedAt 倒序 + 没时间的沉底')
  } else {
    failures.push(`historyRows 排错了: ${JSON.stringify(ids)}`)
  }
  if (!ids.includes('s_blank')) notes.push('ok   historyRows: 空白场不进历史')
  else failures.push('historyRows: 把空白场列进了历史')
  if (rows[0].current === true && rows.slice(1).every((row) => row.current === false)) {
    notes.push('ok   historyRows: 只有当前那场带 current')
  } else {
    failures.push('historyRows: current 标记不对')
  }
  // 搜索: 标题 / id 尾巴都算, 大小写不敏感; 一输字就严格过滤 (当前那场也照滤, 除非它自己命中)
  const byTitle = historyRows(snapshot, '最新', 's_cur').map((row) => row.id)
  const byIdTail = historyRows(snapshot, 'S_OLD', 's_cur').map((row) => row.id)
  if (JSON.stringify(byTitle) === JSON.stringify(['s_new'])
    && JSON.stringify(byIdTail) === JSON.stringify(['s_old'])) {
    notes.push('ok   historyRows: 搜索命中标题与 id, 且不区分大小写 (搜索时严格过滤)')
  } else {
    failures.push(`historyRows 过滤不对: title=${JSON.stringify(byTitle)} id=${JSON.stringify(byIdTail)}`)
  }
  if (historyRows(snapshot, '没有这一场', 's_cur').length === 0) {
    notes.push('ok   historyRows: 搜不到时是空表 (由界面说「没有匹配的对话」)')
  } else {
    failures.push('historyRows: 搜不到时还留了行')
  }
  // 没有标题的那场: 回退成一句话, 不是空行
  const noTitle = historyRows({ byId: { s_x: { id: 's_x', updatedAt: 10, blank: false } } }, '', null)
  if (noTitle.length === 1 && noTitle[0].title === '新对话') {
    notes.push('ok   historyRows: 没有 displayTitle 时回退成「新对话」')
  } else {
    failures.push('historyRows: 没有标题时没回退')
  }
}

// ── 十、历史恢复被账本拽回 (2026-11-10) ───────────────────────────────────────
//
// 方案 `docs/Luwi-门户历史恢复被拽回-方案-2026-11-10.md`: 点历史只换了视野, 没换 mainView,
// 3 s 之后 pollLedger 把界面拽回门户自动开的那张空场。三件修法各有一条数字判据

const ledgerSource = takeFunction('ledgerShouldFollow')
if (ledgerSource === '') {
  failures.push('client.js: 抽不出 ledgerShouldFollow (名字或缩进改过?)')
} else {
  const ledgerShouldFollow = new Function(`${ledgerSource}\nreturn ledgerShouldFollow`)()
  const cases = [
    // [说明, 账本, 当前场, 上次读到的 at, 期不期望跟]
    ['id 相同 (已经在这场) → 不跟', { id: 's_cur', usable: true, at: 2000 }, 's_cur', 1000, false],
    ['新 id + at 变大 (球说一句 / 门户写账) → 跟', { id: 's_new', usable: true, at: 2000 }, 's_cur', 1000, true],
    ['新 id + at 没变 (点历史) → 不跟', { id: 's_new', usable: true, at: 1000 }, 's_cur', 1000, false],
    ['冷启动 lastAt 还是 0 → 跟一次', { id: 's_new', usable: true, at: 1000 }, 's_cur', 0, true],
    ['账本过期 (usable=false) → 不走这一条', { id: 's_new', usable: false, at: 2000 }, 's_cur', 1000, false],
    ['账本读不到 → 不跟', null, 's_cur', 1000, false],
  ]
  let ok = true
  for (const [label, ledger, currentId, lastAt, want] of cases) {
    const got = ledgerShouldFollow(ledger, currentId, lastAt)
    if (got !== want) {
      failures.push(`ledgerShouldFollow 判错了: ${label} (got ${String(got)})`)
      ok = false
    }
  }
  if (ok) notes.push('ok   ledgerShouldFollow: 只有账本被重写过才跟 (点历史不被拽)')
}
expect('client.js', client, 'ledgerShouldFollow(ledger, sessionId, lastLedgerAt)')
expect('client.js', client, 'lastLedgerAt = ledgerAt')
expect('client.js', client, "switchTo(ledger.id, 'ledger')")

// B1: 人点的换场要把 mainView 一起带过去 (老写法只有轻腿, 于是被 listUnsub 反拽)
const followSource = takeFunction('follow')
if (followSource !== ''
  && followSource.includes('options.align')
  && followSource.includes('ctx.uiWorkspace.openSession(id)')) {
  notes.push('ok   follow 带 align 腿 (轻腿成功之后也走 openSession, 让 mainView 跟过去)')
} else {
  failures.push('client.js: follow 没有 align 腿 —— 点历史时 mainView 不跟, 又被拽回')
}

// B3: 换场入口收成 switchTo, 历史这条走 'history' (source 决定 align 与写不写账本)
const pickSource = takeFunction('pickHistory')
if (pickSource !== '' && pickSource.includes("switchTo(id, 'history')") && !pickSource.includes('follow(id)')) {
  notes.push("ok   pickHistory 走 switchTo(id, 'history') (不再是单腿 follow)")
} else {
  failures.push('client.js: pickHistory 还是单腿 follow —— 恢复两三秒又被清空')
}
const switchSource = takeFunction('switchTo')
if (switchSource !== ''
  && switchSource.includes('switch by=')
  && switchSource.includes("source === 'history'")
  && switchSource.includes("source === 'new'")
  && switchSource.includes('align: true')
  && switchSource.includes("source === 'list'")) {
  notes.push('ok   switchTo 按 source 分腿, 每次打一行 switch by=')
} else {
  failures.push('client.js: switchTo 没按 source 分腿 (或少了那行 switch by= 日志)')
}

// ── 十一、附件条在输入框上方 / 表情先进待发栏 (2026-11-10) ─────────────────────
//
// 主人: "附件发图片和发表情包, 应该要在输入框上方显示, 像 dsh 原生那样". 两件都是结构, 不是样式:
// 1) `#lwp-card` 的子节点顺序 = 附件行 -> 文本区 -> 工具行 (dsh 的 InputBar 就是这个顺序);
// 2) 点表情只进待发栏 (`stageSticker`), 不调 `send()`, 发不发由那颗发送钮说了算

const railAt = client.indexOf('card.appendChild(els.attachRow)')
const inputAt = client.indexOf('card.appendChild(els.input)')
if (railAt > 0 && inputAt > railAt) {
  notes.push('ok   附件条 append 在文本区之前 (输入框上方)')
} else {
  failures.push('client.js: 附件条又挂到文本区后面了 —— 主人在输入框上方看不到待发附件')
}

expect('client.js', client, '#lwp-attach-row{display:flex;flex-wrap:wrap;align-items:flex-start;gap:8px;')
expect('client.js', client, 'margin-bottom:-6px')
expect('client.js', client, '.lwp-attach-thumb{position:relative;flex:none;width:64px;height:64px;')
expect('client.js', client, '.lwp-attach-thumb img{display:block;width:100%;height:100%;object-fit:cover}')
expect('client.js', client, '.lwp-attach-x{position:absolute;top:3px;right:3px;')
expect('client.js', client, 'function attachThumb')
expect('client.js', client, 'function attachSrc')
expect('client.js', client, "'/lw-out/in/' + encodeURIComponent")
expect('client.js', client, "one.kind === 'image' ? attachThumb(one) : attachChip(one)")

const stageSource = takeFunction('stageSticker')
if (stageSource === '') {
  failures.push('client.js: 抽不出 stageSticker (表情还是点一下就发?)')
} else {
  if (!stageSource.includes('send(')) {
    notes.push('ok   点表情只进待发栏 (stageSticker 内不调 send)')
  } else {
    failures.push('client.js: stageSticker 里还在调 send —— 点一下就直接发出去了')
  }
  if (stageSource.includes('attach.push(one)') && stageSource.indexOf('attach.push(one)') < stageSource.indexOf('fetch(')) {
    notes.push('ok   stageSticker 先 push 占位再取字节 (连点几张顺序不翻)')
  } else {
    failures.push('client.js: stageSticker 没有先占位 —— 连点几张时先后会随 fetch 完成顺序翻')
  }
}
if (client.includes('sendSticker(')) {
  failures.push('client.js: 旧的 sendSticker 还在 (表情仍会点一下立即发)')
} else {
  notes.push('ok   旧的 sendSticker 已删')
}
if (client.includes('cell.onclick = function () { stageSticker(name) }')) {
  notes.push('ok   表情格子的 onclick 走 stageSticker')
} else {
  failures.push('client.js: 表情格子的 onclick 没有走 stageSticker')
}

// ── 十二、图片发送失败要说出来 (2026-11-12, 落实表 #35) ────────────────────────
//
// 主人 (issue #53): "选图 → 点确定 → 没反应". 三条路以前都是静默 —— WebView 没进
// `onShowFileChooser` / 选择器回来是空的 / 太大 / 读字节等超时. 现在它们共用一张三选一的说法表
// (`webview 未回调` / `文件过大` / `上传超时`), 一句话进对话流 (`who:'error'`, 与 dsh 的 turn-error
// 同一档), 同时让宿主把机型 + WebView 版本各一行打进 logcat

const failTableSource = (() => {
  const at = client.indexOf('var IMAGE_FAIL = {')
  if (at < 0) return ''
  const end = client.indexOf('\n      }', at)
  return end < 0 ? '' : client.slice(at, end + '\n      }'.length)
})()
const imageFailSource = takeFunction('imageFail')
const pickStateSource = takeFunction('pickState')

if (failTableSource === '' || imageFailSource === '') {
  failures.push('client.js: 抽不出 IMAGE_FAIL / imageFail —— 图片失败还是静默')
} else {
  const table = new Function(`${failTableSource}\nreturn IMAGE_FAIL`)()
  const wanted = { noCallback: 'webview 未回调', tooBig: '文件过大', timeout: '上传超时' }
  let tableOk = true
  for (const key of Object.keys(wanted)) {
    if (table[key] !== wanted[key]) {
      failures.push(`client.js: IMAGE_FAIL.${key} 应该是「${wanted[key]}」, 实际是 ${JSON.stringify(table[key])}`)
      tableOk = false
    }
  }
  if (tableOk) notes.push('ok   IMAGE_FAIL 三选一与判据逐字一致 (webview 未回调 / 文件过大 / 上传超时)')

  // 真跑: 说法表 → 气泡文案, 别的话一律按「上传超时」, 最多留三条
  const stored = []
  let renders = 0
  const imageFail = new Function('IMAGE_FAIL', 'imageFails', 'call', 'renderFlow',
    `${imageFailSource}\nreturn imageFail`)(
    table, stored, () => ({ ok: true }), () => { renders += 1 },
  )
  imageFail(table.noCallback)
  if (stored.length === 1 && stored[0].text === '图片发送失败：webview 未回调') {
    notes.push('ok   imageFail: 屏上那句就是「图片发送失败：<原因>」')
  } else {
    failures.push(`client.js: imageFail 没写出「图片发送失败：webview 未回调」(实际 ${JSON.stringify(stored[0])})`)
  }
  imageFail('别的什么')
  if (stored[1] && stored[1].text === '图片发送失败：上传超时') {
    notes.push('ok   imageFail: 三种以外的说法按「上传超时」兜住 (屏上不写没人对得上的话)')
  } else {
    failures.push('client.js: imageFail 对没见过的说法没有兜底')
  }
  imageFail(table.tooBig)
  imageFail(table.timeout)
  imageFail(table.timeout)
  if (stored.length === 3) notes.push('ok   imageFail: 只留最近三条 (连败十次不把对话顶走)')
  else failures.push(`client.js: imageFail 的条数不是 3 (实际 ${String(stored.length)})`)
  if (renders === 5) notes.push('ok   imageFail: 每一条都真去重画了流 (不是只记不画)')
  else failures.push(`client.js: imageFail 没有每次都重画 (renderFlow 调了 ${String(renders)} 次, 应为 5)`)

  // 三条路各自接上了: 点 `+` 的计时器 / 宿主回话 / 太大在读数之前就判 / 读字节有上限
  if (client.includes('armPickWatch()') && client.indexOf('armPickWatch()') < client.indexOf('els.file.click()')) {
    notes.push('ok   点 `+` 先挂"WebView 没回调"的计时器, 再点 input')
  } else {
    failures.push('client.js: pickFile 没有在 click 之前挂计时器 —— WebView 不回调时还是静默')
  }
  const onFilesSource = takeFunction('onFilesChosen')
  if (onFilesSource.includes('imageFail(IMAGE_FAIL.tooBig)')
    && onFilesSource.indexOf('imageFail(IMAGE_FAIL.tooBig)') < onFilesSource.indexOf('readImage(file)')) {
    notes.push('ok   文件过大在读字节之前就报 (不是读完再报)')
  } else {
    failures.push('client.js: onFilesChosen 没有在读字节之前判大小')
  }
  // 8 个空格缩进 = 函数体里的调用 (6 个空格那处是它自己的定义)
  const watched = client.split('\n        armUploadWatch(one)').length - 1
  if (watched === 2) notes.push('ok   两条读字节的路 (readImage / stashOne) 都挂了上传超时')
  else failures.push(`client.js: armUploadWatch 只在 ${String(watched)} 处被调 (应 2 处)`)

  // 宿主那侧的口径: 四个词 + 一处 JS 入口 + logcat 两行
  expect('client.js', client, 'pickState: pickState')
  expect('client.js', client, 'pickState: function (state)')
  expect('client.js', client, "call('portalImageFail', text)")
  expect('client.js', client, 'id: imageFails[f].id')
  expect('HostScreen.kt', screen, "pickState('$state')")
  expect('HostScreen.kt', screen, 'private const val PICK_SHOWN = "shown"')
  expect('HostScreen.kt', screen, 'private const val PICK_PICKED = "picked"')
  expect('HostScreen.kt', screen, 'private const val PICK_EMPTY = "empty"')
  expect('HostScreen.kt', screen, 'private const val PICK_NONE = "none"')
  expect('HostScreen.kt', screen, 'view.pickState(PICK_SHOWN)')
  expect('HostScreen.kt', screen, 'view.pickState(PICK_NONE)')
  expect('HostScreen.kt', screen, 'view.pickState(PICK_EMPTY)')
  expect('HostScreen.kt', screen, 'view.pickState(PICK_PICKED)')
  expect('PortalBridge.kt', portalBridge, 'fun portalImageFail(reason: String): String')
  expect('PortalBridge.kt', portalBridge, 'Log.w(LOOK_TAG, "image send failed: $text")')
  expect('PortalBridge.kt', portalBridge, 'device ${Build.MANUFACTURER} ${Build.MODEL}')
  expect('PortalBridge.kt', portalBridge, 'webview $label (major ${info?.major ?: 0})')

  // 宿主回话那一支: 只有 shown / picked 撤计时器, empty / none 要报
  if (pickStateSource === '') {
    failures.push('client.js: 抽不出 pickState (宿主那句回话没人接)')
  } else {
    const reasons = []
    let disarms = 0
    const pickState = new Function('disarmPickWatch', 'imageFail', 'IMAGE_FAIL',
      `${pickStateSource}\nreturn pickState`)(() => { disarms += 1 }, (reason) => reasons.push(reason), table)
    pickState('shown')
    pickState('picked')
    if (reasons.length === 0) notes.push('ok   pickState: shown / picked 只撤计时器, 不报失败')
    else failures.push(`client.js: pickState 对 shown/picked 也报了失败 (${reasons.join(',')})`)
    pickState('empty')
    pickState('none')
    if (reasons.length === 2 && reasons.every((one) => one === table.noCallback)) {
      notes.push('ok   pickState: empty / none 都报「webview 未回调」(选择器没结果 / 起不来)')
    } else {
      failures.push(`client.js: pickState 对 empty/none 没报「webview 未回调」(实际 ${reasons.join(',')})`)
    }
    if (disarms === 4) notes.push('ok   pickState: 四种回话都先撤计时器 (不会二次报)')
    else failures.push(`client.js: pickState 撤计时器的次数不是 4 (实际 ${String(disarms)})`)
  }
}

// ── 十三、首启自动落进默认工作区, 界面上没有「选工作区」入口 (2026-11-13) ────────
//
// 主人 2026-11-13 改口径: 原来那颗「选工作区」按钮与 `#lwp-pick` 那一窗整个删掉, 首启由
// `landInDefaultWorkspace` 静默把 `<工作区根>/Luwi` 备好再落进去 (备目录 -> `workspaces.create`
// -> 补拍 -> `openWorkspace`), 失败只留一句提示不弹窗。这里钉三件:
// ① 那一套的名字一个都不许留 ② 自动落位那条链真的接着 ③ 挑默认工作区那条纯函数真跑

const goneNames = ['lwp-pick-workspace', 'lwp-pick-card', 'function pickWanted', 'function openPick',
  'function pickRows', 'function syncHeroPick', 'function ensureWorkspaces', 'function renderPick']
const stillThere = goneNames.filter(name => client.includes(name))
if (stillThere.length === 0) {
  notes.push('ok   选工作区: 那颗按钮 / 那一窗 / 旧兜底函数全删了 (首启改成自动落位)')
} else {
  failures.push(`client.js: 选工作区那一套还有残留 (${stillThere.join(' ')})`)
}

const defaultSource = takeFunction('defaultWorkspaceId')
const landSource = takeFunction('landInDefaultWorkspace')
const ensureSource = takeFunction('ensureWorkspace')
if (defaultSource === '' || landSource === '' || ensureSource === '') {
  failures.push('client.js: 抽不出 defaultWorkspaceId / landInDefaultWorkspace / ensureWorkspace (首启自动落位那条链断了)')
} else {
  const pickDefault = new Function(`${defaultSource}\nreturn defaultWorkspaceId`)()
  const items = [
    { workspaceId: 'w1', path: '/sdcard/DSH/dsh-ball', sessionIds: [] },
    // 尾部 `/` 要归一: 宿主写目录时带不带斜杠都算同一个
    { workspaceId: 'w2', path: '/sdcard/DSH/Luwi/', sessionIds: [] },
    // 没有 id 的那一条不是工作区, 不参与退路
    { path: '/sdcard/DSH/ghost', sessionIds: [] },
  ]
  const shape = [
    pickDefault(items, '/sdcard/DSH/Luwi'),
    pickDefault(items, '/sdcard/DSH/elsewhere'),
    pickDefault([], '/sdcard/DSH/Luwi'),
  ].join(',')
  if (shape === 'w2,w1,') {
    notes.push('ok   defaultWorkspaceId: 按路径认 Luwi (尾部 / 归一), 认不到退第一条, 空表回空串')
  } else {
    failures.push(`defaultWorkspaceId 选错了: ${shape}`)
  }
  if (ensureSource.includes("call('portalWorkspace', true)")
    && ensureSource.includes('service.create({ path: path })')
    && landSource.includes('enterWorkspace(id)')) {
    notes.push('ok   landInDefaultWorkspace: 备目录 -> 注册 -> 补拍 -> 落进去, 全程不开窗')
  } else {
    failures.push('client.js: 自动落位那条链没接上 (portalWorkspace / create / enterWorkspace)')
  }
  const autoSource = takeFunction('autoStart')
  const newSource = takeFunction('newConversation')
  if (autoSource.includes('landInDefaultWorkspace(') && newSource.includes('landInDefaultWorkspace(')) {
    notes.push('ok   autoStart / newConversation 都走自动落位 (不再弹一窗让人点)')
  } else {
    failures.push('client.js: autoStart 或 newConversation 没走 landInDefaultWorkspace')
  }
}

// ── 十四、主动场那句进当前对话 + 开场隐藏 (2026-11-12, 落实表 #38) ──────────────
//
// 主人 2026-11-12 的原话: "主动对话回复的消息只在那个主动对话里, 用户一打开应用不会看到, 只能通过
// 历史对话查看; 要求回复的消息发送时要放到门户, 用户一打开就能看到, 并且不能显示发送的提示词;
// 门户对话记录不可自动清空, 除非用户重启应用或者开启新对话"。
// 2026-11-13 三次派单把口径收紧成: **那句要出现在当前对话 (门户首屏) 里, 不允许只落在那一场独立会话的历史
// 对话里**, 且上一条历史仍在 (条数 = 触发前 + 1)。
//
// 所以这里钉五件, 都是把源码里的纯函数抽出来**真跑**:
// ① 那一场是新的才投一次 (`proactiveNew`)
// ② 不换场: 她的那几句进本场时间线 (`echoItemOf` + `orderTimeline` 真跑, 落在这条线末尾)
// ③ 门户记录跨场只增不减 (`appendRecord`), 只有「开新对话」/ 点历史清 (`dropRecord`)
// ④ 开场提示词整条不画 (`isProactiveStart`), 会话自己那一份历史一个字不动
// ⑤ 回前台 / `lw/out` 变了一下都要把那一场的 jsonl 重取一遍

const hostMark = grab(hostPlugin, /const PROACTIVE_START_MARK = '([^']+)'/)
const clientMark = grab(client, /var PROACTIVE_START_MARK = '([^']+)'/)
if (hostMark !== null && hostMark === clientMark) {
  notes.push(`ok   开场那一句的头一段两侧逐字相同 (${hostMark})`)
} else {
  failures.push(`开场记号对不上: host-plugin ${String(hostMark)} / client.js ${String(clientMark)}`)
}
expect('client.js', client, 'function isProactiveStart')
expect('client.js', client, 'function proactiveNew')
expect('client.js', client, 'function echoItemOf')
expect('client.js', client, 'function appendRecord')
expect('client.js', client, 'function dropRecord')
expect('client.js', client, 'appendRecord(carried, orderTimeline(')
// **不换场**: 那一场只当一条数据源 (portalOut 认的是 `lw/out/<会话>.jsonl`), 屏上换场那一条不许有
// (只看 `switchTo(...)` 的调用, `source.via === 'proactive'` 那个记号不在此列)
if (/switchTo\([^)]*'proactive'/u.test(client) || client.includes('switchTo(run.session')) {
  failures.push('client.js: 主动场还在换场 (主人 2026-11-12: 那句要进当前对话, 不是换到那一场去)')
} else {
  notes.push('ok   主动场不换场 (只把那一场的 jsonl 接进当前对话)')
}
expect('client.js', client, 'loadEcho(true)')
expect('client.js', client, "call2('portalOut', echoSession, echoNext)")
// 回前台先补一次全量: 本场与那一场各取一遍
const visibleSource = takeFunction('onVisible')
if (visibleSource !== '' && visibleSource.includes('loadOut(true)') && visibleSource.includes('loadEcho(true)')
  && visibleSource.includes('pollLedger()')) {
  notes.push('ok   回到前台先重取两次全量 (本场 + 那一场) 再立刻问一拍账本')
} else {
  failures.push('client.js: onVisible 没有把本场与那一场都重取 (回到前台会少几条)')
}
// `lw/out` 一变就补: 她刚说的那句不必等下一拍轮询
const onOutSource = (() => {
  const at = client.indexOf('onOut: function () {')
  return at < 0 ? '' : client.slice(at, client.indexOf('\n        },', at))
})()
if (onOutSource.includes('loadOut(false)') && onOutSource.includes('loadEcho(false)')) {
  notes.push('ok   onOut 两条流都补 (本场 + 那一场)')
} else {
  failures.push('client.js: onOut 只补了本场 —— 主动场那句要等 3 s 轮询')
}
// 宿主: 开场那一句带 `via: 'proactive'`; 别的那几条 (球 / 语音) 还是 `via: 'voice'`
expect('host-plugin/index.mjs', hostPlugin, "via: 'proactive'")
expect('host-plugin/index.mjs', hostPlugin, "via = 'voice'")
expect('host-plugin/index.mjs', hostPlugin, ', auto.images, via)')
// 宿主那份账 (proactive.json 的 run) 由桥交给页面: `session` / `startedAt` 两个读数
expect('PortalBridge.kt', portalBridge, 'put("proactive"')
expect('PortalBridge.kt', portalBridge, 'proactive.json')

const startSource = takeFunction('isProactiveStart')
if (startSource === '') {
  failures.push('client.js: 抽不出 isProactiveStart (名字或缩进改过?)')
} else {
  /** 判据里的 `textOf`: 只认 text 块, 与 client.js 那份同一个口径 */
  const textOfBlocks = (blocks) => {
    const parts = []
    for (const block of Array.isArray(blocks) ? blocks : []) {
      if (block && block.type === 'text') parts.push(String(block.text === undefined ? '' : block.text))
    }
    return parts.join('\n')
  }
  const mark = clientMark === null ? '' : clientMark
  const isProactiveStart = new Function(
    'textOf', 'PROACTIVE_START_MARK', `${startSource}\nreturn isProactiveStart`,
  )(textOfBlocks, mark)
  const startText = `${mark}, 不是主人刚说的话.\n\n启动顺序: 最新探索摘要 -> 记着的事 -> 决定要不要开口.`
  const cases = [
    ['带 via: proactive 的那一条', { kind: 'user', source: { kind: 'user', via: 'proactive' }, content: [{ type: 'text', text: '看看今天' }] }, true],
    ['老会话 (没有那个记号, 只有开场白本身)', { kind: 'user', source: { kind: 'user', via: 'voice' }, content: [{ type: 'text', text: startText }] }, true],
    ['主人自己发的一句', { kind: 'user', source: { kind: 'user', rpcId: 'rpc-1' }, content: [{ type: 'text', text: '在吗' }] }, false],
    ['球上转进来的一句 (via: voice)', { kind: 'user', source: { kind: 'user', via: 'voice' }, content: [{ type: 'text', text: '帮我看看今天的日程' }] }, false],
    ['开场白只是被引用在句子中间', { kind: 'user', content: [{ type: 'text', text: `他说 ${startText}` }] }, false],
  ]
  let ok = true
  for (const [label, node, want] of cases) {
    const got = isProactiveStart(node)
    if (got !== want) {
      failures.push(`isProactiveStart 判错了: ${label} (got ${String(got)})`)
      ok = false
    }
  }
  if (ok) notes.push('ok   开场提示词整条不画 (via: proactive 与那句开场白都认, 主人自己的话照画)')
}

const proactiveNewSource = takeFunction('proactiveNew')
if (proactiveNewSource === '') {
  failures.push('client.js: 抽不出 proactiveNew (名字或缩进改过?)')
} else {
  const proactiveNew = new Function(`${proactiveNewSource}\nreturn proactiveNew`)()
  const run = { session: 's_proactive', startedAt: 2000 }
  const table = [
    ['这一挂之后新开的那一场', run, 1000, true],
    ['已经投过这一场', run, 2000, false],
    ['比挂载还早的那一场 (重启前留下的)', run, 5000, false],
    ['文件里还没开会话', { session: '', startedAt: 3000 }, 0, false],
    ['没有 startedAt', { session: 's_x', startedAt: 0 }, 0, false],
    ['读不到那一份', null, 0, false],
  ]
  let ok = true
  for (const [label, one, seen, want] of table) {
    const got = proactiveNew(one, seen)
    if (got !== want) {
      failures.push(`proactiveNew 判错了: ${label} (got ${String(got)})`)
      ok = false
    }
  }
  if (ok) notes.push('ok   proactiveNew: 只有这一挂之后新开的那一场投一次, 挂载前留下的不投')
}

const recordSource = takeFunction('appendRecord')
const echoSource = takeFunction('echoItemOf')
const itemSource = takeFunction('outItemOf')
if (recordSource === '' || echoSource === '' || itemSource === '') {
  failures.push('client.js: 抽不出 appendRecord / echoItemOf / outItemOf (名字或缩进改过?)')
} else {
  const appendRecord = new Function('RECORD_MAX', `${recordSource}\nreturn appendRecord`)(240)
  const ECHO_SEQ_BASE = 1000 * 1000
  const outItemOf = new Function(`${itemSource}\nreturn outItemOf`)()
  const echoItemOf = new Function('outItemOf', 'ECHO_SEQ_BASE',
    `${echoSource}\nreturn echoItemOf`)(outItemOf, ECHO_SEQ_BASE)

  // ② 那句落在当前这条时间线的末尾 (条数 = 触发前 + 1), 而且不是另开一场
  const before = [
    { who: 'user', id: 'user\u0001rpc-1', seq: 1, time: 500, text: '在吗' },
    { who: 'assistant', id: 'out\u00017', seq: 7, time: 600, text: '在的' },
  ]
  const echo = echoItemOf('s_proactive', { seq: 1, at: 900, text: '下班了吗' })
  const after = appendRecord(before, [echo])
  if (after.length === 3 && after[2] === echo) {
    notes.push('ok   门户记录: 上一条历史仍在, 条数 = 触发前 + 1, 最新那条在最后')
  } else {
    failures.push(`门户记录接错了: ${JSON.stringify(after.map((one) => one.text))}`)
  }
  if (echo.id !== before[1].id && echo.seq >= 1000 * 1000) {
    notes.push('ok   echoItemOf: 身份带场次、seq 抬到本场之上 (与本场 jsonl 不撞)')
  } else {
    failures.push(`echoItemOf 的身份/seq 不对: id=${String(echo.id)} seq=${String(echo.seq)}`)
  }
  // 与 `orderTimeline` 合起来跑: 那一句属于它前面那一轮, 且排在更晚的那一轮之前
  const orderSource = takeFunction('orderTimeline')
  if (orderSource === '') {
    failures.push('client.js: 抽不出 orderTimeline (主动场那句归不了轮)')
  } else {
    const orderTimeline = new Function(`${orderSource}\nreturn orderTimeline`)()
    const users = [
      { who: 'user', id: 'u1', time: 500, text: '在吗' },
      { who: 'user', id: 'u2', time: 1200, text: '人呢' },
    ]
    const ordered = orderTimeline(users, [echo], [])
    if (ordered.map((one) => one.text).join(',') === '在吗,下班了吗,人呢') {
      notes.push('ok   orderTimeline: 主动场那句按时间归到它那一轮, 后面那一轮仍在它后面')
    } else {
      failures.push(`主动场那句归轮错了: ${ordered.map((one) => one.text).join(',')}`)
    }
  }
  // ③ 同一个身份不重复抄 + 上限
  if (appendRecord(after, before).length === 3) {
    notes.push('ok   门户记录: 同一个身份不重复抄 (连换两次场也不多一条)')
  } else {
    failures.push('门户记录: 同一个身份被抄成两条 —— 换场前后同一句会画两遍')
  }
  const many = []
  for (let i = 0; i < 300; i += 1) many.push({ who: 'user', id: `u-${String(i)}`, text: String(i) })
  const capped = appendRecord(many, [])
  if (capped.length === 240 && capped[capped.length - 1].text === '299') {
    notes.push('ok   门户记录: 超过 240 条只留最新那一段 (不会一场一场攒到无限长)')
  } else {
    failures.push(`门户记录没有上限或截错了: ${String(capped.length)} 条`)
  }
}

const switchWithRecord = takeFunction('switchTo')
if (switchWithRecord === ''
  || !/source === 'new'[\s\S]{0,120}dropRecord\(\)/u.test(switchSource)
  || !/source === 'ledger' \|\| source === 'list'/u.test(switchWithRecord)
  || !switchWithRecord.includes('carryRecord()')) {
  failures.push('client.js: switchTo 没分「自动换场抄记录 / 开新对话清空」两条腿')
} else {
  notes.push('ok   switchTo: 自动换场 (账本 / 会话表) 抄记录, 「开新对话」与点历史 dropRecord')
}
// 清空只在 dropRecord 一处定义、switchTo 里两处调: 别的地方 (退后台 / 收门户 / 换场) 一条都不许清
const dropDefined = /function dropRecord\(\) \{[\s\S]*?carried = \[\]/u.test(client)
const dropCalls = (switchWithRecord.match(/dropRecord\(\)/gu) ?? []).length
if (dropDefined && dropCalls === 2) notes.push('ok   门户记录只在两处清空 (「开新对话」与点历史)')
else failures.push(`client.js: 清门户记录的地方不对 (定义=${String(dropDefined)} 调用=${String(dropCalls)})`)
// ── 十五、长按文件出菜单: 复制路径 / 用其它应用打开 (2026-11-13, 落实表 #41) ──────
//
// 主人: "在前台里, 如果有文件, 比如 doc/ppt/jpg 等, 允许长按出菜单, 可选复制路径, 用其它应用打开"
// 点一下仍是预览 (2026-11-09 那条不能退回去); 长按多出来的只是这两件事。四件事各有一条判据:
// 1) 两份能长按的载体 (文件 chip 与图) 都接上了, 且长按抬手后的那条 click 被吞掉
// 2) 路径只有一处拼法 (`OutPaths`), 复制走系统剪贴板 (`portalCopyPath`), 交给系统仍走 `luwi-open://`
// 3) 菜单夹进视口 (`clampMenuPos`), 手势有滑动阈值 (`pressMoved`) —— 两条纯函数真跑
// 4) 收起的三条路都在 (点空白 / 选一条 / 滑动与下线)

expect('client.js', client, 'function attachLongPress')
expect('client.js', client, 'function consumeHeld')
expect('client.js', client, 'function openFileMenu')
expect('client.js', client, 'function fileMenuPlan')
expect('client.js', client, 'function closeFileMenu')
expect('client.js', client, 'function clampMenuPos')
expect('client.js', client, 'function pressMoved')
expect('client.js', client, 'var LONG_PRESS_MS = 520')
expect('client.js', client, 'var LONG_PRESS_SLOP = 10')
expect('client.js', client, "els.fileMenu.id = 'lwp-file-menu'")
expect('client.js', client, '#lwp-file-menu{position:fixed;z-index:2147483003;')
expect('client.js', client, "fileMenuItem('复制路径'")
expect('client.js', client, "fileMenuItem('用其它应用打开'")
expect('client.js', client, "call('portalCopyPath', file.rel)")
expect('client.js', client, "'luwi-open://file?path=' + encodeURIComponent(got.path)")

const longPressWired = client.split('attachLongPress(wrap, ').length - 1
if (longPressWired === 2) {
  notes.push('ok   文件 chip 与图都接了长按 (attachLongPress 两处)')
} else {
  failures.push(`client.js: attachLongPress 接了 ${String(longPressWired)} 处 (应为 2: fileChip / imageBubble)`)
}
const heldGuarded = client.split('if (consumeHeld(wrap)) return').length - 1
if (heldGuarded === 2) {
  notes.push('ok   长按之后那条 click 被吞掉 (不会菜单和预览窗一起弹)')
} else {
  failures.push(`client.js: consumeHeld 只在 ${String(heldGuarded)} 处 (应为 2)`)
}

const longPressSource = takeFunction('attachLongPress')
if (longPressSource === '') {
  failures.push('client.js: 抽不出 attachLongPress (长按没有那条手势了)')
} else {
  const needs = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerleave', 'contextmenu']
  const missing = needs.filter((one) => !longPressSource.includes(one))
  if (missing.length === 0) notes.push('ok   长按四条退路 + 原生 contextmenu 都接上了')
  else failures.push(`client.js: attachLongPress 缺 ${missing.join(' / ')}`)
  if (longPressSource.includes('pressMoved(')) notes.push('ok   挪出阈值就撤 (滑动对话流时不会弹菜单)')
  else failures.push('client.js: attachLongPress 里没有滑动阈值')
}

const docDownSource = takeFunction('onDocPointerDown')
if (docDownSource.includes('els.fileMenu') && docDownSource.includes('closeFileMenu()')) {
  notes.push('ok   点空白处收起那颗菜单')
} else {
  failures.push('client.js: onDocPointerDown 没有收起文件菜单 (它会一直挂在屏上)')
}
const unmountSource = takeFunction('unmount')
if (unmountSource.includes('closeFileMenu()')) {
  notes.push('ok   下线 (unmount) 时那颗菜单一起收')
} else {
  failures.push('client.js: unmount 没有 closeFileMenu')
}
if (client.includes("els.flow.addEventListener('scroll', function () { closeFileMenu() }")) {
  notes.push('ok   对话流一滑动就收起 (菜单与那一份文件不再对得上)')
} else {
  failures.push('client.js: 对话流 scroll 没有收起文件菜单')
}

// 两条纯函数真跑: 手势阈值 / 菜单夹进视口
const movedSource = takeFunction('pressMoved')
const clampSource = takeFunction('clampMenuPos')
if (movedSource === '' || clampSource === '') {
  failures.push('client.js: 抽不出 pressMoved / clampMenuPos (长按与菜单落点的判法丢了)')
} else {
  const slop = Number(grab(client, /var LONG_PRESS_SLOP = (\d+)/))
  const pressMoved = new Function('LONG_PRESS_SLOP', `${movedSource}\nreturn pressMoved`)(slop)
  const movedCases = [
    [3, 4, false], // 斜着挪 5px: 仍是"按住"
    [slop, 0, false], // 正好到阈值不算挪出
    [0, slop + 1, true],
    [-40, 0, true],
  ]
  let movedOk = slop === 10
  if (!movedOk) failures.push(`client.js: LONG_PRESS_SLOP 是 ${String(slop)} (这一层判据按 10 写)`)
  for (const [dx, dy, want] of movedCases) {
    if (pressMoved(dx, dy) !== want) {
      failures.push(`pressMoved(${String(dx)},${String(dy)}) 判错了 (应为 ${String(want)})`)
      movedOk = false
    }
  }
  if (movedOk) notes.push('ok   pressMoved: 10px 以内算按住, 过了就撤')

  const clampMenuPos = new Function(`${clampSource}\nreturn clampMenuPos`)()
  const inside = clampMenuPos(100, 200, 184, 96, 1080, 2460)
  if (inside.left === 100 && inside.top === 200) {
    notes.push('ok   clampMenuPos: 放得下就落在手指那一点')
  } else {
    failures.push(`clampMenuPos 放得下时挪了位置: ${JSON.stringify(inside)}`)
  }
  const edge = clampMenuPos(1050, 2400, 184, 96, 1080, 2460)
  if (edge.left === 888 && edge.top === 2356) {
    notes.push('ok   clampMenuPos: 贴右手边 / 贴底时整块收进视口 (留 8px)')
  } else {
    failures.push(`clampMenuPos 贴边算错了: ${JSON.stringify(edge)}`)
  }
  const negative = clampMenuPos(-20, -20, 184, 96, 1080, 2460)
  if (negative.left === 8 && negative.top === 8) {
    notes.push('ok   clampMenuPos: 负坐标也回到 8px')
  } else {
    failures.push(`clampMenuPos 没有挡住负坐标: ${JSON.stringify(negative)}`)
  }

  // 菜单里那两条成不成立: 行里没留路径的那一份只写字, 不把按钮画上
  const planSource = takeFunction('fileMenuPlan')
  if (planSource === '') {
    failures.push('client.js: 抽不出 fileMenuPlan (菜单那两条的成立与否没判)')
  } else {
    const fileMenuPlan = new Function(`${planSource}\nreturn fileMenuPlan`)()
    const good = fileMenuPlan({ rel: 'assets/s/1-报表.docx', name: '报表.docx', bytes: 4096 })
    if (good.known === true && good.name === '报表.docx' && good.bytes === 4096) {
      notes.push('ok   fileMenuPlan: 有路径的那一份两条都成立')
    } else {
      failures.push(`fileMenuPlan 认错了有路径的那一份: ${JSON.stringify(good)}`)
    }
    const lost = fileMenuPlan({ name: '旧行.ppt' })
    if (lost.known === false && lost.name === '旧行.ppt' && lost.rel === '') {
      notes.push('ok   fileMenuPlan: 没留路径的那一份只写字 (不外抛, 也不假装能点)')
    } else {
      failures.push(`fileMenuPlan 对没路径的那一份判错了: ${JSON.stringify(lost)}`)
    }
    if (fileMenuPlan(null).name === '文件') notes.push('ok   fileMenuPlan: 名字缺省是「文件」')
    else failures.push('fileMenuPlan 没有名字兜底')
  }
}

// 宿主那侧: 路径只有一处拼法 + 复制走系统剪贴板
const outPaths = read('app/src/main/java/io/github/yuloong07star/luwi/tool/OutPaths.kt')
expect('OutPaths.kt', outPaths, 'const val ASSETS = "assets/"')
expect('OutPaths.kt', outPaths, 'const val INBOX = "in/"')
expect('OutPaths.kt', outPaths, 'fun lookup(rel: String): Lookup')
expect('PortalBridge.kt', portalBridge, 'fun portalAbsPath(rel: String): String')
expect('PortalBridge.kt', portalBridge, 'fun portalCopyPath(rel: String): String')
expect('PortalBridge.kt', portalBridge, 'OutPaths.lookup(rel)')
expect('PortalBridge.kt', portalBridge, 'manager.setPrimaryClip(ClipData.newPlainText(CLIP_LABEL, file.absolutePath))')
expect('PortalBridge.kt', portalBridge, 'ClipboardManager::class.java')
expect('tools/OutPathsTest.kt', read('app/src/test/java/io/github/yuloong07star/luwi/tool/OutPathsTest.kt'), 'class OutPathsTest')

// ── 十六、判断面板的叫法: 「唤醒」(2026-11-13, 主人: 敲钟改成唤醒) ──────────────
//
// 只钉门户这一侧的字面量 (设置页那几条由 `check-wording.mjs` 管): 面板上那一行读数与两颗按钮
// 是主人每次点开都要看的字, 换成别的词就当场能看出来, 所以这里按逐字断言

expect('client.js 唤醒一下', client, "'唤醒一下'")
expect('client.js 打开唤醒', client, "'打开唤醒'")
expect('client.js 关掉唤醒', client, "'关掉唤醒'")
expect('client.js 读数行 唤醒', client, "kv('唤醒',")

// 旧的叫法一处都不许留 (注释也算) —— 拼出来写, 免得这一行自己被当成命中
const retiredWord = '敲' + '钟'
if (client.includes(retiredWord)) {
  failures.push(`client.js: 还在说「${retiredWord}」, 这一版统一叫「唤醒」`)
} else {
  notes.push('ok   client.js 里没有旧的叫法')
}

// ── 十七、判断/探索面板那颗「设置」(2026-11-13, 主人: 加在打开唤醒/刷新 的右侧) ──
//
// 位置是主人点名的: 动作行最右一颗, 不是菜单里一行、也不是抽屉最底下另起一块。所以这里按
// draw 函数切片比较 `indexOf` 的先后 —— 只断言"有那颗按钮"会在有人把它挪走时照样绿

const settingsSource = takeFunction('settingsButton')
const routerDrawerSource = takeFunction('renderRouterDrawer')
const workDrawerSource = takeFunction('renderWorkDrawer')

if (settingsSource === '') failures.push('client.js: 抽不出 settingsButton')
else {
  expect('settingsButton 按钮字', settingsSource, "'设置'")
  expect('settingsButton 桥方法', settingsSource, "call('portalActivitySettings', focus)")
  expect('settingsButton 桥不在时留话', settingsSource, "showNote('这一版宿主还不支持'")
  notes.push('ok   settingsButton: 只翻一个开关, 桥不在时留一句')
}

/**
 * 切片里 a 必须出现在 b 之前, 两样都得有
 * @param label - 判据名字
 * @param source - 被查的函数源
 * @param before - 应当在前面的片段
 * @param after - 应当在后面的片段
 */
function expectOrder(label, source, before, after) {
  const at = source.indexOf(before)
  const later = source.indexOf(after)
  if (at < 0 || later < 0) {
    failures.push(`${label}: 切片里缺 ${JSON.stringify(at < 0 ? before : after)}`)
  } else if (at >= later) {
    failures.push(`${label}: ${JSON.stringify(after)} 不在 ${JSON.stringify(before)} 之后`)
  } else {
    notes.push(`ok   ${label}`)
  }
}

if (routerDrawerSource === '') failures.push('client.js: 抽不出 renderRouterDrawer')
else {
  expectOrder('判断面板: 设置 在打开/关掉唤醒 的右侧', routerDrawerSource, 'actions.appendChild(toggle)', "settingsButton('router')")
  expectOrder('判断面板: 设置 挂在动作行里', routerDrawerSource, "settingsButton('router')", 'els.drawer.appendChild(actions)')
}
if (workDrawerSource === '') failures.push('client.js: 抽不出 renderWorkDrawer')
else {
  expectOrder('探索面板: 设置 在刷新 的右侧', workDrawerSource, 'actions.appendChild(again)', "settingsButton('explore')")
  expectOrder('探索面板: 设置 挂在动作行里', workDrawerSource, "settingsButton('explore')", 'els.drawer.appendChild(actions)')
}

// 关窗之后面板得收一次最新读数 —— 弹窗是独立 Window, WebView 那一层不会自己重绘
expect('client.js onSettingsClosed', client, 'onSettingsClosed: function () { portal.refresh() }')
expect('client.js refresh 露出来', client, 'refresh: refresh')


// ── 四、撤回记录: 门户让位那一段已经整块撤掉 (2026-11-14 晚, 主人: "上面的改动复原回去") ──────────
//
// 这一段只留反向判据: 那一套 (让位 / 观察 dsh 模态窗 / 引导闸 / `guide` 那一格) 一个字节都不许再回来 ——
// 登录改由引导里的「账号」一行承担 (见第五节), dsh 自己那扇窗回到改动前的样子

const READY_CARD = 'app/src/main/java/io/github/yuloong07star/luwi/ui/ReadyCard.kt'
const readyCard = read(READY_CARD)

for (const gone of [
  'yieldToDshDialog',
  'resumeFromYield',
  'watchDshDialogs',
  'stopDshDialogs',
  'syncDshDialogs',
  'mountWhenPageClear',
  'dshDialogUp',
  "DSH_DIALOG",
  'YIELD_SETTLE_MS',
  'GUIDE_WAIT_TRIES',
  'DIALOG_WAIT_TRIES',
]) {
  if (client.includes(gone)) failures.push(`client.js 里还有 ${JSON.stringify(gone)} —— 让位那一段已经撤掉了`)
}
if (!client.includes('yieldToDshDialog') && !client.includes('mountWhenPageClear')) {
  notes.push('ok   门户让位 / 引导闸那一套已整块撤掉 (client.js 回到改动前)')
}
if (portalBridge.includes('"guide"')) failures.push('PortalBridge.kt 里还有 portalStatus 的 "guide" 那一格 (已撤回)')
else notes.push('ok   PortalBridge 不再报 guide 那一格')
if (readyCard.includes('guideOpen') || readyCard.includes('guideShown')) {
  failures.push('ReadyCard.kt 里还有 guideOpen / guideShown (已撤回)')
} else {
  notes.push('ok   ReadyCard 不再报"引导开着没有"')
}
// ── 五、账号那一行 (2026-11-14) ────────────────────────────────────────────────
//
// 主人: "直接调用 dsh 的登陆接口, 在新手引导里加入登陆帐号的引导项" —— 原生那一行借这一页当客户端,
// 三个动作 (status / login / key) 走 `__LUWI_PORTAL__.account`, 结果由 `lwAccountResult` 报回宿主

expect('宿主那条路由用的是 dsh 那个凭据 ref', hostPlugin, "const LW_ACCOUNT_KEY_REF = 'DEEPSEEK_API_KEY'")
expect('client.js 读账号状态', client, 'function accountStatus()')
expect('client.js 起登录', client, 'function accountLogin()')
expect('client.js 写 Key', client, 'function accountKey(key)')
expect('client.js 登录问宿主那条路由', client, "askHostAccount('login')")
expect('client.js 写 Key 也走那条路由', client, "askHostAccount('key', { key: value })")
expect('client.js 结果报回宿主', client, "call('lwAccountResult', JSON.stringify(payload))")
expect('client.js 露出 account 入口', client, 'account: function (action, payload)')
// **白名单那一层也要有**: `window.__LUWI_PORTAL__` 只转列出来的方法, 少了这一行原生那句会一声不响
expect('client.js 把 account 转进 __LUWI_PORTAL__', client, 'account: function (action, payload) { portal.account(action, payload) }')
// 改走宿主那条路由之后, 页面这一侧不该再声明账号的 remote 服务 (声明了也没人用; 而它调不动正是
// 2026-11-14 那次"登录 12 s 没有回音"的原因)
if (client.includes("'remote.account'")) {
  failures.push('client.js: 还在 inject 账号的 remote 服务 (现在走宿主 /lw-account 那条路由)')
} else {
  notes.push('ok   client.js 不再 inject 账号 remote (改走宿主路由)')
}
expect('client.js 那条路由的字面量', client, "fetch('/lw-account'")
expect('PortalBridge 收账号结果', portalBridge, 'fun lwAccountResult(payload: String): String')

const portalAccount = read('app/src/main/java/io/github/yuloong07star/luwi/ui/PortalAccount.kt')
expect('PortalAccount 收状态', portalAccount, 'fun adopt(payload: String)')
expect('PortalAccount 有登录', portalAccount, "kick(\"'login'\")")
expect('PortalAccount 有写 Key', portalAccount, 'fun saveKey(key: String)')
expect('PortalAccount 交授权地址', portalAccount, 'fun takeUrl(): String?')
expect('PortalAccount 只经 PortalState.run 下命令', portalAccount, 'PortalState.run')

expect('宿主那条路由由 serveLwAccount 处理', hostPlugin, 'handler: serveLwAccount(ctx),')
expect('宿主那条路由只收 POST', hostPlugin, "if (req.method !== 'POST') {")
expect('宿主那条路由只认回环', hostPlugin, 'if (!lwLoopback(req.socket?.remoteAddress) || !lwLoopback(req.socket?.localAddress)) {')
expect('宿主登录走 deepseekAccount.startSignIn', hostPlugin, 'account.startSignIn(client, origin, ')
expect('宿主写 Key 走 credentials.set', hostPlugin, 'await credentials.set(LW_ACCOUNT_KEY_REF, key)')
expect('宿主没有账号缝时说实话', hostPlugin, '这条部署没有挂 DeepSeek 账号缝, 请改用 API Key')

// 登录之后模型那一笔 (2026-11-15 主人: "理论上登陆完应该可以使用 account 的模型, 不需要输入 api")
//
// 上游那件事挂在 **client** 的账号状态流里 (`ui-settings-account` → `initializeDefaultModel`), 整条流被
// `remoteAccess.whenAccess('account/watch')` 包着, 第三方门户拿不到那条授权 —— 于是宿主侧补同一份语义
expect('登录之后宿主自己把默认模型收到账号那条路', hostPlugin, 'async function lwAccountAdoptModel(ctx)')
expect('收尾取的是账号模型目录', hostPlugin, 'const catalog = await controller.modelCatalog()')
expect('账号 route 的名字写对', hostPlugin, "const provider = 'deepseek-account'")
expect('默认模型写回走 saveSelection', hostPlugin, 'await defaults.saveSelection(target)')
expect('活着的会话改走 selectModel', hostPlugin, 'await controller.selectModel({ sessionId, provider, model })')
expect('只切钉在 Key 那条 route 上的会话', hostPlugin, "const LW_ACCOUNT_STALE_ROUTE = 'deepseek-official'")
expect('有 Key 就保留原默认 (与上游同判据)', hostPlugin, 'if (!keyConfigured && typeof defaults?.saveSelection === \'function\')')
expect('视频模式不抢模型', hostPlugin, 'if (activeMode() === MODE_VIDEO) return lwAccountAdoptState.last')
expect('收尾每 60 s 只算一次', hostPlugin, 'const LW_ACCOUNT_ADOPT_MS = 60 * 1000')
expect('收尾有结论落盘', hostPlugin, "const LW_ACCOUNT_MODEL_FILE = 'account-model.json'")
expect('收尾是原子写', hostPlugin, 'await rename(temporary, path)')
expect('打开账号窗那一次顺手收尾', hostPlugin, 'const adopted = await lwAccountAdoptModel(ctx).catch(() => null)')
expect('status 报模型可用', hostPlugin, 'modelsReady: model !== null, model }')
expect('每轮 turn/start 兜一次', hostPlugin, 'void lwAccountAdoptModel(ctx).catch(() => {})')
expect('起来也收一次', hostPlugin, 'void lwAccountAdoptModel(ctx).catch((error) => {')
expect('卡片收模型名', portalAccount, 'var model by mutableStateOf("")')
expect('模型名从 status 的 model 里取', portalAccount, 'body.optJSONObject("model")?.optString("label")')

// ── 读数 ──────────────────────────────────────────────────────────────────────

for (const note of notes) console.log(note)
if (failures.length > 0) {
  console.error('')
  for (const failure of failures) console.error(`FAIL ${failure}`)
  console.error(`\ncheck-luwi-portal: ${String(failures.length)} 条不成立`)
  process.exit(1)
}
console.log(`\ncheck-luwi-portal: 全部通过 (${String(notes.length)} 条)`)


