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
if (client.includes('return orderTimeline(users, rows, extras)') && !client.includes('sortAt')
  && !client.includes('sortFloor')) {
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

// ── 十三、首启没有工作区时首页给「选工作区」(2026-11-12 #37) ────────────────────
//
// `pm clear` 之后 dsh 那一边可能一个工作区都没有, 而门户把它整个界面盖住了: 没有入口就一句
// 话都发不出去。空态那颗「选工作区」后面只两条路 —— 一条是这一窗的行怎么画 (工作区表 ->
// 名字 / 路径 / 当前那一条), 一条是选中之后落进那个工作区。第一条是纯函数, 抽出来真跑

const pickRowsSource = takeFunction('pickRows')
const workspaceTitleSource = takeFunction('workspaceTitle')
if (pickRowsSource === '' || workspaceTitleSource === '') {
  failures.push('client.js: 抽不出 pickRows / workspaceTitle (选工作区那一窗的行画不出来)')
} else {
  const pickRows = new Function(`${workspaceTitleSource}\n${pickRowsSource}\nreturn pickRows`)()
  const rows = pickRows([
    { workspaceId: 'w1', title: '球', path: '/sdcard/DSH/dsh-ball', sessionIds: [] },
    // 没起过名: 用路径最后一节当名字, 不能是一行空白
    { workspaceId: 'w2', title: '  ', path: '/sdcard/DSH/work/', sessionIds: [] },
    // 没有 id 的那一条不是工作区: 画出来也点不动
    { title: '空壳', path: '/sdcard/DSH/ghost', sessionIds: [] },
  ], 'w2')
  const shape = rows.map(row => `${row.id}|${row.title}|${row.current ? 'on' : 'off'}`).join(',')
  if (shape === 'w1|球|off,w2|work|on') {
    notes.push('ok   选工作区: 名字缺省取路径末节, 当前那一条标出来 (没 id 的行不画)')
  } else {
    failures.push(`pickRows 画错了: ${shape}`)
  }
}

// ── 读数 ──────────────────────────────────────────────────────────────────────

for (const note of notes) console.log(note)
if (failures.length > 0) {
  console.error('')
  for (const failure of failures) console.error(`FAIL ${failure}`)
  console.error(`\ncheck-luwi-portal: ${String(failures.length)} 条不成立`)
  process.exit(1)
}
console.log(`\ncheck-luwi-portal: 全部通过 (${String(notes.length)} 条)`)
