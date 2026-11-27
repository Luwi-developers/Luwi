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
// 2026-11-14: 排好的那一串**不再** `appendRecord` 盲接在记录前面 —— 与门户记录按时间合并
// (`mergeTimeline`)。盲拼接会把"冷启 / 换场那一拍只有她的行"那半截线冻进记录里, 之后她的行整组压在
// 自己的消息上面 (主人 2026-11-14 截图)
if (client.includes('return mergeTimeline(carried, orderTimeline(users, rows, extras))')
  && !client.includes('sortAt') && !client.includes('sortFloor')) {
  notes.push('ok   排序走 orderTimeline 按轮排, 再与门户记录按时间合并 (旧的 sortAt / running max 已拆)')
} else {
  failures.push('client.js: 排序还没改成按轮排 / 记录那一段还是盲接 —— 她的行会整组压在自己的消息上面')
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
// **每发一句都要续一次账本** (2026-11-20 主人: "每一次门户发送都 portalBind 续一次"): 只在第一句写的
// 话, 门户里聊久了回浮标就换场了。判据钉两件 —— send 里那次 portalBind 还在, 而且不再有 `bound` 那道闸
if (client.includes("call('portalBind', sessionId)")
  && !client.includes('bound !== sessionId') && !client.includes('var bound')) {
  notes.push('ok   门户每发一句都 portalBind 续账本 (没有 bound 那道闸)')
} else {
  failures.push('client.js: send() 里缺 portalBind, 或者还被 `bound !== sessionId` 挡着 —— 门户聊久了回浮标会换场')
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
const windowTriple = /const VOICE_SESSION_MS = (\d+) \* (\d+) \* (\d+)/.exec(hostPlugin)
const windowMinutes = windowTriple === null
  ? null
  : (Number(windowTriple[1]) * Number(windowTriple[2]) * Number(windowTriple[3])) / 60000
if (hostWindow !== null && hostWindow === kotlinWindow) {
  notes.push(`ok   账本窗口 ${windowMinutes} 分钟 (两边逐字相同)`)
} else {
  failures.push(`账本窗口对不上: host-plugin ${String(hostWindow)} / PortalBridge ${String(kotlinWindow)}`)
}

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

// ── 六、键盘那一格 (2026-11-09 门户 / 2026-11-22 dsh 后台) ────────────────────
//
// 主人: "呼出键盘时不应整个界面上移, 只要输入框和聊天记录向上移" —— 所以两层 WebView 的尺寸
// **一点都不动**, 高度只推给页面: 门户写 `--lwp-ime`, dsh 后台写 `--lw-dsh-ime` (ui-fix 第三节)。
// 以前门户收起时是宿主自己逐帧缩 WebView (一次呼键盘二十来次 resize), 2026-11-22 起那条作废:
// 只有页面明说接不了 (`__LUWI_IME__` 不在) 才退回缩边, 而且只用"停稳"的终值。

expect('HostScreen.kt', screen, 'val portalOpen = PortalState.open')
expect('HostScreen.kt', screen, 'var pageTakesIme by remember { mutableStateOf<Boolean?>(null) }')
expect('HostScreen.kt', screen, 'if (!portalOpen && pageTakesIme != true) modifier.padding(bottom = fallbackLift) else modifier')
expect('HostScreen.kt', screen, 'setOnApplyWindowInsetsListener')
expect('HostScreen.kt', screen, 'setInsets(WindowInsets.Type.ime(), Insets.NONE)')
expect('HostScreen.kt', screen, 'PortalState.imePx =')
// 推给页面的数必须是 dp (WebView 里 1 CSS px = 1 dp): 拿 roundToPx() 的 922 当 CSS px 写下去,
// 输入卡会被顶到顶栏下面 (2026-11-09 真机踩到)
expect('HostScreen.kt', screen, 'val imeLiftDp = imeLift.value.roundToInt()')
expect('HostScreen.kt', screen, '__LUWI_PORTAL__.setKeyboard($imeLiftDp)')
// dsh 后台那一路: 同一句话推给页面自己的入口 (ui-fix), 安全网那条只收停稳的终值
expect('HostScreen.kt', screen, 'window.__LUWI_IME__ && window.__LUWI_IME__($imeLiftDp)')
expect('HostScreen.kt', screen, 'suspend fun imeTakesLift(')
expect('HostScreen.kt', screen, "typeof window.__LUWI_IME__ === 'function'")
expect('HostScreen.kt', screen, 'if (settle[1] >= IME_SETTLE_FRAMES) onFallback(imeLift)')
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
expect('client.js', client, "drawerRow('判断', '她什么时候开口那一套读数'")
expect('client.js', client, "drawerRow('探索', '她挑时机开的那一场与最近一份摘要'")
expect('client.js', client, "h('h3', null, '判断')")
expect('client.js', client, "h('h3', null, '探索')")
expect('client.js', client, 'id = \'lwp-more-btn\'')
// 头栏那颗「历史」胶囊 2026-11-19 撤了: 入口并进左边那颗头像 (见 §二十三)
if (!client.includes('lwp-history-btn') && !client.includes("'lwp-tab', '历史'")) {
  notes.push('ok   头栏的历史胶囊已撤 (入口并进头像)')
} else {
  failures.push('client.js: 头栏还挂着「历史」那颗胶囊 —— 2026-11-19 起它的入口是头像')
}
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
// 空态那张脸: 2026-11-10 要"与头栏同一个形状"(圆裁), 2026-11-22 主人又补一条 —— 图标套那张
// **不许被 96x96 的 cover 裁掉呆毛**, 于是圆裁只留给自选头像, 默认那张按高度定尺寸、宽度跟比例
if (client.includes('#lwp-hero .lwp-hero-mark[data-photo="on"] img{width:96px;height:96px;border-radius:999px;object-fit:cover}')) {
  notes.push('ok   自选头像在空态仍是圆裁 + 铺满 (与头栏同一个形状)')
} else {
  failures.push('client.js: 自选头像在空态不是圆形 (缺 border-radius:999px / object-fit:cover)')
}
if (client.includes('#lwp-hero .lwp-hero-mark img{display:block;height:96px;width:auto;max-width:140px;object-fit:contain}')) {
  notes.push('ok   图标套那张在空态不裁 (按高度定尺寸, 宽度跟图形比例)')
} else {
  failures.push('client.js: 图标套那张还被 96x96 的 cover 框着 —— 女仆头顶那根呆毛会被裁掉')
}
if (!client.includes('#lwp-hero .lwp-hero-mark{position:relative;width:96px;height:96px;')) {
  notes.push('ok   中心图标那格不再写死 96x96')
} else {
  failures.push('client.js: 中心图标那格仍写死 96x96 (尺寸限制没去掉)')
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
  if (onFilesSource.includes('imageFail(IMAGE_FAIL.tooBig, sizeText(')
    && onFilesSource.indexOf('imageFail(IMAGE_FAIL.tooBig, sizeText(') < onFilesSource.indexOf('readImage(file)')) {
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
  expect('client.js', client, "call('portalImageFail', JSON.stringify({ reason: text, image: size }))")
  expect('client.js', client, 'id: imageFails[f].id')
  expect('HostScreen.kt', screen, "pickState('$state')")
  expect('HostScreen.kt', screen, 'private const val PICK_SHOWN = "shown"')
  expect('HostScreen.kt', screen, 'private const val PICK_PICKED = "picked"')
  expect('HostScreen.kt', screen, 'private const val PICK_EMPTY = "empty"')
  expect('HostScreen.kt', screen, 'private const val PICK_NONE = "none"')
  expect('HostScreen.kt', screen, 'view.pickState(PICK_SHOWN)')
  expect('HostScreen.kt', screen, 'view.pickState(PICK_NONE)')
  // 选择器的回调那一支里 `page` 可能已经不在了 (renderer 换过一块), 所以是安全调用
  expect('HostScreen.kt', screen, 'view?.pickState(PICK_EMPTY)')
  expect('HostScreen.kt', screen, 'view?.pickState(PICK_PICKED)')
  expect('PortalBridge.kt', portalBridge, 'fun portalImageFail(payload: String): String')
  expect('PortalBridge.kt', portalBridge, 'Log.w(LOOK_TAG, "image send failed: $text")')
  expect('PortalBridge.kt', portalBridge, '"机型: ${Build.MANUFACTURER} ${Build.MODEL}"')
  expect('PortalBridge.kt', portalBridge, '"WebView: $label (major ${info?.major ?: 0})"')

  // 宿主回话那一支: `shown` 只把计时器停住 (还欠文件), `picked` / `empty` 结清且不报, 只有 `none` 要报 ——
  // 2026-11-15 主人: "点击附件进入选择界面时没有选择直接退出会出现图片发送失败: webview 未回调,
  // 要求这种情况下不要显示这个报错" (取消是主人自己的动作, 不是一次失败)
  if (pickStateSource === '') {
    failures.push('client.js: 抽不出 pickState (宿主那句回话没人接)')
  } else {
    const reasons = []
    let settled = 0
    let owed = 0
    const pickState = new Function('disarmPickWatch', 'pickOwed', 'pickSettled', 'imageFail', 'IMAGE_FAIL',
      `${pickStateSource}\nreturn pickState`)(
      () => {},
      () => { owed += 1 },
      () => { settled += 1 },
      (reason) => reasons.push(reason),
      table,
    )
    pickState('shown')
    if (reasons.length === 0 && owed === 1 && settled === 0) {
      notes.push('ok   pickState: shown 只是"还欠着文件", 不报失败 (选择器刚起来)')
    } else {
      failures.push(`client.js: pickState 对 shown 的处置不对 (报 ${reasons.length} 次, 欠 ${String(owed)}, 清 ${String(settled)})`)
    }
    pickState('picked')
    if (reasons.length === 0) notes.push('ok   pickState: picked 结清, 不报失败')
    else failures.push(`client.js: pickState 对 picked 也报了失败 (${reasons.join(',')})`)
    // `empty` = 人选了又退出来: 屏上不该留一句失败
    pickState('empty')
    if (reasons.length === 0) notes.push('ok   pickState: empty (人自己取消) 静默, 不报失败')
    else failures.push(`client.js: pickState 对 empty 也报了失败 (${reasons.join(',')})`)
    pickState('none')
    if (reasons.length === 1 && reasons[0] === table.noCallback) {
      notes.push('ok   pickState: none (选择器起不来) 报「webview 未回调」')
    } else {
      failures.push(`client.js: pickState 对 none 没报「webview 未回调」(实际 ${reasons.join(',')})`)
    }
    if (settled === 3) notes.push('ok   pickState: 三个终态 (picked / empty / none) 都结清, 只有 shown 留债')
    else failures.push(`client.js: pickState 结清回话的次数不是 3 (实际 ${String(settled)})`)
  }
}

// ── 十二·二、失败气泡右侧那颗「复制诊断」: 四行照抄 logcat (2.8.1 #1) ─────────────
//
// 主人报图片发不出去时, 群里对不上的就是"哪台机 / 哪个 WebView / 那条图多大" —— 失败气泡右侧加一颗
// 「复制诊断」, 一点就把四行放进剪贴板 (机型 / Android / WebView / 图片). 四行**只在宿主那一处拼**
// (`PortalBridge.diagLines`), 同一份既进 logcat 又原样回存到那条气泡上, 所以粘贴与 logcat 逐字一致;
// 没选图 (人把选择器退出来了) 时第四行写「图片: 未选择」. 这一条钉三件:
// ① 按钮与复制那条路真的接上 (源码) ② imageFail 把宿主回的四行原样存下 ③ copyImageDiag 原样交回去

const copyDiagSource = takeFunction('copyImageDiag')
const diagFailSource = takeFunction('imageFail')
if (copyDiagSource === '' || diagFailSource === '') {
  failures.push('client.js: 抽不出 imageFail / copyImageDiag —— 气泡上没有「复制诊断」')
} else {
  // ① 源码: 按钮画在气泡那一行的右侧, 复制走宿主剪贴板, 四行只在宿主那一处拼
  expect('client.js: 复制诊断那颗按钮', client, "h('button', 'lwp-diag', '复制诊断')")
  const diagRowAt = client.indexOf("h('div', 'lwp-fail')")
  const diagButtonAt = client.indexOf("h('button', 'lwp-diag', '复制诊断')")
  if (diagRowAt > 0 && diagButtonAt > diagRowAt) {
    notes.push('ok   复制诊断那颗按钮挂在气泡右侧 (lwp-fail 那一行: 先气泡, 后按钮)')
  } else {
    failures.push('client.js: 「复制诊断」没有挂在气泡右侧 (lwp-fail 那一行)')
  }
  expect('client.js: 按钮点的是哪一条诊断', client, 'copyImageDiag(item.id)')
  expect('client.js: 复制走宿主剪贴板', client, "call('portalCopyDiag', one.diag)")
  expect('client.js: 那一行的样式', client, '.lwp-fail .lwp-diag{')
  expect('PortalBridge.kt: 四行只拼一处', portalBridge, 'private fun diagLines(picture: String): List<String>')
  expect('PortalBridge.kt: Android 那一行', portalBridge, '"Android: ${Build.VERSION.RELEASE} (sdk ${Build.VERSION.SDK_INT})"')
  expect('PortalBridge.kt: 图片那一行', portalBridge, '"图片: $size"')
  expect('PortalBridge.kt: 没选图那四个字', portalBridge, 'const val UNKNOWN_PICTURE = "未选择"')
  expect('PortalBridge.kt: 复制诊断那座桥', portalBridge, 'fun portalCopyDiag(diag: String): String')
  expect('PortalBridge.kt: 不是四行不许进剪贴板', portalBridge, 'if (lines.size != DIAG_LINES) return refused(')
  expect('PortalBridge.kt: 剪贴板写的是那四行', portalBridge, 'manager.setPrimaryClip(ClipData.newPlainText(CLIP_DIAG_LABEL, diag))')

  // ② 真跑: 宿主回一份四行 -> 气泡上存的就是那一份 (原样, 不重拼)
  const hostDiag = [
    '机型: Xiaomi 22041216C',
    'Android: 15 (sdk 35)',
    'WebView: 132.0.0.0 (major 132)',
    '图片: 2.4 MB',
  ].join('\n')
  const diagStored = []
  const diagCalls = []
  const diagImageFail = new Function('IMAGE_FAIL', 'imageFails', 'call', 'renderFlow',
    `${diagFailSource}\nreturn imageFail`)(
    { noCallback: 'webview 未回调', tooBig: '文件过大', timeout: '上传超时' },
    diagStored,
    (method, arg) => {
      diagCalls.push({ method, arg })
      return { ok: true, diag: hostDiag }
    },
    () => {},
  )
  diagImageFail('文件过大', '2.4 MB')
  if (diagCalls.length === 1 && diagCalls[0].method === 'portalImageFail') {
    notes.push('ok   失败那一下走宿主汇总 (portalImageFail)')
  } else {
    failures.push(`client.js: imageFail 没有走宿主 (调了 ${JSON.stringify(diagCalls.map((one) => one.method))})`)
  }
  let diagPayload = {}
  try {
    diagPayload = JSON.parse(String(diagCalls[0] && diagCalls[0].arg))
  } catch (_badDiagPayload) {
    failures.push('client.js: imageFail 交给宿主的不是 JSON (宿主读不到 reason / image)')
  }
  if (diagPayload.reason === '文件过大' && diagPayload.image === '2.4 MB') {
    notes.push('ok   交给宿主的 payload 带原因与图片大小')
  } else {
    failures.push(`client.js: payload 不对 (${JSON.stringify(diagPayload)})`)
  }
  if (diagStored.length === 1 && diagStored[0].diag === hostDiag) {
    notes.push('ok   气泡上存的就是宿主那四行 (原样, 不重拼一次)')
  } else {
    failures.push('client.js: 气泡没有原样存下宿主那四行')
  }
  const diagLines = String(diagStored[0] && diagStored[0].diag).split('\n')
  if (diagLines.length === 4) notes.push('ok   诊断恰好四行 (机型 / Android / WebView / 图片)')
  else failures.push(`client.js: 诊断行数不是 4 (${JSON.stringify(diagStored[0] && diagStored[0].diag)})`)

  // 没选图那一档 (人把选择器退出来了): 第四行必须是「图片: 未选择」
  diagCalls.length = 0
  diagImageFail('webview 未回调')
  let cancelPayload = {}
  try {
    cancelPayload = JSON.parse(String(diagCalls[0] && diagCalls[0].arg))
  } catch (_badCancelPayload) {
    failures.push('client.js: 没选图那一档交给宿主的不是 JSON')
  }
  if (cancelPayload.image === '未选择') {
    notes.push('ok   没选图那一档交上去的是「未选择」(第四行 = 图片: 未选择)')
  } else {
    failures.push(`client.js: 没选图时 image 传的是 ${JSON.stringify(cancelPayload.image)}, 应为「未选择」`)
  }

  // ③ 复制那一下: 把存下的那一份原样交给宿主, 成功了留一句回执
  const copyCalls = []
  const copyNotes = []
  const diagCopy = new Function('imageFails', 'call', 'showNote',
    `${copyDiagSource}\nreturn copyImageDiag`)(diagStored, (method, arg) => {
    copyCalls.push({ method, arg })
    return { ok: true, lines: 4 }
  }, (text) => { copyNotes.push(text) })
  diagCopy(diagStored[0].id)
  if (copyCalls.length === 1 && copyCalls[0].method === 'portalCopyDiag' && copyCalls[0].arg === hostDiag) {
    notes.push('ok   复制那一下原样交回那四行 (与 logcat 同一份)')
  } else {
    failures.push('client.js: copyImageDiag 没有把存下的四行原样交给 portalCopyDiag')
  }
  if (copyNotes.length === 1 && copyNotes[0] === '已复制诊断 4 行') {
    notes.push('ok   复制成功留一句回执 (已复制诊断 4 行)')
  } else {
    failures.push(`client.js: 复制成功没有回执 (${JSON.stringify(copyNotes)})`)
  }
}

// ── 十二·三、选好的那几份由宿主读、宿主落, 页面只管画 (2.8.1 #13) ──────────────
//
// 根因两半:
// ① 页面把"选择器起来没有 / 选中的是什么"押在渲染器上, 而选择器盖着时渲染器整个停着 —— 那个 2.5 s
//    看门狗被盖住时跑不动, 回到页面第一瞬间先跑, 宿主那两句回话还排在它后面, 于是每次选图都多一条
//    假的「webview 未回调」(2026-11-12 真机 logcat: `file chooser` 之后 5.2 s 冒出来, 而人当场就选了)
// ② 字节靠 WebView 自己读 `content://` 再 base64 过桥, 相册那种 Uri 在渲染器里有的机器上读出来是空的
//    (`FileReader` 的 onerror / 空 buffer) —— 页面上就"点了确定什么都没有" (issue #53)
//
// 改法: 宿主读 + `LwIn.put` 落盘 + 把成品交回页面 (`stashPicked` -> `picked`); 看门狗只在页面看得见的
// 时候挂, 回到页面先给一段宽限 (`pickWatchVisibility` / `PICK_GRACE_MS`). 这一节钉两条用例:
// ① 选好交回页面: 一份 3 MB JPEG 交回来 -> 待发栏恰好一行 ready, 缩略图走 `/lw-out/in/`, 一条失败都没有
// ② 回调为空但不误报: 空手而归 / 选择器盖着 / 宽限到点前宿主回话, 屏上一条失败都不许有

const pickedSource = takeFunction('picked')
const pickTable = failTableSource === '' ? {} : new Function(`${failTableSource}\nreturn IMAGE_FAIL`)()
const watchSources = {
  disarm: takeFunction('disarmPickWatch'),
  armVisible: takeFunction('armPickWatchWhileVisible'),
  due: takeFunction('pickWatchDue'),
  visibility: takeFunction('pickWatchVisibility'),
  arm: takeFunction('armPickWatch'),
  owed: takeFunction('pickOwed'),
  settled: takeFunction('pickSettled'),
}
const attachSrcSource = takeFunction('attachSrc')

if (pickedSource === ''
  || pickTable.noCallback === undefined
  || Object.keys(watchSources).some((key) => watchSources[key] === '')) {
  failures.push('client.js: 抽不出 picked / 选图看门狗那几个函数 —— 2.8.1 #13 那条路不在')
} else {
  // 源码: 字节只在宿主那一处读、那一处落, 页面不再自己存一遍 (同一次发送只落 1 个文件靠它)
  expect('PortalBridge.kt: 宿主读选择器的结果', portalBridge, 'fun stashPicked(uris: List<Uri>): String')
  expect('PortalBridge.kt: 用 contentResolver 自己读', portalBridge, 'context.contentResolver.openInputStream(uri)?.use { it.readBytes() }')
  expect('PortalBridge.kt: 落盘仍走 LwIn', portalBridge, 'val result = LwIn.put(root, name, bytes)')
  expect('PortalBridge.kt: 名字没有扩展名时按 MIME 补', portalBridge, 'MimeTypeMap.getSingleton().getExtensionFromMimeType(mime)')
  expect('HostScreen.kt: 选择器回来先让宿主落盘', screen, 'portal.stashPicked(picked.toList())')
  expect('HostScreen.kt: 落好的那几份交回页面', screen, 'view?.pickedFiles(landed ?: nothingLanded(picked.size))')
  expect('HostScreen.kt: 交回页面那句 JS', screen, "window.__LUWI_PORTAL__.picked(")
  expect('HostScreen.kt: 答给 WebView 的是"没选" (页面不再读一遍)', screen, 'answer.onReceiveValue(null)')
  expect('HostScreen.kt: 读 + 落盘下 IO 那一趟', screen, 'withContext(Dispatchers.IO)')
  expect('HostScreen.kt: 一份没落成也要说一句', screen, 'private fun nothingLanded(count: Int): JSONObject')
  expect('client.js: 页面那侧接住', client, 'picked: function (payload) { portal.picked(payload) }')
  expect('client.js: 门户对象上也有一份', client, 'picked: picked,')
  // 两处 `<input type=file>` 各报一次: `+` 那条由宿主读, 表情包那格仍走页面 (老路不动)
  expect('client.js: 普通附件点之前先报 file', client, "call('portalPickMode', 'file')")
  expect('client.js: 表情那格点之前先报 sticker', client, "call('portalPickMode', 'sticker')")
  expect('PortalBridge.kt: 这一次是给谁挑的', portalBridge, 'fun portalPickMode(mode: String): String')
  expect('PortalBridge.kt: 只认一次, 取走就复位', portalBridge, 'fun takePickMode(): String')
  expect('HostScreen.kt: 选择器起来那一刻取走', screen, 'pendingSticker = portal.takePickMode() == PICK_MODE_STICKER')
  expect('HostScreen.kt: 表情那格把 Uri 交回页面 (老路)', screen, 'answer.onReceiveValue(picked)')
  expect('client.js: 看门狗按可见性停/续', client, "document.addEventListener('visibilitychange', function () { pickWatchVisibility() })")
  expect('client.js: 宽限那个数', client, 'var PICK_GRACE_MS = 1500')
  const landings = portalBridge.split('LwIn.put(').length - 1
  if (landings === 2) {
    notes.push('ok   落盘只有两处 (门户那段 base64 + 选择器那条), 都在 LwIn.put 这一处')
  } else {
    failures.push(`PortalBridge.kt: LwIn.put 被调了 ${String(landings)} 处 (应 2 处: base64 那条与选择器那条)`)
  }
  const pushes = pickedSource.split('attach.push(').length - 1
  if (pushes === 1) notes.push('ok   picked 只在一处 push (一份交回来 = 待发栏一行, 不重复)')
  else failures.push(`client.js: picked 里 attach.push 有 ${String(pushes)} 处 (应 1 处)`)
  if (/portalStash|readImage|stashOne|FileReader/.test(pickedSource)) {
    failures.push('client.js: picked 里还在自己读字节 / 自己存 —— 那就是第二份 (同一次发送只许落 1 个)')
  } else {
    notes.push('ok   picked 不再自己读字节、不再自己存 (字节已经在盘上了)')
  }

  /**
   * 按 client.js 那几段原文拼一个能真跑的"选图"小模块
   *
   * 计时器换成手摇的 (`fire()`), 页面可见性换成假的 (`hidden(true/false)`), 其余全是原文 —— 于是
   * "盖着的时候不许挂着 / 回来先给宽限 / 宿主的回话先到就不许再报"这几条真值都能断言
   * @param options - `{attach, onFail, onNote, sessionId, hidden}`
   */
  function pickModule(options) {
    const timers = new Map()
    let next = 1
    const doc = { hidden: options.hidden === true }
    const module = new Function(
      'setTimeout', 'clearTimeout', 'document', 'imageFail', 'IMAGE_FAIL',
      'attach', 'MAX_ATTACH', 'sessionId', 'renderAttach', 'showNote', 'baseNameOf', 'mimeOfName',
      'PICK_WAIT_MS', 'PICK_GRACE_MS',
      [
        'var pickWatch = null',
        'var pickPending = false',
        'var pickHeld = false',
        watchSources.disarm,
        watchSources.armVisible,
        watchSources.due,
        watchSources.visibility,
        watchSources.arm,
        watchSources.owed,
        watchSources.settled,
        pickStateSource,
        pickedSource,
        'return {',
        '  armPickWatch: armPickWatch,',
        '  pickWatchVisibility: pickWatchVisibility,',
        '  pickState: pickState,',
        '  picked: picked,',
        '  watch: function () { return pickWatch },',
        '  pending: function () { return pickPending },',
        '  held: function () { return pickHeld },',
        '}',
      ].join('\n'),
    )(
      (fn, delay) => {
        const id = next
        next += 1
        timers.set(id, { fn, delay })
        return id
      },
      (id) => { timers.delete(id) },
      doc,
      options.onFail,
      pickTable,
      options.attach,
      6,
      options.sessionId === undefined ? 'session-1' : options.sessionId,
      () => {},
      options.onNote,
      () => { throw new Error('picked 不该自己去认 basename (名字是宿主给的)') },
      () => 'image/png',
      2500,
      1500,
    )
    return {
      module,
      /** 页面看得见 / 看不见 (选择器盖着) */
      hidden: (value) => { doc.hidden = value === true },
      /** 还挂着几个计时器 */
      armed: () => timers.size,
      /** 把挂着的计时器全摇一遍 (到点就跑, 跑过的先摘掉) */
      fire: () => {
        const due = [...timers.values()]
        timers.clear()
        for (const one of due) one.fn()
      },
    }
  }

  // ① 选好交回页面: 宿主落好一份 3 MB JPEG, 交回来的就是这一段
  const pickedAttach = []
  const pickedFails = []
  const pickedNotes = []
  const pickOne = pickModule({ attach: pickedAttach, onFail: (reason) => pickedFails.push(reason), onNote: (text) => pickedNotes.push(text) })
  pickOne.module.armPickWatch()
  pickOne.module.pickState('shown')
  pickOne.hidden(true) // 人进了相册
  pickOne.module.pickWatchVisibility()
  if (pickOne.armed() === 0) notes.push('ok   选择器盖着时看门狗停着 (不会在回来那一瞬间误报)')
  else failures.push('client.js: 选择器盖着时计时器还挂着 —— 回来第一瞬间就会误报「webview 未回调」')
  const jpeg = {
    name: 'IMG_20261116_201903.jpg',
    path: '/storage/emulated/0/DSH/Luwi/lw-in/IMG_20261116_201903.jpg',
    bytes: 3 * 1024 * 1024,
    image: true,
    mediaType: 'image/jpeg',
  }
  const added = (() => {
    pickOne.hidden(false) // 回到页面
    pickOne.module.pickWatchVisibility()
    pickOne.module.pickState('picked') // 宿主那一句先到 (选择器回来了, 选到了东西)
    const one = pickOne.module.picked({ files: [jpeg], rejected: [] })
    pickOne.fire()
    return one
  })()
  if (added === 1 && pickedAttach.length === 1) {
    notes.push('ok   picked: 一份交回来 = 待发栏一行 (不多一行)')
  } else {
    failures.push(`client.js: picked 加进来的行数不对 (返回 ${String(added)}, 实际 ${String(pickedAttach.length)} 行)`)
  }
  const row = pickedAttach[0] || {}
  if (row.status === 'ready' && row.kind === 'image' && row.path === jpeg.path && row.name === jpeg.name
    && row.bytes === jpeg.bytes && row.mediaType === 'image/jpeg') {
    notes.push('ok   picked: 那一行是 ready 的图 (名字 / 路径 / 字节数 / MIME 都是宿主给的那份)')
  } else {
    failures.push(`client.js: picked 记下的那一行不对 (${JSON.stringify(row)})`)
  }
  if (pickedFails.length === 0 && pickedNotes.length === 0) {
    notes.push('ok   选好交回页面: 一条失败都不报 (也没多一句提示)')
  } else {
    failures.push(`client.js: 选好交回页面时还报了东西 (失败 ${JSON.stringify(pickedFails)}, 提示 ${JSON.stringify(pickedNotes)})`)
  }
  if (pickOne.module.pending() === false && pickOne.module.held() === false && pickOne.armed() === 0) {
    notes.push('ok   picked 结清这一趟 (不欠回话, 计时器也不留)')
  } else {
    failures.push('client.js: picked 之后还欠着回话 / 还挂着计时器')
  }
  if (attachSrcSource !== '') {
    const thumb = new Function('baseNameOf', `${attachSrcSource}\nreturn attachSrc`)((name) => String(name || '').split('/').pop())(
      pickedAttach[0],
    )
    if (thumb === '/lw-out/in/' + encodeURIComponent(jpeg.name)) {
      notes.push('ok   那一行的缩略图走 /lw-out/in/ (宿主刚落好的那一份)')
    } else {
      failures.push(`client.js: 交回来那一行的缩略图 src 是 ${JSON.stringify(thumb)}, 应为 /lw-out/in/<名字>`)
    }
  }

  // ② 回调为空但不误报: 空手而归 / 盖着 / 宽限到点前宿主回话, 屏上都不许有一条失败
  const quietAttach = []
  const quietFails = []
  const quietNotes = []
  const pickQuiet = pickModule({ attach: quietAttach, onFail: (reason) => quietFails.push(reason), onNote: (text) => quietNotes.push(text) })
  // 空手而归: 起来 -> 空 -> 回页面
  pickQuiet.module.armPickWatch()
  pickQuiet.module.pickState('shown')
  pickQuiet.hidden(true)
  pickQuiet.module.pickWatchVisibility()
  pickQuiet.module.pickState('empty')
  pickQuiet.hidden(false)
  pickQuiet.module.pickWatchVisibility()
  pickQuiet.fire()
  if (quietFails.length === 0 && quietNotes.length === 0 && quietAttach.length === 0) {
    notes.push('ok   回调为空 (人自己退出): 不误报, 待发栏也不多一行')
  } else {
    failures.push(`client.js: 回调为空时还报了东西 (失败 ${JSON.stringify(quietFails)}, 提示 ${JSON.stringify(quietNotes)}, 行 ${String(quietAttach.length)})`)
  }
  // 回来之后宿主那一句先到: 宽限到点也不许报
  pickQuiet.module.armPickWatch()
  pickQuiet.hidden(true)
  pickQuiet.module.pickWatchVisibility()
  pickQuiet.hidden(false)
  pickQuiet.module.pickWatchVisibility()
  if (pickQuiet.armed() === 1) {
    notes.push('ok   回到页面先挂一段宽限 (宿主那两句还有机会落地)')
  } else {
    failures.push('client.js: 回到页面之后没有重新挂宽限计时器 (那句 picked 就永远等不到了)')
  }
  pickQuiet.module.picked({ files: [], rejected: [] })
  pickQuiet.fire()
  if (quietFails.length === 0) notes.push('ok   宽限期间宿主回话 -> 到点也不报 (空的 picked 同样结清)')
  else failures.push(`client.js: 宽限期间已经回话了还是报了失败 (${quietFails.join(',')})`)
  // 真的一个字都没回来: 宽限到点报一次, 再摇不报第二次
  pickQuiet.module.armPickWatch()
  pickQuiet.hidden(true)
  pickQuiet.module.pickWatchVisibility()
  pickQuiet.hidden(false)
  pickQuiet.module.pickWatchVisibility()
  pickQuiet.fire()
  pickQuiet.fire()
  if (quietFails.length === 1 && quietFails[0] === pickTable.noCallback) {
    notes.push('ok   真的没回话才报一次「webview 未回调」(摇两遍也只有一条)')
  } else {
    failures.push(`client.js: 没回话那一档的报法不对 (${JSON.stringify(quietFails)})`)
  }
  // 被拒的那几份要有一句人话 (读不动 / 太大 / 不收这种文件)
  const rejectNotes = []
  const pickReject = pickModule({ attach: [], onFail: () => {}, onNote: (text) => rejectNotes.push(text) })
  pickReject.module.picked({ files: [], rejected: [{ name: 'HEIC_0001.heic', reason: '不收这种文件: HEIC_0001.heic' }] })
  if (rejectNotes.length === 1 && rejectNotes[0].indexOf('不收这种文件') > 0) {
    notes.push('ok   被拒的那几份有一句人话 (不静默)')
  } else {
    failures.push(`client.js: 被拒的文件没有提示 (${JSON.stringify(rejectNotes)})`)
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
expect('client.js', client, 'function mergeTimeline')
expect('client.js', client, 'function dropRecord')
expect('client.js', client, 'mergeTimeline(carried, orderTimeline(')
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

/**
 * 某一行 trim 之后逐字等于这一句 —— 用来钉"这一行不许再往后追加东西"
 *
 * `expect(...)` 是子串命中, 于是 `var sameKind = a === b` 加个 `|| c` 照样绿; 关键的一行要按整行钉
 * @param label - 读数里那条说明
 * @param source - 被查的源码
 * @param text - 应当逐字等于的那一行 (前后空白不算)
 */
function expectExactLine(label, source, text) {
  const lines = String(source).split('\n').map((line) => line.trim())
  if (lines.includes(String(text).trim())) notes.push(`ok   ${label}`)
  else failures.push(`${label}: 没有逐字等于 ${JSON.stringify(text)} 的那一行`)
}

/**
 * 取一处调用的实参列表 (按顶层逗号切、压空白) —— 用来钉实参次序, 子串命中管不了这个
 *
 * 括号深度按字符数, 字符串里的括号会算歪: 这里只用来查纯表达式调用 (`Date.now()` / `foo(x)`),
 * 别拿它解带引号的长串
 * @param source - 被查的源码
 * @param callee - 函数名 (不带括号)
 * @returns {string[]|null} 实参数组; 找不到 / 括号不配回 null
 */
function callArgs(source, callee) {
  const at = String(source).indexOf(`${callee}(`)
  if (at < 0) return null
  let depth = 1
  let current = ''
  const args = []
  for (let i = at + callee.length + 1; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '(') depth += 1
    if (ch === ')') {
      depth -= 1
      if (depth === 0) {
        args.push(current)
        break
      }
    }
    if (ch === ',' && depth === 1) {
      args.push(current)
      current = ''
      continue
    }
    current += ch
  }
  if (depth !== 0) return null
  const cleaned = args.map((arg) => arg.replace(/\s+/gu, ' ').trim())
  // 尾随逗号 (`foo(a, b,)`) 会多出一个空串, 那不是实参
  while (cleaned.length > 0 && cleaned[cleaned.length - 1] === '') cleaned.pop()
  return cleaned
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

// ── 十一、浮球菜单搬进 `⋯` (2026-11-14) ───────────────────────────────────────
//
// 主人这一轮: "前台界面时不再显示 luwi 的设置浮标, 而是加到右上角更多右边" → "不用新建图标和按钮,
// 直接把设置浮标菜单内容都塞到 ··· 即可"。于是三件事必须同时成立:
// ① 页面抽屉真的画原生那一份清单, ② 清单里每一件都在且执行仍是真函数, ③ 前台浮球让位、后台回来

const portalMenu = read('app/src/main/java/io/github/yuloong07star/luwi/ui/PortalMenu.kt')
const hostScreen = read('app/src/main/java/io/github/yuloong07star/luwi/ui/HostScreen.kt')
const portalAsk = read('app/src/main/java/io/github/yuloong07star/luwi/ui/PortalAsk.kt')

expect('client.js', client, "call('portalMenu')")
expect('client.js', client, "call('portalMenuPick', item.id)")
expect('client.js', client, 'function portalRow')
expect('client.js', client, 'function renderScreenDrawer')
expect('client.js', client, "drawer === 'screen'")
// **屏清单的签名必须带上 title 与 enabled** (#F10 判据单点名的那一条, 与 F6 同一条线):
// 签名只拼 id / on 的话, 原生把某一行**改名**或**置灰** (`enabled:false`) 时签名不变 → 抽屉不重画,
// 屏上停着一份旧清单 (点了没反应 / 灰着的行还亮着). 函数还没并进来时**明确记一句**, 不当作绿
const panelSignatureSource = sliceFunction('screenPanelSignature')
if (panelSignatureSource === '') {
  notes.push('ok   本工位还没有 F6 的 screenPanelSignature (F6 合入后这一条自动盯 title / enabled)')
} else if (panelSignatureSource.includes('title') && panelSignatureSource.includes('enabled')) {
  notes.push('ok   screenPanelSignature 同时拼了 title 与 enabled (改名 / 置灰都会换签名)')
} else {
  failures.push('client.js: screenPanelSignature 漏了 title 或 enabled —— 那一行改名 / 置灰时抽屉不会重画')
}
expect('client.js', client, "drawerRow('判断'")
expect('client.js', client, "drawerRow('探索'")
// 2026-11-17 主人: 探索下面多一行「开发」, 点进去是原生开发面板
expect('client.js', client, "drawerRow('开发'")
expect('client.js', client, "openDrawer('dev')")
expect('client.js', client, 'function renderDevDrawer')
expect('client.js', client, "drawerRow('新建开发应用'")
expect('client.js', client, "'打开开发台（虚拟屏）'")
expect('client.js', client, "drawerRow('下载 luwi 开发安卓工具'")
expect('client.js', client, 'function renderDevDownloadDrawer')
expect('client.js', client, "'关闭开发台'")
expect('client.js', client, "act(screenOpen ? 'screen.close' : 'screen')")
const portalDev = read('app/src/main/java/io/github/yuloong07star/luwi/ui/PortalDev.kt')
expect('PortalDev.kt 开/关两态', portalDev, '"screenOpen"')
expect('PortalDev.kt 收屏那一支', portalDev, '"screen.close"')
expect('收屏走 byUser', portalDev, 'VirtualScreen.release(screen, byUser = true)')
expect('client.js', client, "pickOne('download:direct')")
expect('client.js', client, "pickOne('download:mirror')")
expect('client.js', client, "kv('已有项目'")
expect('client.js', client, "call('portalDev')")
expect('client.js', client, "call('portalDevPick', id)")
expect('client.js', client, "drawerRow('收起'")
// 原生清单里那几件一件都不能少 (少一件就是前台少一个入口)
expect('PortalMenu.kt', portalMenu, 'fun json(context: Context): String')
expect('PortalMenu.kt', portalMenu, 'fun pick(context: Context, id: String): String')
for (const id of ['screens', 'screen-release', 'screen-window', 'touch', 'sync', 'tavern', 'portal', 'feedback', 'settings']) {
  expect(`PortalMenu.kt 的 ${id} 那一行`, portalMenu, `id = "${id}"`)
}
// 2026-11-17: 虚拟屏子项只留回收与小窗 —— 屏名行与「暂停接受控制」撤掉 (两个菜单同一条口径)
expect('无屏名行', String(!portalMenu.includes('id = "screen:')), 'true')
expect('菜单里没有暂停接受控制', String(!/暂停接受控制|继续接受控制/u.test(portalMenu)), 'true')
expect('球菜单里也没有暂停接受控制', String(!/暂停接受控制|继续接受控制/u.test(hostScreen)), 'true')
expect('后台「开发」仍由掷标开原生面板', portalMenu, 'PortalAsk.Target.DEV')
expect('球菜单有开发那一行', hostScreen, 'text = "开发"')
expect('开发面板复用同一份 DevItems', hostScreen, 'DevPanelDialog(')
expect('释放仍带 byUser', portalMenu, 'VirtualScreen.release(it, byUser = true)')
// 2026-11-21 终端那一行改口径: 点它 = 打开终端那一页 (手机管电脑), 不再在菜单里翻开关
expect('终端那一行打开终端页', portalMenu, 'PortalTerminal.open(context)')
expect('终端的开关只剩设置页一处', String(!/SyncSetting\.setSyncOn\(context, wanted\)/u.test(portalMenu)), 'true')
// 2026-11-22: 写完不再一声不吭重启 —— 先弹那一问 (`RestartHostDialog`), 重启留在它的「现在重启」里
expect('终端改完先问一句再重启 (HostScreen)', hostScreen, 'RestartHostDialog(')
expect('重启那一问的真动作', hostScreen, 'DshHost.restart(context)')
expect('设置页那几处写入点共用同一问', settingsScreen, 'RestartHostDialog(')
expect('回到后台走页面那条入口', portalMenu, 'window.__LUWI_PORTAL__')
expect('PortalBridge.kt', portalBridge, 'fun portalMenu(): String')
expect('PortalBridge.kt', portalBridge, 'fun portalMenuPick(id: String): String')
expect('PortalAsk.kt', portalAsk, 'enum class Target { SETTINGS, TAVERN, FEEDBACK, DEV, DEV_NEW, DEV_IMPORT, MIC, PAIR, PC_INSTALL }')
expect('PortalAsk.kt', portalAsk, 'val pending = mutableStateOf<Target?>(null)')
expect('前台浮球让位', hostScreen, 'if (!PortalState.open) {')
expect('小窗那一格挪到进程里', hostScreen, 'ScreenWindow.hidden')
expect('设置页由掷标打开', hostScreen, 'PortalAsk.Target.SETTINGS -> navigator.push(Screen.Settings)')
expect('酒馆由掷标打开', hostScreen, 'PortalAsk.Target.TAVERN -> navigator.push(Screen.TavernHome)')
expect('反馈窗由掷标打开', hostScreen, 'PortalAsk.Target.FEEDBACK -> feedbackOpen = true')
// 球菜单**没有撤**: 回到 dsh 后台之后门户不在, 那时只有球能开门
expect('球菜单仍在 (后台那一条)', hostScreen, '"回到后台" else "回到前台"')
expect('球菜单的反馈项仍在', hostScreen, 'onFeedback = { feedbackOpen = true }')
// 「回到前台」那句调过的是一个没暴露的方法 (`portal.isOpen`), 一按就 TypeError —— 2026-11-14 修
expect('回到前台走的是 mount 的幂等', client, 'portal.mount()')
if (/if \(!portal\.isOpen\(\)\) portal\.mount\(\)/u.test(client)) {
  failures.push('client.js: 还有 `if (!portal.isOpen()) portal.mount()` 那句 (那个方法没暴露, 一按就 TypeError)')
} else {
  notes.push('ok   「回到前台」不再问 portal.isOpen')
}

// ── 十六、判断抽屉那两颗按钮 (2026-11-15 主人: "关掉唤醒和唤醒一下无法点击") ────
//
// 两句抱怨背后是两件可量的事: ① 开关态当时是 `router.json` 与 `sim.json` 的合成值, 只写前者时
// 按「关掉唤醒」按钮文案不变, 看上去就是点不动 ② 「唤醒一下」投完一行就再无回音, 屏上什么都不变,
// 与"没接上"同形。于是这里钉三处: 关的时候 sim 也收 / 点了有回执 / 动作行钉在抽屉底部 (检测项一多
// 就滚出可视区的另一档)
//
// **2026-11-20 改口**: `sim.json` 的 `wake.mode` 那一格整格删掉了, 开关只剩 `router.json` 一个来源 ——
// 于是 bySim / setWakeMode / 「更多设置里选的活跃」那几句一起退场, 那一行只说"开着 / 关着"

expect('PortalBridge.kt', portalBridge, 'put("enabled", RouterTick.enabled(context))')
expect('PortalBridge.kt', portalBridge, 'put("host"')
expect('PortalBridge.kt', portalBridge, 'ExploreSchedule.wakeHost(')
expect('PortalBridge.kt', portalBridge, 'Log.i(LOOK_TAG, "portal wake: queued')
expect('PortalBridge.kt', portalBridge, '"portal tick switch -> ')
expect('client.js', client, "call('portalTickEnabled', !tickOn)")
expect('client.js', client, "result.host === 'starting'")
expect('client.js', client, "tickNote = '已投出去")
expect('client.js', client, 'position:sticky')
// 开关态只剩一句话, 且页面不许再出现"哪一侧来的"那种第二档说法
expect('client.js', client, "'开着 (25-55 分一次)'")

// ── 十七、判断层「唤醒一下」必须主动说话 (2.8.1 #8) ─────────────────────────────
//
// 主人 2026-11-15: "点击唤醒一下时, 必须主动说话" (21:13 补充: 指判断层那颗), 验收是"连点 3 次,
// 每次 3 s 内都出现一条非空 lw_say 文本气泡, 不是固定同一句". 四段链路少一段就回到"点了没反应":
// ① 应用投 `source:"wake"` (与闹钟 `router` 分开) ② 宿主那一支不过 `judgeRouter` 那几道闸
// ③ 应声**先**落进 `lw/out` 再开轮 (3 s 那一颗气泡不靠模型) ④ 门户点完自己补几拍, 换场不清屏

expect('VoiceInbox.kt', voiceInbox, 'const val SOURCE_WAKE = "wake"')
expect('PortalBridge.kt', portalBridge, 'VoiceInbox.SOURCE_WAKE')
expect('host-plugin', hostPlugin, "line.source === 'wake'")
expect('host-plugin', hostPlugin, 'return routerWakeNow(ctx)')

// 人点的那一下**不许**再过判断层那几道闸: 静默时段 / 冷却 / 沉睡前等待一个字都不该出现 ——
// 出现了就说明又接回 `judgeRouter`, "点了不出声"会原样回来
const wakeAt = hostPlugin.indexOf('async function routerWakeNow(ctx) {')
const wakeEnd = wakeAt < 0 ? -1 : hostPlugin.indexOf('\n}\n', wakeAt)
const wakeSource = wakeAt < 0 || wakeEnd < 0 ? '' : hostPlugin.slice(wakeAt, wakeEnd + 3)
if (wakeSource === '') {
  failures.push('host-plugin: 抽不出 routerWakeNow (名字或缩进改过?)')
} else {
  const gates = ['judgeRouter', 'quiet', 'cooldown', 'preSleep']
  const present = gates.filter((one) => wakeSource.includes(one))
  if (present.length > 0) failures.push(`routerWakeNow 里又接上了判断闸: ${present.join(' / ')}`)
  else notes.push('ok   routerWakeNow 一道判断闸都不看 (人点了就必须出声)')
}
expect('host-plugin', hostPlugin, 'text: wakeStartLine(chosen.text, chosen)')
expect('host-plugin', hostPlugin, 'openLine: chosen.text')
expect('host-plugin', hostPlugin, "via: 'wake'")
// 那一声已经说出去了: 开场要交代"别重复它", 否则模型把同一句再发一遍就是两条一样的气泡
expect('host-plugin', hostPlugin, '不要重复它')
// 2.8.1 #31: 第一句由宿主从判断层里挑 (检测项 / 未了的事), 不是模型那一轮赶出来
expect('host-plugin', hostPlugin, 'wakeTopicFor(before, await readWishes()')
expect('host-plugin', hostPlugin, 'wakeStartLine(chosen.text, chosen)')

// 应声要**排在投第一句之前**: 气泡先到, 模型那一轮后到 —— 反过来就又要等模型
const startAt = hostPlugin.indexOf('async function startProactive(ctx, options = {}) {')
const startEnd = startAt < 0 ? -1 : hostPlugin.indexOf('\n}\n', startAt)
const startBody = startAt < 0 || startEnd < 0 ? '' : hostPlugin.slice(startAt, startEnd + 3)
const openAt = startBody.indexOf('openRow = await lwOutAppend(sessionId')
const deliverAt = startBody.indexOf('await deliverToBall(')
if (startBody === '' || openAt < 0 || deliverAt < 0 || openAt > deliverAt) {
  failures.push('startProactive: 应声没有先落盘 (openLine 那一句要排在 deliverToBall 之前)')
} else {
  notes.push('ok   应声先落进 lw/out 再开轮 (3 s 内那颗气泡不靠模型)')
}

// 连点三次不许是同一句: 池子轮转 (抽那一段纯函数真跑, 不复制第二份)
const lineAt = hostPlugin.indexOf('function wakeLineFor(lines, cursor) {')
const lineEnd = lineAt < 0 ? -1 : hostPlugin.indexOf('\n}\n', lineAt)
const lineSource = lineAt < 0 || lineEnd < 0 ? '' : hostPlugin.slice(lineAt, lineEnd + 3)
if (lineSource === '') {
  failures.push('host-plugin: 抽不出 wakeLineFor (名字或缩进改过?)')
} else {
  const fallback = grab(hostPlugin, /const ROUTER_WAKE_FALLBACK = '([^']+)'/) ?? ''
  const wakeLineFor = new Function('ROUTER_WAKE_FALLBACK', `${lineSource}\nreturn wakeLineFor`)(fallback)
  const pool = ['一', '二', '三']
  const picks = []
  let cursor = 0
  for (let i = 0; i < 4; i += 1) {
    const one = wakeLineFor(pool, cursor)
    picks.push(one.text)
    cursor = one.cursor
  }
  const rows = [
    picks.join(''), // 连点四次的四句 (转一圈回到第一句)
    wakeLineFor(pool, 7).text, // 游标越界夹回来 (7 % 3 = 1)
    wakeLineFor(pool, -1).text, // 负数也夹回最后一句
    wakeLineFor([], 0), // 空池子兜底
  ]
  const want = ['一二三一', '二', '三', { text: fallback, cursor: 0 }]
  if (JSON.stringify(rows) === JSON.stringify(want)) {
    notes.push('ok   wakeLineFor: 连着点不是同一句 (四拍一圈 / 越界夹回 / 空池兜底)')
  } else {
    failures.push(`wakeLineFor 轮转不对: got ${JSON.stringify(rows)} want ${JSON.stringify(want)}`)
  }
}

// 池子本身至少三句且不重复, 并且**一句被动应声都不许有** (2.8.1 #31)
const poolAt = hostPlugin.indexOf('const ROUTER_WAKE_TOPICS = Object.freeze([')
const poolEnd = poolAt < 0 ? -1 : hostPlugin.indexOf('])', poolAt)
const poolSource = poolAt < 0 || poolEnd < 0 ? '' : hostPlugin.slice(poolAt, poolEnd)
const wakeLines = [...poolSource.matchAll(/'([^']+)'/gu)].map((one) => one[1])
const passiveWake = ['怎么了', '怎么啦', '叫我', '在呢', '嗯?', '嗯嗯']
const passiveHits = wakeLines.filter((one) => passiveWake.some((word) => one.includes(word)))
if (wakeLines.length >= 3 && new Set(wakeLines).size === wakeLines.length && passiveHits.length === 0) {
  notes.push(`ok   唤醒开场池子 ${wakeLines.length} 句, 全是主动找话题 (没有「怎么了」「嗯?」这类)`)
} else {
  failures.push(`唤醒开场池子不对 (句数 / 重复 / 被动句): ${JSON.stringify(wakeLines)}`)
}
if (hostPlugin.includes('const ROUTER_WAKE_LINES')) {
  failures.push('host-plugin: 被动应声池 ROUTER_WAKE_LINES 还在 (2.8.1 #31 要的是主动找话题)')
} else {
  notes.push('ok   被动应声池已撤 (ROUTER_WAKE_LINES 不在了)')
}


// 门户那一侧: 点完自己补几拍, 换场不清屏上已有的气泡, 连点之间被覆盖的那一场也补得上
expect('client.js', client, 'function watchWake')
expect('client.js', client, 'function adoptEchoRun')
expect('client.js', client, 'function adoptProactiveRuns')
expect('client.js', client, 'watchWake()')
expect('client.js', client, '她这就说')
// `run` 只有最新一场: 连点三次时中间那一场靠宿主记的 `recent` 补 (2.8.1 #8)
expect('host-plugin', hostPlugin, 'recent: proactiveRecent.slice(-PROACTIVE_RECENT_MAX)')
expect('host-plugin', hostPlugin, 'proactiveRecent.push({ session: sessionId, startedAt, via })')
expect('host-plugin', hostPlugin, 'Array.isArray(record?.recent) ? record.recent : []')
expect('PortalBridge.kt', portalBridge, 'optJSONArray("recent")')
expect('client.js', client, 'adoptProactiveRuns(run) === 0')
expect('client.js', client, 'openedAt - 1')
const adoptSource = takeFunction('adoptEchoRun')
if (adoptSource === '') {
  failures.push('client.js: 抽不出 adoptEchoRun (名字或缩进改过?)')
} else if (adoptSource.includes('echoes = []')) {
  failures.push('adoptEchoRun: 换场把屏上已有的气泡清了 (连点三次只剩最后一条)')
} else {
  notes.push('ok   adoptEchoRun 换场不清屏上已有的气泡')
}
const runsSource = takeFunction('adoptProactiveRuns')
if (runsSource === '' || !runsSource.includes('proactiveNew(runs[i], proactiveSeen)')
  || !runsSource.includes('adoptEchoRun(runs[i])') || !runsSource.includes('startedAt')) {
  failures.push('client.js: adoptProactiveRuns 没有按 startedAt 逐场走 proactiveNew + adoptEchoRun')
} else {
  notes.push('ok   adoptProactiveRuns 按 startedAt 升序逐场补 (中间那场也在)')
}
const ledgerBody = takeFunction('pollLedger')
if (ledgerBody === '') {
  failures.push('client.js: 抽不出 pollLedger')
} else if (!ledgerBody.includes('adoptProactiveRuns(run)') || /echoes = \[\]/u.test(ledgerBody)) {
  failures.push('pollLedger: 新一场那一支没走 adoptProactiveRuns')
} else {
  notes.push('ok   pollLedger 新一场那一支走 adoptProactiveRuns (与点完那几拍同一条)')
}
const wakePage = takeFunction('watchWake')
if (wakePage.includes('var left = 8') && wakePage.includes('setTimeout(beat, 400)')
  && wakePage.includes('adoptProactiveRuns(run)')) {
  notes.push('ok   watchWake: 8 拍 x 400 ms, 每拍按 recent 补场, 到点交回 3 s 定时器')
} else {
  failures.push('client.js: watchWake 的拍数 / 间隔 / 补场有一条不对')
}

// ── 十八、一条气泡只装一样东西 (2.8.1 #9, 主人 2026-11-15) ──────────────────────
//
// "表情或图片和文字同时进一条气泡时表情会被吞, 要求表情图片等文件必须单独发一条气泡"
// 门户这一侧管的是**升级前写下的行**: 那时宿主把图 / 文件并进最后一句那一行 (`kind:"image"` 与那句
// `text` 在同一个对象里), 门户只好把一句话和图挤进一条气泡。`outItemsOf` 把那种行拆成两项, 于是老
// 对话里也是"话一条气泡, 图一条气泡"; 新宿主写的行本来就一行一样东西, 拆不动也不该动。五条真值:
// 1) 只有话 → 一项 2) 图 + 话 → 两项 (话在前, 图在后, 两个 id 不同) 3) 文件 + 话 → 两项
// 4) 只有图 → 一项 5) 老表情行 (`text` 是占位符 `[…]`) → 一项, 正文空串 (表情自己一条气泡)

const splitSource = takeFunction('outItemsOf')
if (splitSource === '' || itemSource === '') {
  failures.push('client.js: 抽不出 outItemOf / outItemsOf (一条气泡只装一样东西那一层)')
} else {
  const outItemOf2 = new Function(`${itemSource}\nreturn outItemOf`)()
  const outItemsOf = new Function('outItemOf', `${splitSource}\nreturn outItemsOf`)(outItemOf2)
  const onlyText = outItemsOf({ seq: 1, at: 10, kind: 'text', text: '早' })
  const withImage = outItemsOf({
    seq: 2, at: 20, kind: 'image', text: '看这个', rel: 'assets/s/2-a.png', w: 10, h: 20,
  })
  const withFile = outItemsOf({
    seq: 3, at: 30, kind: 'file', text: '这份', rel: 'assets/s/3-a.pdf', name: 'a.pdf', bytes: 9,
  })
  const onlyImage = outItemsOf({ seq: 4, at: 40, kind: 'image', rel: 'assets/s/4-b.png' })
  const legacySticker = outItemsOf({ seq: 5, at: 50, kind: 'sticker', sticker: '开心', text: '[…]' })
  const cases = [
    ['只有话', onlyText.length === 1 && onlyText[0].text === '早'],
    ['只有图', onlyImage.length === 1 && onlyImage[0].image === 'assets/s/4-b.png'],
    ['表情那一行不带正文', legacySticker.length === 1
      && legacySticker[0].sticker === '开心' && legacySticker[0].text === ''],
    ['图 + 话拆两项', withImage.length === 2
      && withImage[0].text === '看这个' && !withImage[0].image
      && withImage[1].image === 'assets/s/2-a.png' && withImage[1].text === ''
      && withImage[0].id !== withImage[1].id],
    ['文件 + 话拆两项', withFile.length === 2
      && withFile[0].text === '这份' && !withFile[0].file
      && withFile[1].file && withFile[1].file.name === 'a.pdf' && withFile[1].text === ''
      && withFile[0].id !== withFile[1].id],
  ]
  const broken = cases.filter((one) => one[1] !== true).map((one) => one[0])
  if (broken.length === 0) {
    notes.push('ok   outItemsOf: 一条气泡只装一样东西 (图 / 文件与话拆成两项, 老表情行不带正文)')
  } else {
    failures.push(`outItemsOf 拆错了: ${broken.join(' / ')}`)
  }
  expect('client.js', client, 'var parts = outItemsOf(line)')
}

// ── 十九、探索面板真的显示盘上那几份 (2.8.1 #12) ───────────────────────────────
//
// 主人: "修复前台更多中探索面板的显示bug，没有同步显示，且点击开始这一趟和刷新没有反馈，
// 需要加上toast反馈". 两半各钉各的
//
// 1. **宿主的读数**: 那三行原来读的是 `explore.json` 里从来没有的键 (`nextTask` / `lastSummaryAt` /
//    `schedule.time`) —— 任务卡在 `lw/explore-card.md`、摘要在 `lw/explore/*.md`、预算在
//    `explore-schedule.json`, 于是面板永远「还没有排 / — / —」。现在一处读真的, 顺手把
//    `running` 也报上来, 页面才说得清"正在跑"
//    **2026-11-21 二改**: 排期撤了 —— `schedule` / `enabled` / `nextAt` 三个读数删掉, 换成一格 `steps`
//    (判断层每场开场真的读它); 页面那行「探索时刻」随之改成「每场步数」
// 2. **页面那一层**: 三行由 `workReading` 拼 (这里真跑真值表, 不复制第二份措辞), 抽屉开着时每一拍比
//    `workKey`, 盘上变了才重画
// 3. **两颗按钮各留一句 toast**: 抽屉盖着时输入卡那行 `#lwp-note` 在后面, 写了也看不见
// 4. **「开始这一趟」投的是那张卡**, 不是 `explore.json` 的 `nextTask` (宿主从来不写它); 步数也照设置走

expect('PortalBridge.kt 探索卡读 ExploreTask', portalBridge, 'ExploreTask.read(context)')
expect('PortalBridge.kt 预算读 ExploreSchedule.plan', portalBridge, 'ExploreSchedule.plan(context)')
expect('PortalBridge.kt 探索读数带 steps', portalBridge, 'put("steps", plan.steps)')
if (portalBridge.includes('put("nextAt"') || portalBridge.includes('put("schedule"')) {
  failures.push('PortalBridge.kt: 还在报 schedule / nextAt (排期已撤, 那是假读数)')
} else {
  notes.push('ok   PortalBridge 不再报 schedule / nextAt')
}
expect('PortalBridge.kt 探索读数带 running', portalBridge, 'put("running", ExploreTask.running(context) != null)')
expect('PortalBridge.kt 摘要取目录里最新那份', portalBridge, 'lwFile("explore").listFiles()')
expect('PortalBridge.kt 开始这一趟投那张卡', portalBridge, 'val task = card.ifEmpty { DEFAULT_EXPLORE_TEXT }')
expect('PortalBridge.kt 开始这一趟带步数', portalBridge, 'steps = ExploreSchedule.plan(context).steps')
expect('PortalBridge.kt 已经在跑就不投', portalBridge, 'if (ExploreTask.running(context) != null) {')
if (portalBridge.includes('explore.optString("nextTask")')) {
  failures.push('PortalBridge.kt: 还在读 explore.json 的 nextTask (宿主从不写那个键, 面板因此永远空)')
} else {
  notes.push('ok   PortalBridge 不再读 explore.json 的 nextTask')
}

expect('client.js 提示那颗挂在 root 上', client, "els.toast.id = 'lwp-toast'")
expect('client.js 提示的样式', client, '#lwp-toast{position:absolute')
expect('client.js 探索读数带这一趟', workDrawerSource, "kv('这一趟',")
expect('client.js 开始这一趟的回执', workDrawerSource, "toast('已投出去 (第 '")
expect('client.js 已经在跑的回执', workDrawerSource, "toast('已经有一场在跑, 这一下不另开'")
expect('client.js 没投出去的回执', workDrawerSource, "toast('这一下没投出去 (收件箱写不进去)', true)")
expect('client.js 刷新的回执', workDrawerSource, "toast('已刷新 '")
expect('client.js 刷新带时刻', workDrawerSource, 'clock(fresh.now)')
expect('client.js 面板开着跟每一拍', ledgerBody, "drawer === 'work' && workKey(status && status.explore) !== workShown")

const toastSource = takeFunction('toast')
if (toastSource === '' || !toastSource.includes('els.toast.textContent =')
  || !toastSource.includes('}, 2400)')) {
  failures.push('client.js: toast 没有写到那颗元素上 / 或不会自己收 (2.4 s)')
} else {
  notes.push('ok   toast: 写到 #lwp-toast 上, 2.4 s 自己收')
}

// 探索那三行的真值: 有卡 / 空卡 / 关着 / 正在跑 四种读数都由同一个 `workReading` 拼
const readingSource = takeFunction('workReading')
const workKeySource = takeFunction('workKey')
if (readingSource === '' || workKeySource === '') {
  failures.push('client.js: 抽不出 workReading / workKey (探索面板那几行)')
} else {
  const workReading = new Function('stamp', `${readingSource}\nreturn workReading`)(
    (ms) => `T${String(ms)}`,
  )
  const workKey = new Function('workReading', `${workKeySource}\nreturn workKey`)(workReading)
  const card = {
    nextTask: '看看相册', cardChars: 812, lastSummaryAt: 1_731_700_000_000, steps: 60, running: true,
  }
  const empty = workReading({})
  const off = workReading({ ...card, cardChars: 0, running: false, steps: 0 })
  const cases = [
    ['有卡那一份', workReading(card).next === '看看相册 (812 字)'
      && workReading(card).last === 'T1731700000000'
      && workReading(card).budget === '每场最多 60 步'
      && workReading(card).running === '正在跑'],
    ['空的一份', empty.next === '还没有排 (开场会自由探索)' && empty.last === '—'
      && empty.budget === '—' && empty.running === '没在跑'],
    ['没有步数那一份', off.budget === '—' && off.next === '看看相册'],
    ['盘上没变就同一把键', workKey(card) === workKey({ ...card })],
    ['跑没跑变了就换键', workKey(card) !== workKey({ ...card, running: false })],
  ]
  const broken = cases.filter((one) => one[1] !== true).map((one) => one[0])
  if (broken.length === 0) {
    notes.push('ok   workReading: 卡 / 摘要 / 步数 / 这一趟 四行都照盘上那份写 (空与没步数各有各的说法)')
  } else {
    failures.push(`workReading 判错了: ${broken.join(' / ')}`)
  }
}

// ── 二十、唤醒开场句必须从判断层里挑, 且不是被动式 (2.8.1 #31) ─────────────────
//
// 主人 2026-11-18: "发送的内容不能是'怎么了''嗯?'这种疑问句 ... 要求必须主动找话题, 话题必须依据
// 判断层内容展开". 四段真值: ① 话题从那两处来源排出来 (关掉的不算 / 今天说过的沉底) ② 挑中的那句
// 带 `source` (`usage` / `schedule` / `check` / `wish` / `fallback`), 门户把它透成 `meta.topicSource`
// ③ 台词闸把被动开场拦下 (重选 3 次仍不合格才 `opener:"fallback"`) ④ 开场正文把话题单子交给模型

/** 从一段正文里抽一个整函数 (头一行到它自己的收尾 `}`) */
function sliceWakeFunction(source, header) {
  const at = source.indexOf(header)
  const end = at < 0 ? -1 : source.indexOf('\n}\n', at)
  return at < 0 || end < 0 ? '' : source.slice(at, end + 3)
}

/** 从一段正文里抽一个 `const X = ...` 声明 (到下一个空行为止) */
function sliceWakeConst(source, name) {
  const at = source.indexOf(`const ${name} = `)
  if (at < 0) return ''
  const end = source.indexOf('\n\n', at)
  return end < 0 ? '' : source.slice(at, end)
}

const wakeConsts = [
  sliceWakeConst(hostPlugin, 'ROUTER_WAKE_TOPICS'),
  sliceWakeConst(hostPlugin, 'ROUTER_WAKE_TOPIC_LINES'),
  sliceWakeConst(hostPlugin, 'ROUTER_WAKE_FALLBACK'),
  sliceWakeConst(hostPlugin, 'ROUTER_WAKE_PASSIVE_PREFIXES'),
  sliceWakeConst(hostPlugin, 'ROUTER_WAKE_PASSIVE_CHARS'),
  sliceWakeConst(hostPlugin, 'ROUTER_WAKE_RESELECT_MAX'),
].filter((one) => one !== '').join('\n')
const wakeDayKey = sliceWakeFunction(hostPlugin, 'function routerDayKey(now) {')
const wakeLineFn = sliceWakeFunction(hostPlugin, 'function wakeLineFor(lines, cursor) {')
const wakeSourceFn = sliceWakeFunction(hostPlugin, 'function wakeSourceOf(when) {')
const wakePassiveFn = sliceWakeFunction(hostPlugin, 'function isPassiveOpener(text) {')
const wakeTopicsFn = sliceWakeFunction(hostPlugin, 'function wakeTopicsOf(state, wishes, now) {')
const wakeTopicFn = sliceWakeFunction(hostPlugin, 'function wakeTopicFor(state, wishes, now, cursor) {')
const wakeStartFn = sliceWakeFunction(hostPlugin, 'function wakeStartLine(alreadySaid, material = {}) {')
if ([wakeConsts, wakeDayKey, wakeLineFn, wakeSourceFn, wakePassiveFn, wakeTopicsFn, wakeTopicFn, wakeStartFn]
  .some((one) => one === '')) {
  failures.push('host-plugin: 抽不出唤醒话题那几段 (wakeTopicsOf / wakeTopicFor / isPassiveOpener / wakeStartLine 名字或缩进改过?)')
} else {
  const api = new Function([
    wakeConsts,
    wakeDayKey,
    wakeLineFn,
    wakeSourceFn,
    wakePassiveFn,
    wakeTopicsFn,
    wakeTopicFn,
    wakeStartFn,
    'return { wakeTopicsOf, wakeTopicFor, wakeStartLine, isPassiveOpener, ROUTER_WAKE_TOPICS, ROUTER_WAKE_FALLBACK, ROUTER_WAKE_RESELECT_MAX }',
  ].join('\n'))()
  const wakeNow = Date.parse('2026-11-18T21:00:00+08:00')
  const wakeDay = '2026-11-18'
  const wakeState = {
    checks: [
      { id: 'c1', what: '打游戏太久', when: { kind: 'usage', minutes: 120 }, enabled: true },
      { id: 'c2', what: '开会前提醒', when: { kind: 'event', beforeMinutes: 30 }, enabled: true },
      { id: 'c3', what: '关掉的那条', when: { kind: 'time' }, at: '09:00', enabled: false },
    ],
    checksSaid: { c1: wakeDay },
  }
  const wakeWishes = [{ id: 'w1', what: '考四级', said: [] }]
  const wakeTopics = api.wakeTopicsOf(wakeState, wakeWishes, wakeNow)
  const wakeOrdered = wakeTopics.map((one) => one.what)
  const wakeSources = wakeTopics.map((one) => one.source)
  const wakeFirst = api.wakeTopicFor(wakeState, wakeWishes, wakeNow, 0)
  const wakeClicks = []
  const wakeClickSources = []
  let wakeCursor = 0
  for (let i = 0; i < 3; i += 1) {
    const one = api.wakeTopicFor(wakeState, wakeWishes, wakeNow, wakeCursor)
    wakeClicks.push(one.text)
    wakeClickSources.push(one.source)
    wakeCursor = one.cursor
  }
  const wakeChats = []
  wakeCursor = 0
  for (let i = 0; i < 3; i += 1) {
    const one = api.wakeTopicFor({}, [], wakeNow, wakeCursor)
    wakeChats.push(one.text)
    wakeCursor = one.cursor
  }
  const wakeAllSaid = api.wakeTopicFor(
    { checks: wakeState.checks, checksSaid: { c1: wakeDay, c2: wakeDay } },
    wakeWishes,
    wakeNow,
    0,
  )
  // 台词闸: 被动开场一律判 true, 带话题的长句 / 不带问号的主动开场判 false
  const gateCases = [
    ['怎么了?', true],
    ['嗯? 叫我?', true],
    ['在吗', true],
    ['在不在', true],
    ['有啥事', true],
    ['嗯嗯, 在的.', true],
    ['今天怎么样?', true],
    ['今天过得怎么样呀', false],
    ['你之前提到的「开会前提醒」, 我还记着呢, 别忘了哦~', false],
    [api.ROUTER_WAKE_FALLBACK, false],
  ]
  const gateBroken = gateCases
    .filter(([text, want]) => api.isPassiveOpener(text) !== want)
    .map(([text]) => text)
  // 一整圈游标扫下来一句被动都不许有 (池子 / 句式 / 兜底三处一起看)
  const sweep = []
  for (let i = 0; i < 40; i += 1) sweep.push(api.wakeTopicFor(wakeState, wakeWishes, wakeNow, i).text)
  for (let i = 0; i < 40; i += 1) sweep.push(api.wakeTopicFor({}, [], wakeNow, i).text)
  const sweepPassive = sweep.filter((one) => api.isPassiveOpener(one))
  const wakePrompt = api.wakeStartLine(wakeFirst.text, wakeFirst)
  const wakeCases = [
    ['今天说过的沉底 / 关掉的不算', JSON.stringify(wakeOrdered)
      === JSON.stringify(['开会前提醒', '考四级', '打游戏太久'])],
    ['三条信号的 source 各就各位', JSON.stringify(wakeSources)
      === JSON.stringify(['schedule', 'wish', 'usage'])],
    ['第一句带判断层里的那件事', wakeFirst.text.includes('「开会前提醒」')
      && wakeFirst.source === 'schedule' && wakeFirst.opener === 'active'],
    ['连点三次不是同一句', new Set(wakeClicks).size === 3],
    ['三次都从判断层里挑', wakeClicks.every((one) => one.includes('「')
      && (one.includes('开会前提醒') || one.includes('考四级') || one.includes('打游戏太久')))],
    ['三次的 source 互不相同', new Set(wakeClickSources).size === 3],
    ['三次都不是被动式', wakeClicks.every((one) => api.isPassiveOpener(one) === false)],
    ['判断层空了就挑主动开场', wakeChats.every((one) => api.ROUTER_WAKE_TOPICS.includes(one))
      && new Set(wakeChats).size === 3],
    ['两件都说过了也挑得出一件', wakeAllSaid.text.includes('「考四级」')],
    ['开场交代别重复那一句', wakePrompt.includes('不要重复它')],
    ['开场要求主动找话题', wakePrompt.includes('主动找话题')],
    ['开场把话题单子交给她', wakePrompt.includes('开会前提醒') && wakePrompt.includes('考四级')],
    ['开场点名不许被动应声', wakePrompt.includes('「怎么了」「嗯?」')],
  ]
  const wakeBroken = wakeCases.filter((one) => one[1] !== true).map((one) => one[0])
  if (gateBroken.length === 0) {
    notes.push('ok   isPassiveOpener: 被动开场一律拦下 (怎么了 / 嗯? / 在吗 / 短问句), 带话题的长句放行')
  } else {
    failures.push(`isPassiveOpener 判错了: ${JSON.stringify(gateBroken)}`)
  }
  if (wakeBroken.length === 0 && sweepPassive.length === 0) {
    notes.push('ok   wakeTopicFor: 话题从判断层里挑 (source 三档 / 沉底 / 关掉 / 空判断层 / 连点三句不同)')
  } else {
    failures.push(`wakeTopicFor 真值表不对: ${wakeBroken.join(' / ')}; 整圈扫出被动句 ${JSON.stringify(sweepPassive[0] ?? '')}`
      + ` (ordered=${JSON.stringify(wakeOrdered)})`)
  }
  if (api.ROUTER_WAKE_RESELECT_MAX === 3) {
    notes.push('ok   重选上限 3 条 (三次都不合格才走 fallback)')
  } else {
    failures.push(`ROUTER_WAKE_RESELECT_MAX 不是 3: ${JSON.stringify(api.ROUTER_WAKE_RESELECT_MAX)}`)
  }
}

// 那一句的来处跟着行走: 宿主把 `topicSource` 写进 jsonl, 门户透成 `meta.topicSource` 与 `data-topic`
expect('host-plugin', hostPlugin, 'openTopic: chosen.source')
expect('host-plugin', hostPlugin, '...(openTopic === \'\' ? {} : { topicSource: openTopic })')
expect('host-plugin', hostPlugin, 'source: chosen.source')
expect('host-plugin', hostPlugin, 'opener: chosen.opener')
if (hostPlugin.includes("the router spoke (wake: ${chosen.source})")) {
  notes.push('ok   唤醒那一行按 `the router spoke (wake: <source>)` 落日志 (真机 logcat 照这条 grep)')
} else {
  failures.push('host-plugin: 唤醒的日志行没有 `the router spoke (wake: <source>)` 形状')
}
expect('client.js', client, 'item.meta = { topicSource: topicSource }')
expect('client.js', client, "row.setAttribute('data-topic', item.meta.topicSource)")
if (client.includes("typeof line.topicSource === 'string'")) {
  notes.push('ok   门户把 jsonl 的 topicSource 透成气泡元数据 (老行没有这一格就不写)')
} else {
  failures.push('client.js: outItemOf 没读 line.topicSource')
}
// ── 二十一、拖文件进输入区 = 加附件 (2.8.1 #34) ───────────────────────────────
//
// 主人: "前台门户的输入框也要像后台DSH一样可拖放文件加入". 四条都真跑 (抽出原文, 假节点假事件):
// 1) 输入卡 (`#lwp-card`) 与 dock (`#lwp-dock`) 都挂了 dragenter / dragover / dragleave / drop
// 2) `dragover` 必须 `preventDefault()` (不叫这一声浏览器就不认这块能接, `drop` 永远不来) 并把
//    `dropEffect` 置成 `copy`
// 3) `drop` 把 `DataTransfer.files` 原样交给 `onFilesChosen` —— 与 `+` 选完同一根链
//    (`portalStash` 落 `lw-in/` → 待发 chip), 不在这里再读一遍字节
// 4) 一份都没有时说一句 (不静默), 卡上那圈高亮 (data-drop) 进出摘干净

const markDropSource = takeFunction('markDrop')
const dropFilesSource = takeFunction('dropFiles')
const bindDropSource = takeFunction('bindDropTarget')

expect('client.js: 输入卡挂拖放', client, 'bindDropTarget(els.card)')
expect('client.js: dock 挂拖放', client, 'bindDropTarget(els.dock)')
expect('client.js: 输入卡那块元素记下来了', client, 'els.card = card')
expect('client.js: dock 那块元素记下来了', client, 'els.dock = dock')
expect('client.js: 拖进来那一刻的高亮', client, '#lwp-card[data-drop="over"]')
expect('client.js: 高亮摘掉', client, "els.card.removeAttribute('data-drop')")
// 拖进来那一刻的说明牌 (2026-11-19 主人: "再加上如图所示的提示"): 两行字 + 那块盖在卡上的层
expect('client.js: 说明牌那块层', client, '#lwp-drop-hint')
expect('client.js: 说明牌只在拖进来时出现', client, '#lwp-card[data-drop="over"] #lwp-drop-hint{display:flex}')
expect('client.js: 说明牌不接点击', client, 'pointer-events:none')
expect('client.js: 第一行说拖到这儿就能加', client, '文件或图片拖动到此处即可添加')
expect('client.js: 第二行的上限取本机真数', client, "'最多 ' + MAX_ATTACH + ' 个附件, 每份不超过 '")
expect('client.js: 上限从一个常量来', client, "Math.round(MAX_STASH_BYTES / (1024 * 1024)) + ' MB'")
expect('client.js: 两个图标是内联 SVG', client, 'var DROP_MARKS_SVG')
// 真机上系统拖放不给页面 HTML5 事件, 说明牌只能由原生喊: 暴露一个 dropOver 给 HostScreen
expect('client.js: 暴露 dropOver 给原生', client, 'dropOver: function (over) { markDrop(over === true) }')

if (markDropSource === '' || dropFilesSource === '' || bindDropSource === '') {
  failures.push('client.js: 抽不出 markDrop / dropFiles / bindDropTarget (拖放那条路不在)')
} else {
  /** 一块假节点: 记下挂上来的监听, 能按类型派一个事件 */
  function dropNode(id) {
    const listeners = new Map()
    const attrs = new Map()
    return {
      id,
      attrs,
      listeners,
      addEventListener: (type, fn) => { listeners.set(type, fn) },
      setAttribute: (name, value) => { attrs.set(name, value) },
      removeAttribute: (name) => { attrs.delete(name) },
      dispatch: (type, event) => {
        const fn = listeners.get(type)
        if (fn === undefined) throw new Error(`没有挂 ${type} 监听`)
        return fn(event)
      },
    }
  }

  /** 一个假事件: 数 preventDefault / stopPropagation 各叫了几次, `files` 是那几份 */
  function dropEvent(files) {
    const calls = { prevent: 0, stop: 0 }
    return {
      calls,
      dataTransfer: files === undefined ? null : { files, dropEffect: 'none' },
      preventDefault: () => { calls.prevent += 1 },
      stopPropagation: () => { calls.stop += 1 },
    }
  }

  const cardEl = dropNode('lwp-card')
  const elsStub = { card: cardEl }
  const markDrop = new Function('els', `${markDropSource}\nreturn markDrop`)(elsStub)

  const landed = []
  const saidNote = []
  const logged = []
  const dropFiles = new Function(
    'markDrop', 'onFilesChosen', 'showNote', 'console',
    `${dropFilesSource}\nreturn dropFiles`,
  )(
    markDrop,
    (files) => { landed.push(files) },
    (text, isError) => { saidNote.push({ text, isError }) },
    { log: (line) => { logged.push(String(line)) } },
  )
  const bindDropTarget = new Function(
    'markDrop', 'dropFiles', `${bindDropSource}\nreturn bindDropTarget`,
  )(markDrop, dropFiles)

  // ① 四条监听都挂上
  const wired = dropNode('lwp-card')
  bindDropTarget(wired)
  const types = [...wired.listeners.keys()].sort().join(',')
  if (types === 'dragenter,dragleave,dragover,drop') {
    notes.push('ok   dragenter / dragover / dragleave / drop 四条都挂上了')
  } else {
    failures.push(`bindDropTarget 挂的是 ${types} (应 dragenter,dragleave,dragover,drop)`)
  }
  // 挂不上的输入 (null / 不是节点) 不许抛
  let threw = ''
  try {
    bindDropTarget(null)
    bindDropTarget({})
  } catch (error) {
    threw = error.message
  }
  if (threw === '') notes.push('ok   bindDropTarget 遇到空节点就地返回 (不抛)')
  else failures.push(`bindDropTarget(null) 抛了: ${threw}`)

  // ② dragover 必须 preventDefault, 并且置 dropEffect='copy' + 亮高亮
  const over = dropEvent([])
  wired.dispatch('dragover', over)
  if (over.calls.prevent === 1 && over.calls.stop === 1) {
    notes.push('ok   dragover: preventDefault + stopPropagation 各一下')
  } else {
    failures.push(`dragover 的 preventDefault ${String(over.calls.prevent)} 次 / stopPropagation ${String(over.calls.stop)} 次 (各应 1)`)
  }
  if (over.dataTransfer !== null && over.dataTransfer.dropEffect === 'copy') {
    notes.push("ok   dragover: dropEffect 置成 copy")
  } else {
    failures.push('dragover 没把 dropEffect 置成 copy (光标显示成不收)')
  }
  if (cardEl.attrs.get('data-drop') === 'over') notes.push('ok   dragover: 卡上亮起 data-drop=over')
  else failures.push('dragover 没让输入卡亮起来 (data-drop 不是 over)')

  // dragenter 也要 preventDefault: 有的 WebView 只认这一声
  const enter = dropEvent([])
  wired.dispatch('dragenter', enter)
  if (enter.calls.prevent === 1) notes.push('ok   dragenter: 也 preventDefault')
  else failures.push('dragenter 没 preventDefault (老 WebView 上 drop 就不来)')

  // dragleave 摘高亮
  wired.dispatch('dragleave', dropEvent([]))
  if (cardEl.attrs.has('data-drop') !== true) notes.push('ok   dragleave: 高亮摘掉')
  else failures.push('dragleave 之后卡上还亮着 (data-drop 没摘)')

  // ③ drop: DataTransfer.files 原样交给 onFilesChosen, 高亮摘掉, 一行读数带来源与文件名
  const files = [
    { name: '检查.png', size: 2048, type: 'image/png' },
    { name: 'notes.md', size: 512, type: 'text/markdown' },
  ]
  landed.length = 0
  logged.length = 0
  const drop = dropEvent(files)
  wired.dispatch('drop', drop)
  if (drop.calls.prevent === 1) notes.push('ok   drop: preventDefault (不交给 WebView 当默认拖放)')
  else failures.push('drop 没 preventDefault (WebView 会自己去打开那个文件)')
  if (landed.length === 1 && landed[0] === files) {
    notes.push('ok   drop: DataTransfer.files 原样交给 onFilesChosen (同一条附件链)')
  } else {
    failures.push(`drop 没把 files 交给 onFilesChosen (交了 ${String(landed.length)} 次)`)
  }
  if (cardEl.attrs.has('data-drop') !== true) notes.push('ok   drop: 落下后高亮摘掉')
  else failures.push('drop 之后卡上还亮着 (data-drop 没摘)')
  const dropLine = logged.find((line) => line.indexOf('[luwi-portal] drop ') === 0) || ''
  if (dropLine.includes('lwp-card') && dropLine.includes('2') && dropLine.includes('检查.png')
    && dropLine.includes('notes.md')) {
    notes.push('ok   drop: 那行读数带来源 / 份数 / 文件名 (真机 logcat 只认它)')
  } else {
    failures.push(`drop 那行读数不对: ${JSON.stringify(dropLine)}`)
  }

  // ④ 一份都没有: 说一句, 不静默、也不空转 onFilesChosen
  landed.length = 0
  saidNote.length = 0
  wired.dispatch('drop', dropEvent([]))
  if (landed.length === 0 && saidNote.length === 1 && saidNote[0].isError === true) {
    notes.push('ok   drop 空手而归: 说一句错话, 不调 onFilesChosen')
  } else {
    failures.push('drop 空手而归时既不说也不拦 (静默)')
  }
  // dataTransfer 都没有 (不是拖文件进来的 drop) 也一样要有个说法
  wired.dispatch('drop', { preventDefault: () => {}, stopPropagation: () => {}, dataTransfer: null })

  // 这里不许自己读字节 / 自己落盘: 那会是第二份文件读取逻辑
  if (/portalStash|FileReader|readImage\(|stashOne\(/.test(dropFilesSource)) {
    failures.push('client.js: dropFiles 里自己读字节 / 自己落盘了 (该只转手给 onFilesChosen)')
  } else {
    notes.push('ok   dropFiles 不自己读字节、不自己落盘 (只转手给 onFilesChosen)')
  }
}

// ── 二十二、接住系统拖放的是原生这一层 (2.8.1 #34) ───────────────────────────
//
// 第二十节验的是"页面接得住 HTML5 drop", 但 Android 的 WebView 对文件管理器拖过来的 `content://`
// **不派发 HTML5 drop** (2026-11-19 复核: 只挂 JS 监听时真机拿不到"投 1 个 -> 出 1 个 chip" 的读数),
// 真正接住它的是 `HostScreen` 里那个 `setOnDragListener`. 这一节读源码盯五件:
// 1) WebView 上确实挂了 setOnDragListener
// 2) 落盘走与 `+` 选完同一份实现 (`PortalBridge.stashPicked`), 再把落好的几份交回页面 (`pickedFiles`)
// 3) 只认带 Uri 的拖拽: 页面自己的拖拽与拖纯文本不被吃掉, 否则 dsh 页面里那些拖拽全哑
// 4) drop 有一行读数 (真机上"拖进来没有 / 几份 / 叫什么"只认它)
// 5) 一份都没落成时也得说一句 (`nothingLanded`, 与选文件那条路同一份)
//
// 注: 页面上那圈虚线高亮只对桌面浏览器有效 —— 系统拖进来时 WebView 不给页面 dragover, 所以真机上
// 看到的是系统自己的拖拽影子, 那圈 `data-drop` 高亮不会亮. 这不是缺陷, 是那套事件的边界

// 源码正文用上面那份 `hostScreen` (球菜单那一节读的), 这里不再读第二遍
expect('HostScreen: WebView 挂上 setOnDragListener', hostScreen, 'setOnDragListener { _, event ->')
expect('HostScreen: 拖放走 stashPicked (与 + 同一条落盘)', hostScreen, 'portal.stashPicked(uris)')
expect('HostScreen: 落好的几份交回页面', hostScreen, 'pickedFiles(landed ?: nothingLanded(uris.size))')
expect('HostScreen: drop 那行读数 (份数与文件名)', hostScreen, 'Log.i(WEB_TAG, "drop -> ')
expect(
  'HostScreen: 只认带 Uri 的拖拽 (不抢页面自己的拖拽)',
  hostScreen,
  'DragEvent.ACTION_DRAG_STARTED -> dropUris(event.clipData).isNotEmpty()',
)
expect(
  'HostScreen: ClipData 只认 content / file',
  hostScreen,
  'uri.scheme == "content" || uri.scheme == "file"',
)
expect('HostScreen: 拖进来读挂了也不静默', hostScreen, 'nothingLanded(uris.size)')
// 说明牌与那圈虚线在真机上只能由原生喊醒 (系统拖放不给页面 HTML5 事件)
expect('HostScreen: 拖进来时点亮说明牌', hostScreen, 'DragEvent.ACTION_DRAG_ENTERED -> {')
expect('HostScreen: 拖进来那一拍调 dropOver(true)', hostScreen, 'dropOver(true)')
expect('HostScreen: 拖走 / 松手 / 结束三拍都灭', hostScreen, 'DragEvent.ACTION_DRAG_EXITED, DragEvent.ACTION_DRAG_ENDED -> {')
expect('HostScreen: 灭的那一句', hostScreen, 'dropOver(false)')
// 一处一致性: 说明牌上写的 12 MB 与宿主落盘那一份上限必须是同一个数 (漂了就是在骗人)
const lwInSource = read('app/src/main/java/io/github/yuloong07star/luwi/tool/LwIn.kt')
const hostLimit = /const val MAX_BYTES = (\d+) \* 1024 \* 1024/.exec(lwInSource)?.[1] ?? ''
const portalLimit = /var MAX_STASH_BYTES = (\d+) \* 1024 \* 1024/.exec(client)?.[1] ?? ''
if (hostLimit !== '' && hostLimit === portalLimit) {
  notes.push(`ok   说明牌的上限与宿主 LwIn.MAX_BYTES 同一个数 (${hostLimit} MB)`)
} else {
  failures.push(`说明牌的上限与宿主对不上: 宿主=${hostLimit || '?'} 门户=${portalLimit || '?'}`)
}

// ── 二十三、头像 = 历史 + 「已开新对话」是浮层 (2026-11-19, 主人) ────────────────
//
// 原话: "点击头像开新对话改为打开历史" + "头像点击进入新对话按钮生效范围缩小到头像大小" +
// "新对话的提示弹窗要单独一层, 否则会导致中间的图文受弹窗影响下移, 弹窗消失后又上移"

// ① 头像那颗钮开的是历史窗, 而且里面**只有头像** (昵称搬出去当标识)
expect('client.js', client, 'els.brand.onclick = function () { openHistory() }')
expect('client.js', client, 'els.brand.setAttribute(\'aria-label\', \'历史对话\')')
if (!client.includes('els.brand.appendChild(brandText)')) {
  notes.push('ok   昵称不在那颗按钮里 (点名字不再开任何东西)')
} else {
  failures.push('client.js: 昵称又塞回头像按钮里了 —— 点名字会被当成点按钮')
}
// ② 热区 = 头像本身: 28x28 的圆钮, 不是原来那条 flex:1 的大胶囊
if (client.includes("'#lwp-brand{display:block;flex:none;width:28px;height:28px;")
  && !client.includes("'#lwp-brand{display:flex")) {
  notes.push('ok   头像按钮就是头像那么大 (28x28, 主体热区没有外扩)')
} else {
  failures.push('client.js: 头像按钮还是那条 flex:1 的大胶囊 (热区没有缩到头像)')
}
// ③ 新对话仍有入口: 历史窗底部那一颗 (头栏不再是入口)
expect('client.js', client, 'function startFromHistory')
expect('client.js', client, 'els.historyNew.onclick = function () { startFromHistory() }')
// ④ 「已开新对话」是 absolute 的一层: 不参与排版, top 按头栏实际高度写
expect('client.js', client, "'#lwp-undo{position:absolute;left:50%;transform:translateX(-50%);z-index:2;pointer-events:none;")
expect('client.js', client, 'els.undo.style.top = String(')
if (!client.includes("'#lwp-undo{align-self:center")) {
  notes.push('ok   「已开新对话」不再占流里的高度 (出现/收起都不顶动中间的图文)')
} else {
  failures.push('client.js: 提示还是流里的一块 —— 一出现中间那张脸就被顶下去')
}

// ── 二十四、语音输入 + 「终端」那一颗上移 (2026-11-20) ─────────────────────────
//
// 主人四条: "输入框灰字提示改成「发消息或长按说话」" / "长按输入框进入语音输入" /
// "原来「历史」的位置加上语音开关" / "将同步由更多内移动到更多按钮左边, 语音开关右边, 在两者之间。
// 并将「同步」改名为「终端」, 设置里的字样也同步改动"
//
// 这一段钉四件事: ① 灰字就是那一句 ② 头栏三颗的顺序与身份 ③ 录音那一套两侧的接线与同一个上限
// ④ 「终端」的字样在两份 strings 里都换了, 而技术提法 (同步插件 / session-sync.json) 没被误伤

/** 从 client.js 里取一个 4 空格缩进的模块级函数源 (顶层那几个纯函数) */
function takeModuleFunction(name) {
  const found = new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n    \\}`, 'u').exec(client)
  return found === null ? '' : found[0]
}

// ① 输入框灰字
expect('client.js', client, "var VOICE_HINT = '发消息或长按说话'")
expect('client.js', client, 'els.input.placeholder = VOICE_HINT')
if (!client.includes("'说点什么'")) notes.push('ok   输入框灰字整句换成「发消息或长按说话」')
else failures.push('client.js: 输入框灰字还留着「说点什么」')

// ② 头栏: 自动朗读(喇叭) → 终端 → ⋯ 装成一簇贴最右; 喇叭那颗是**图标钮**, 两副图标按状态换
expect('client.js', client, "els.speakButton = h('button', 'lwp-tab lwp-tab-icon')")
expect('client.js', client, "els.speakButton.id = 'lwp-speak-btn'")
expect('client.js', client, 'els.speakButton.innerHTML = SPEAKER_OFF_ICON')
expect('client.js', client, 'var SPEAKER_ON_ICON = [')
expect('client.js', client, 'var SPEAKER_OFF_ICON = [')
// 两副形状: 开 = 喇叭 + 两道声波; 关 = 喇叭 + 一道斜杠 (照官方手机端那两张图)
expect('client.js', client, '<path d="M2.2 6.15h2.05L8.6 3.15v9.7L4.25 9.85H2.2z">')
expect('client.js', client, 'M10.7 5.6C11.75 6.3 12.35 7.1 12.35 8s-.6 1.7-1.65 2.4')
expect('client.js', client, 'M11 6.3l3.6 3.6M14.6 6.3L11 9.9')
// 点一下翻的是 设置 → 说话 那一格; 两句 Toast 与官方图上逐字相同
expect('client.js', client, "call('portalSpeak'")
expect('client.js', client, "'已开启自动朗读'")
expect('client.js', client, "'已关闭自动朗读'")
expect('client.js', client, 'function applySpeakStatus')
expect('client.js', client, "els.speakButton.innerHTML = speakOn ? SPEAKER_ON_ICON : SPEAKER_OFF_ICON")
expect('client.js', client, "els.syncButton = h('button', 'lwp-tab', SYNC_TITLE)")
expect('client.js', client, "els.syncButton.id = 'lwp-sync-btn'")
expectOrder('头栏: 喇叭在终端左边', client, "els.speakButton.id = 'lwp-speak-btn'", "els.syncButton.id = 'lwp-sync-btn'")
expectOrder('头栏: 终端在 ⋯ 左边', client, "els.syncButton.id = 'lwp-sync-btn'", "els.moreButton.id = 'lwp-more-btn'")
// 三颗装进 `#lwp-tabs` 这一簇: 向右对齐挂在这一簇上, 不再挂在 `⋯` 上
expect('client.js', client, "tabs.id = 'lwp-tabs'")
expect('client.js', client, 'tabs.appendChild(els.speakButton)')
expect('client.js', client, 'tabs.appendChild(els.syncButton)')
expect('client.js', client, 'tabs.appendChild(els.moreButton)')
expect('client.js', client, 'head.appendChild(tabs)')
expect('样式: 一簇靠右', client, "'#lwp-tabs{display:flex;align-items:center;gap:6px;flex:none;margin-left:auto}'")
expect('样式: 图标钮 30x28', client, "'#lwp-head .lwp-tab.lwp-tab-icon{display:grid;place-items:center;width:30px;height:28px;padding:0}'")
if (!client.includes("'#lwp-head .lwp-tab.lwp-more{padding:4px 11px;font-size:15px;margin-left:auto}'")) {
  notes.push('ok   `⋯` 不再自己顶右 (顶右交给那一簇)')
} else {
  failures.push('client.js: `⋯` 还挂着 margin-left:auto —— 另两颗会被晾在昵称旁边')
}
// 反向: 麦克风那套与"语音态"整块不许再回来
for (const gone of ['MIC_ICON', 'KEYBOARD_ICON', "'lwp-voice-btn'", "'#lwp-voice'", 'els.voiceHold',
  'toggleVoice', 'enterVoice', 'leaveVoice', 'voiceOn']) {
  if (!client.includes(gone)) notes.push(`ok   麦克风/语音态那一套已经撤干净 (${gone})`)
  else failures.push(`client.js: 还留着 ${JSON.stringify(gone)} —— 顶栏现在是喇叭(语音输出), 输入走长按即录`)
}
// 「终端」那一颗的文案 / 亮灯 / 无障碍名字只有一处来源 (原生清单), 页不抄第二份;
// **2026-11-21 起点它打开终端那一页** (不再翻开关)
expect('client.js', client, 'function applySyncState')
expect('client.js', client, "els.syncButton.setAttribute('data-on'")
expect('client.js', client, 'function pickSync')
expect('client.js', client, 'openTerminal()')
expect('client.js', client, String(!client.includes("call('portalMenuPick', 'sync')")), 'true')
// 抽屉不再画那一行 (球菜单那一份仍是原生下拉: `PortalMenu.kt` 一个字节没改)
expect('client.js', client, "if (menu[i] && menu[i].id === 'sync') continue")
expect('PortalMenu.kt 仍带 sync 那一行', portalMenu, 'id = "sync"')

// ③ 语音输入那一套: 长按当场开录 → 桥 → LwSpeech → 回推
expect('client.js', client, "call('portalVoice'")
expect('client.js', client, 'voice: function (payload) { portal.voice(payload) }')
expect('client.js', client, 'releaseVoiceCapture()')
expect('client.js', client, "els.input.addEventListener('pointerdown'")
expect('client.js', client, 'var VOICE_LONG_PRESS_MS = 450')
// 长按到点就开录: 中间没有"语音态"那一步
expect('client.js', client, 'beginHoldRecording()')
expect('client.js', client, 'function beginHoldRecording')
expect('client.js', client, 'showRecPanel()')
expect('client.js', client, "window.addEventListener('pointermove', onRecMove")
expect('client.js', client, "window.addEventListener('pointerup', onRecRelease")
// 录音条: 第一行「提示 + 计时」, 第二行波形 (2026-11-20 三次改口径: 面积 = 输入框 1.5 倍)
expect('client.js', client, "els.rec.id = 'lwp-rec'")
expect('client.js', client, "els.rec = h('div')")
expect('client.js', client, "els.recRow.id = 'lwp-rec-row'")
expect('client.js', client, "els.recDot = h('i', 'lwp-rec-dot')")
expect('client.js', client, "els.recArrow.className = 'lwp-rec-arrow'")
expect('client.js', client, "els.recWave.className = 'lwp-rec-wave'")
expect('client.js', client, "els.recDots = h('div', 'lwp-rec-dots')")
expect('client.js', client, "els.recTime = h('div', 'lwp-rec-time'")
expect('client.js', client, "els.recText.setAttribute('aria-live', 'polite')")
expect('client.js', client, "var REC_HINT = '松手转写，上滑取消'")
expect('client.js', client, "var REC_HINT_CANCEL = '松开取消'")
// 位置: 与 `#lwp-dock` 的 `0 12px 12px` 对齐, 正好压住输入卡那一块
expect('client.js', client, "'#lwp-rec{position:absolute;left:12px;right:12px;bottom:12px;z-index:7;")
expect('client.js', client, 'pointer-events:none')
expect('client.js', client, 'function paintRecWave')
// 高度: 量输入卡 × 1.5 (2026-11-20 主人: "高度改成比输入框高1.5倍即可")
expect('client.js', client, 'var REC_PANEL_RATIO = 1.5')
expect('client.js', client, 'var REC_PANEL_FALLBACK = 148')
expect('client.js', client, 'var REC_PANEL_MAX = 210')
expect('client.js', client, 'function fitRecPanel')
expect('client.js', client, 'els.card.getBoundingClientRect()')
expect('client.js', client, 'els.rec.style.height = String(wanted)')
// 边缘渐变: 面板上沿 22px 淡出 + 波形左右两端各 9% 淡出
expect('client.js', client, "'-webkit-mask-image:linear-gradient(180deg,rgba(0,0,0,0) 0,rgba(0,0,0,.72) 10px,#000 22px);'")
expect('client.js', client, "'-webkit-mask-image:linear-gradient(90deg,rgba(0,0,0,0) 0,#000 9%,#000 91%,rgba(0,0,0,0) 100%);'")
// 材质: 上沿内高光 / 顶部径向柔光 / 噪点 (mask 会裁掉外投影, 所以不再写外发光)
expect('client.js', client, 'box-shadow:inset 0 1px 0 rgba(255,255,255,.24);')
expect('client.js', client, "'#lwp-rec::before{content:\"\";position:absolute;left:-10%;right:-10%;top:-40%;height:86%;'")
expect('client.js', client, 'radial-gradient(62% 52% at 50% 40%,rgba(255,255,255,.14)')
expect('client.js', client, "'#lwp-rec::after{content:\"\";position:absolute;inset:0;pointer-events:none;opacity:.035;'")
// 转写中三点接管波形那一行的空间 (`flex:1` 只在 busy 时给, 平时不占位)
expect('client.js', client, "'#lwp-rec[data-busy=\"on\"] .lwp-rec-dots{flex:1;height:auto;opacity:1}'")
// 三态各自像"那一件事": 取消下沉变中性色 / 转写三点 / 录制呼吸点
expect('client.js', client, "'#lwp-rec[data-cancel=\"on\"]{transform:translateY(8px) scale(.988);'")
expect('client.js', client, 'background:linear-gradient(180deg,#8b93a3 0%,#6f7686 54%,#5d6472 100%)')
expect('client.js', client, "@keyframes lwp-rec-breath{0%,100%{opacity:.55;box-shadow:0 0 0 3px rgba(255,93,93,.16)}")
expect('client.js', client, "@keyframes lwp-rec-bounce{0%,80%,100%{transform:translateY(0);opacity:.5}")
expect('client.js', client, "'@media (prefers-reduced-motion:reduce){'")
// 计时是胶囊, 现在跟提示同一行 (矮条里没有第二个绝对定位的地方)
expect('client.js', client, "'.lwp-rec-time{flex:none;padding:2px 9px;border-radius:999px;")
// 帧循环的起手位置 (2026-11-20 真因): 必须排在 `voiceState = 'recording'` 之后, 且 `showRecPanel` 里不许起帧
expect('client.js', client, 'function startRecPump')
expectOrder('录音帧循环在 recording 之后才起', client, "voiceState = 'recording'", '\n          startRecPump()')
if (!client.includes('46vh')) notes.push('ok   录音条不再是 46vh 的大面板')
else failures.push('client.js: 录音条还写着 46vh —— 面积应当是输入框的 1.5 倍')

// 反向: 上一版那套"假波形"与发灰的取消态不许回来
for (const gone of ['Math.sin((Math.PI * i)', 'filter:saturate(.7)', 'recBars', 'pushRecBar']) {
  if (!client.includes(gone)) notes.push(`ok   旧的粗糙做法已经撤掉 (${gone})`)
  else failures.push(`client.js: 还留着 ${JSON.stringify(gone)} —— 波形是走带 + 归一化了, 不再用固定正弦包络`)
}

// 真跑四个波形纯函数: 几何 / 归一化 / 峰值保持 / 雷达压缩
const recConstNames = ['REC_BAR_W', 'REC_BAR_GAP', 'REC_BAR_R', 'REC_BAR_MIN', 'REC_SILENT', 'REC_HOLD_DECAY']
const recConsts = recConstNames
  .map((name) => new RegExp(`var ${name} = ([-0-9.]+)`, 'u').exec(client))
  .map((hit, index) => (hit ? `var ${recConstNames[index]} = ${hit[1]};` : ''))
  .join('\n')
const recFns = ['recLevelOf', 'recNextHold', 'recNormalise', 'recWaveRects'].map(takeModuleFunction)
if (recFns.some((source) => source === '')) {
  failures.push('client.js: 抽不出波形那四个纯函数 (名字或缩进改过?)')
} else {
  const wave = new Function(`${recConsts}\n${recFns.join('\n')}
return { recLevelOf, recNextHold, recNormalise, recWaveRects }`)()
  if (Math.abs(wave.recLevelOf(0.01) - 0.06) < 1e-9 && wave.recLevelOf(0.9) === 1) {
    notes.push('ok   recLevelOf: 对数感压缩且夹到 1')
  } else {
    failures.push('recLevelOf: 压缩曲线不对')
  }
  const quiet = wave.recNormalise(0.05, 0.5)
  if (wave.recNormalise(0.005, 0.5) === 0 && wave.recNormalise(0.5, 0.5) === 1 && quiet > 0.2) {
    notes.push(`ok   recNormalise: 静音归零, 满幅到 1, 小声 (0.05/0.5) 也有 ${quiet.toFixed(3)}`)
  } else {
    failures.push(`recNormalise: 归一化不对 (quiet=${String(quiet)})`)
  }
  const decayed = wave.recNextHold(0.4, 0.2)
  const raised = wave.recNextHold(0.2, 0.9)
  if (decayed < 0.4 && decayed > 0.39 && raised === 0.9) {
    notes.push('ok   recNextHold: 新的高就抬, 否则按 0.995 落')
  } else {
    failures.push(`recNextHold: 峰值保持不对 (${String(decayed)} / ${String(raised)})`)
  }
  const flat = wave.recWaveRects([], 100, 96)
  const bars = wave.recNormalise ? wave.recWaveRects([0, 0.5, 1], 100, 96) : []
  const tail = bars[bars.length - 1]
  const middle = bars[bars.length - 2]
  if (flat.length === 33 && flat.every((rect) => rect.h === 2)
    && tail.h === 88 && tail.x === 97 && Math.abs((tail.y + tail.h / 2) - 48) < 1e-9
    && middle.h === 44) {
    notes.push('ok   recWaveRects: 走带右对齐 / 2px 点 / 镜像中线 / 高按电平')
  } else {
    failures.push(`recWaveRects: 几何不对 (${JSON.stringify({ n: flat.length, tail, middle })})`)
  }
  // 走带: 历史超过窗宽时, 左边最先被丢掉 (新的贴右)
  const long = new Array(40).fill(0).map((_, index) => (index === 0 ? 1 : 0.2))
  const scrolled = wave.recWaveRects(long, 100, 96)
  if (scrolled[0].h === wave.recWaveRects(long.slice(7), 100, 96)[0].h) {
    notes.push('ok   recWaveRects: 超过窗宽从左边丢 (走带语义)')
  } else {
    failures.push('recWaveRects: 走带没有从左边丢')
  }
}
const portalVoice = read('app/src/main/java/io/github/yuloong07star/luwi/ui/PortalVoice.kt')
expect(
  'PortalVoice.kt 收一段录音并回推',
  portalVoice,
  'fun transcribe(context: Context, id: Int, data: String, language: String, done: (JSONObject) -> Unit): JSONObject',
)
expect('PortalVoice.kt 转写走 LwSpeech', portalVoice, 'LwSpeech.dispatch(')
expect('PortalVoice.kt 作废在途那一趟', portalVoice, 'fun cancel()')
expect('PortalBridge.kt 那座桥', portalBridge, 'fun portalVoice(payload: String): String')
expect('PortalBridge.kt 交给 PortalVoice', portalBridge, 'PortalVoice.transcribe(')
expect('PortalBridge.kt 回推页面的那一句', portalBridge, 'window.__LUWI_PORTAL__.voice(')
expect('HostScreen 弹麦克风授权窗', hostScreen, 'ActivityResultContracts.RequestPermission()')
expect('HostScreen 弹的是 RECORD_AUDIO', hostScreen, 'micPermission.launch(Manifest.permission.RECORD_AUDIO)')
// 语音输出那颗喇叭: 翻的是 设置 → 说话 里同一个开关 (一处状态两处界面)
expect('PortalBridge.kt 那座喇叭桥', portalBridge, 'fun portalSpeak(payload: String): String')
expect('PortalBridge.kt 翻的是朗读开关', portalBridge, 'SpeakSettings.setReadAloud(context, !SpeakSettings.readAloud)')
expect('PortalBridge.kt 回执带 readAloud', portalBridge, 'put("readAloud", SpeakSettings.readAloud)')

// 同一个上限: 页面的 60 s 与宿主的 `MAX_SECONDS`
const jsVoiceMax = /var VOICE_MAX_MS = (\d+) \* 1000/u.exec(client)?.[1] ?? ''
const hostVoiceMax = /const val MAX_SECONDS = (\d+)/u.exec(portalVoice)?.[1] ?? ''
if (jsVoiceMax !== '' && jsVoiceMax === hostVoiceMax) {
  notes.push(`ok   语音上限两侧同一个数 (${hostVoiceMax} s)`)
} else {
  failures.push(`语音上限对不上: 页面=${jsVoiceMax || '?'}s 宿主=${hostVoiceMax || '?'}s`)
}

// wavOf 真跑: 头 44 字节 / 16 kHz / 单声道 / 16 位, 采样数与重采样都对
const wavOfSource = takeModuleFunction('wavOf')
if (wavOfSource === '') {
  failures.push('client.js: 抽不出 wavOf (名字或缩进改过?)')
} else {
  const wavOf = new Function(`${wavOfSource}\nreturn wavOf`)()
  const view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const empty = wavOf([], 16000)
  if (empty.length === 44) notes.push('ok   wavOf: 没有采样时只有 44 字节头')
  else failures.push(`wavOf: 空输入应当只有头 (拿到 ${String(empty.length)} 字节)`)

  const samples = new Float32Array(1600)
  samples[0] = 2
  samples[1] = -2
  const one = wavOf([samples], 16000)
  const head = (offset, length) => Array.from(one.slice(offset, offset + length))
    .map((byte) => String.fromCharCode(byte)).join('')
  const headView = view(one)
  if (one.length === 44 + 1600 * 2 && head(0, 4) === 'RIFF' && head(8, 4) === 'WAVE' && head(36, 4) === 'data') {
    notes.push('ok   wavOf: RIFF/WAVE/data 三处头对得上, 采样数 = 输入长度')
  } else {
    failures.push('wavOf: 头或者长度不对 (16 kHz 单声道 PCM16 应当是 44 + 2 × 采样数)')
  }
  if (headView.getUint32(24, true) === 16000 && headView.getUint16(22, true) === 1
    && headView.getUint16(34, true) === 16 && headView.getUint32(40, true) === 1600 * 2) {
    notes.push('ok   wavOf: 采样率 16 kHz / 单声道 / 16 位 / data 长度都对')
  } else {
    failures.push('wavOf: 采样率 / 声道 / 位深 / data 长度有一处不对')
  }
  // 超范围的两端要夹到 16 位整数里 (2 → 32767, -2 → -32767)
  if (headView.getInt16(44, true) === 32767 && headView.getInt16(46, true) === -32767) {
    notes.push('ok   wavOf: 超范围的采样被夹在 16 位整数里')
  } else {
    failures.push(`wavOf: 削顶没做 (${String(headView.getInt16(44, true))} / ${String(headView.getInt16(46, true))})`)
  }
  // 48 kHz 的流要降到 16 kHz: 48000 个采样 → 16000 个
  const wide = new Float32Array(48000)
  const narrowed = wavOf([wide], 48000)
  if (narrowed.length === 44 + 16000 * 2) notes.push('ok   wavOf: 48 kHz 降到 16 kHz (样本数三等分)')
  else failures.push(`wavOf: 48 kHz 那一路没降采样 (${String(narrowed.length)} 字节)`)
}

// 面板上那两句提示: 默认与上滑后各一句 (图里是"松手发送", 这一层松手是进草稿, 所以照实写)
//
// 上一版这里跑的是"按住 说话"那颗大钮的三态文案 (`voiceLabel`); 长按改成当场开录之后那颗钮没有了,
// 判据跟着搬到这里 —— 钉的是同一件事: 面板上永远有一句说清"现在松手会怎样"
const recHints = /var REC_HINT = '([^']+)'[\s\S]*?var REC_HINT_CANCEL = '([^']+)'/u.exec(client)
if (recHints !== null && recHints[1] === '松手转写，上滑取消' && recHints[2] === '松开取消') {
  notes.push('ok   录音面板的两句提示: 默认「松手转写, 上滑取消」/ 上滑后「松开取消」')
} else {
  failures.push(`录音面板的提示不对: ${JSON.stringify(recHints?.slice(1) ?? null)}`)
}

// ④ 「同步」→「终端」: 两份 strings 里两个字面量都换了, 技术提法没被误伤
// (stringsZh / stringsEn 在本文件前面就读过了: 一份文件只读一次)
const zhMenu = /<string name="menu_sync">([^<]*)<\/string>/u.exec(stringsZh)?.[1] ?? ''
const enMenu = /<string name="menu_sync">([^<]*)<\/string>/u.exec(stringsEn)?.[1] ?? ''
const zhSection = /<string name="settings_section_sync">([^<]*)<\/string>/u.exec(stringsZh)?.[1] ?? ''
const enSection = /<string name="settings_section_sync">([^<]*)<\/string>/u.exec(stringsEn)?.[1] ?? ''
if (zhMenu === '终端' && zhSection === '终端') notes.push('ok   zh: 球菜单那一行与设置段名都叫「终端」')
else failures.push(`zh 里还叫「${zhMenu}」/「${zhSection}」(应当是「终端」)`)
if (enMenu === 'Terminal' && enSection === 'Terminal') notes.push('ok   en: 同一个名字是 Terminal')
else failures.push(`en 里还叫「${enMenu}」/「${enSection}」`)
// 电脑上那个插件与那份基线仍按技术名叫「同步」—— 改名不误伤它们
if (stringsZh.includes('<string name="settings_sync_plugin">电脑上的同步插件</string>')) {
  notes.push('ok   「电脑上的同步插件」保留原名 (那是插件本身, 不是这个入口)')
} else {
  failures.push('zh: 「电脑上的同步插件」被一起改了名 —— 那说的是插件, 不是入口')
}
if (stringsZh.includes('session-sync.json') && stringsZh.includes('luwi-sync://')) {
  notes.push('ok   文件名与配对前缀一个字没动')
} else {
  failures.push('zh: session-sync.json / luwi-sync:// 被改掉了 (那是磁盘与协议上的名字)')
}

// ── 二十五、门户换的模型 = 新会话的模型 (2026-11-20) ──────────────────────────
//
// 主人: "我在门户里改的模型要作为默认模型, 新开会话都要用门户中设置的模型"。dsh 那条 `selectModel`
// 会把选择同时落成宿主默认, 但新对话复用的是**工作区里那张空白场**, 它早先记过的 `model/selection`
// 会把新会话按老模型发出去 —— 而且门户 chip 取的 `projected.next ?? catalog.default` 也停在旧值。
// 这里钉三件: ① 那条判定的纯函数真跑 ② `loadModel` 落地之后真的会去问宿主默认 ③ 非空白场一次都不拨

const blankModelSource = takeFunction('blankModelNeedsDefault')
const modelFollowSource = takeFunction('followDefaultModel')
if (blankModelSource === '' || modelFollowSource === '') {
  failures.push('client.js: 抽不出 blankModelNeedsDefault / followDefaultModel (空白场跟默认那条链断了)')
} else {
  const needs = new Function(`${blankModelSource}\nreturn blankModelNeedsDefault`)()
  const selected = { provider: 'tokenhub', model: 'hy4-flash', reasoningEffort: 'high' }
  const other = { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'low' }
  const cases = [
    ['空白场 + 默认不同 → 拨', needs(selected, other, true), true],
    ['空白场 + 默认相同 → 不拨', needs(selected, { ...selected }, true), false],
    ['非空白场 + 默认不同 → 不拨', needs(selected, other, false), false],
    ['空白场 + 这一场没有选择 → 不拨', needs(null, other, true), false],
    ['空白场 + 拿不到默认 → 不拨', needs(selected, null, true), false],
    ['空白场 + 只差推理档 → 拨', needs({ ...selected, reasoningEffort: 'low' }, selected, true), true],
    ['空白场 + 默认没有推理档 → 拨', needs(selected, { provider: 'tokenhub', model: 'hy4-flash' }, true), true],
    ['空白场 + blank 不是 true → 不拨', needs(selected, other, undefined), false],
  ]
  for (const [label, got, want] of cases) {
    if (got === want) notes.push(`ok   blankModelNeedsDefault: ${label}`)
    else failures.push(`blankModelNeedsDefault: ${label} —— 得到 ${String(got)}`)
  }

  if (modelFollowSource.includes('modelCatalog') && modelFollowSource.includes('.select(')) {
    notes.push('ok   空白场那条链: 问 remote.session.modelCatalog() 拿默认, 与这一场的 current 比过再 select')
  } else {
    failures.push('client.js: followDefaultModel 里没有"问 modelCatalog + select"那条链')
  }
  if (modelFollowSource.includes('summary.blank !== true) return')) {
    notes.push('ok   非空白场在那条链的第一道闸就被挡下 (那一场自己的选择不动)')
  } else {
    failures.push('client.js: followDefaultModel 没有按 blank 挡下非空白场')
  }
  const modelLoadSource = takeFunction('loadModel')
  if (modelLoadSource.includes('followDefaultModel()')) {
    notes.push('ok   loadModel 落地之后会判一次"空白场要不要跟默认" (换场 / 新建都走到)')
  } else {
    failures.push('client.js: loadModel 没有接 followDefaultModel (换场之后不会拨默认)')
  }
  const modelPickSource = takeFunction('pickModel')
  if (modelPickSource.includes('modelDirectory.select') && modelLoadSource.includes('watchModelDirectory')) {
    notes.push('ok   模型 chip: 换模型走 directory.select, chip 名字跟目录的 store 走')
  } else {
    failures.push('client.js: 模型 chip 那两条 (select / 目录订阅) 少了一条')
  }
  // 换场必须把"这一档问过没有"作废: 否则默认在别处改过之后, 再回到这张空白场永远不会再问一次
  const adoptSource = takeFunction('adopt')
  if (adoptSource.includes("modelDefaultChecked = ''")) {
    notes.push('ok   换场会把"这一档问过没有"作废 (默认在别处改过还会再问一次)')
  } else {
    failures.push('client.js: 换场没清 modelDefaultChecked —— 默认改了也不会再问')
  }
  if (modelFollowSource.includes("[luwi-portal] model default unavailable")) {
    notes.push('ok   拿不到宿主默认时留一句日志 (不静默)')
  } else {
    failures.push('client.js: 拿不到宿主默认那条路静默收手了 (日志里查不到原因)')
  }
}

// ── 二十六、后台 dsh 发的图在门户上也画真图 (2026-11-20) ──────────────────────
//
// 主人: "这个在后台dsh内发送的图要求也要在门户上显示"。后台发的图不经门户 `lw-in` 那条 stash,
// 落盘只剩 `{type:'image', attachment:{attachmentId,…}}`; 门户要拿 `uiConversation.imageUrl` 取回
// 那张 blob URL 再画, 取不到才留「图没取到」/「（图）」—— 不许静默, 也不许假装贴过

const refsSource = takeFunction('imageAttachmentsOf')
const bubbleSource = takeFunction('durableImageBubble')
if (refsSource === '' || bubbleSource === '') {
  failures.push('client.js: 抽不出 imageAttachmentsOf / durableImageBubble (附件图那条链断了)')
} else {
  const refsOf = new Function(`${refsSource}\nreturn imageAttachmentsOf`)()
  const real = refsOf([
    { type: 'image', attachment: { attachmentId: 'sha256:aa', mediaType: 'image/png', width: 10, height: 20, bytes: 99, name: 'a.png' } },
    { type: 'text', text: '看图' },
  ])
  const unnamed = refsOf([{ type: 'image', attachment: { attachmentId: 'sha256:bb' } }])
  const refsCases = [
    ['图块 → 一条引用 (宽高/名字都带上)', real.length === 1 && real[0].attachmentId === 'sha256:aa'
      && real[0].width === 10 && real[0].height === 20 && real[0].name === 'a.png'],
    ['没有 attachmentId 的图块 → 不认 (交给「（图）」兜底)', refsOf([{ type: 'image' }]).length === 0],
    ['只有 attachmentId → 也认 (宽高缺就是 0)', unnamed.length === 1 && unnamed[0].width === 0 && unnamed[0].name === ''],
    ['文本块 → 不算图', refsOf([{ type: 'text', text: 'x' }]).length === 0],
    ['不是数组 → 空表', refsOf(null).length === 0],
  ]
  for (const [label, ok] of refsCases) {
    if (ok) notes.push(`ok   imageAttachmentsOf: ${label}`)
    else failures.push(`imageAttachmentsOf: ${label} 不成立`)
  }

  for (const [label, needle] of [
    ['尺寸从 attachment.width/height 钉住比例', 'aspectRatio'],
    ['取不到写「图没取到」', "'图没取到'"],
    ['有一档 blob URL 的预览 (点一下进预览窗)', 'openPreview({ src: url'],
  ]) {
    if (bubbleSource.includes(needle)) notes.push(`ok   durableImageBubble: ${label}`)
    else failures.push(`durableImageBubble: ${label} 那一段没了 (找 ${needle})`)
  }
  // 取图那两条各自在 helper 里: `imageUrl` 读字节生成 blob URL, `peekImageUrl` 命中就不必等
  const peekSource = takeFunction('peekDurableImage')
  const loadImageSource = takeFunction('loadDurableImage')
  if (peekSource.includes('peekImageUrl(sessionId, ref)') && loadImageSource.includes('imageUrl(sessionId, ref)')) {
    notes.push('ok   durableImageBubble: 先问 peekImageUrl, 再走 uiConversation.imageUrl')
  } else {
    failures.push('client.js: 附件图没有先问 peekImageUrl / 没走 uiConversation.imageUrl')
  }

  const rowSource = takeFunction('buildRow')
  if (rowSource.includes('durableImageBubble(') && rowSource.includes('item.images')) {
    notes.push('ok   buildRow: user 那一行有图引用就画真图')
  } else {
    failures.push('client.js: buildRow 的 user 分支没有接 durableImageBubble')
  }
  if (rowSource.includes('MAX_DURABLE_IMAGES') && rowSource.includes("'+' + String(refs.length - shownRefs)")) {
    notes.push('ok   一条消息里最多画 4 张, 多出来的写「+N 张图」')
  } else {
    failures.push('client.js: 单条多图那道上限 / 「+N 张图」没了')
  }
  if (rowSource.includes('!drew && item.hasImage')) {
    notes.push('ok   「（图）」只在一条引用都没有的旧消息上留 (有引用就不该再画占位)')
  } else {
    failures.push('client.js: 「（图）」兜底那条闸不见了 / 改成无条件画了')
  }
  const keySource = takeFunction('itemKey')
  if (keySource.includes('item.images')) {
    notes.push('ok   itemKey: attachmentId 进了身份 (图块补上那一拍这一行才重建)')
  } else {
    failures.push('client.js: itemKey 没带图引用 —— 图补上时那一行不会重建')
  }
  const previewSource = takeFunction('openPreview')
  if (previewSource.includes('file.src')) {
    notes.push('ok   openPreview: 多一档 `src` (附件图那张 blob URL 直接进预览窗)')
  } else {
    failures.push('client.js: openPreview 没有 `src` 那一档 (点附件图打不开)')
  }
}

// ── 二十七、终端那一页 (2026-11-21, 落实表 #48) ───────────────────────────────
//
// 四条验收全在这里: ① 纯函数真跑 (影子根判据 / 电脑那几场 / 弹窗四档) ② 两端历史互不串
// ③ 页面那几个入口与皮肤都在 ④ 原生那一半 (黑底 / 扫码 / 返回键 / 推终端)
{
  const note = (text) => notes.push(`ok   ${text}`)
  const fail = (text) => failures.push(text)

  // ① 纯函数: 抽出来真跑 (与 historyRows 同一套 takeFunction)
  const normalizeCwdPath = new Function(`${takeFunction('normalizeCwdPath')}\nreturn normalizeCwdPath`)()
  const underShadow = new Function(
    'normalizeCwdPath',
    `${takeFunction('underShadow')}\nreturn underShadow`,
  )(normalizeCwdPath)
  const historyRows = new Function(
    'underShadow',
    `${takeFunction('historyRows')}\nreturn historyRows`,
  )(underShadow)
  const terminalRows = new Function(
    'historyRows',
    'TERMINAL_HISTORY_MAX',
    'normalizeCwdPath',
    `${takeFunction('terminalRows')}\nreturn terminalRows`,
  )(historyRows, 20, normalizeCwdPath)
  // 2026-11-21 补: 进终端落「1h 内最近那一场」, 没有就新建; 退出回进门户那一场
  const terminalRecentRow = new Function(
    `${takeFunction('terminalRecentRow')}\nreturn terminalRecentRow`,
  )()
  const terminalReturnOf = new Function(
    'underShadow',
    `${takeFunction('terminalReturnOf')}\nreturn terminalReturnOf`,
  )(underShadow)
  const terminalReturnFor = new Function(
    `${takeFunction('terminalReturnFor')}\nreturn terminalReturnFor`,
  )()
  const terminalLanded = new Function(
    `${takeFunction('terminalLanded')}\nreturn terminalLanded`,
  )()
  const terminalGateState = new Function(
    `${takeFunction('terminalGateState')}\nreturn terminalGateState`,
  )()

  const shadowRoot = '/data/user/0/app/files/dsh-home/lw/peer-workspaces'
  const peerSnapshot = {
    byId: {
      s_local: { id: 's_local', displayTitle: '本机的', updatedAt: 30, blank: false, cwd: '/sdcard/DSH/Luwi' },
      s_pc1: { id: 's_pc1', displayTitle: '电脑-1', updatedAt: 50, blank: false, cwd: `${shadowRoot}/PC/DSH` },
      // 同一个根的另一种写法 (/data/data): 归一之后必须认出来
      s_pc2: { id: 's_pc2', displayTitle: '电脑-2', updatedAt: 40, blank: false, cwd: '/data/data/app/files/dsh-home/lw/peer-workspaces/PC/DSH2' },
      s_pc_blank: { id: 's_pc_blank', displayTitle: '', updatedAt: 60, blank: true, cwd: `${shadowRoot}/PC/x` },
      s_prefix: { id: 's_prefix', displayTitle: '前缀陷阱', updatedAt: 70, blank: false, cwd: `${shadowRoot}x/PC` },
    },
  }

  if (underShadow(`${shadowRoot}/PC/DSH`, shadowRoot) === true
    && underShadow('/data/data/app/files/dsh-home/lw/peer-workspaces/PC', '/data/user/0/app/files/dsh-home/lw/peer-workspaces') === true
    && underShadow(`${shadowRoot}x/PC`, shadowRoot) === false
    && underShadow('', shadowRoot) === false
    && underShadow('/sdcard/DSH/Luwi', '') === false) {
    note('underShadow: 影子根底下算电脑那几场 (两种 /data 写法都认), 前缀相似的目录与空根都不算')
  } else {
    fail('underShadow 判错了: 影子根 / 数据目录两种写法 / 前缀陷阱 / 空根')
  }

  const terminalIds = terminalRows(peerSnapshot, '', null, shadowRoot, 20).map((row) => row.id)
  if (JSON.stringify(terminalIds) === JSON.stringify(['s_pc1', 's_pc2'])) {
    note('terminalRows: 只留电脑那几场, 新到旧, 空白场不进 (最近那些)')
  } else {
    fail(`terminalRows 挑错了: ${JSON.stringify(terminalIds)}`)
  }
  if (terminalRows(peerSnapshot, '', null, shadowRoot, 1).length === 1
    && terminalRows(peerSnapshot, '', null, '', 20).length === 0) {
    note('terminalRows: 上限生效; 没有影子根时一场都不认 (不假装连上了)')
  } else {
    fail('terminalRows: 上限或空根那一档不对')
  }

  const allIds = historyRows(peerSnapshot, '', null, { mode: 'all', shadowRoot }).map((row) => row.id)
  const onlyPeer = historyRows(peerSnapshot, '', null, { mode: 'terminal', shadowRoot }).map((row) => row.id)
  const unfiltered = historyRows(peerSnapshot, '', null).map((row) => row.id)
  if (!allIds.includes('s_pc1') && !allIds.includes('s_pc2') && allIds.includes('s_local')) {
    note('historyRows(all): 普通历史里看不到电脑那几场 (互不串的一半)')
  } else {
    fail(`historyRows(all) 把电脑那几场也列了: ${JSON.stringify(allIds)}`)
  }
  if (JSON.stringify(onlyPeer) === JSON.stringify(['s_pc1', 's_pc2'])) {
    note('historyRows(terminal): 终端里只列电脑那几场 (互不串的另一半)')
  } else {
    fail(`historyRows(terminal) 混进了本机场: ${JSON.stringify(onlyPeer)}`)
  }
  if (unfiltered.length === 4) {
    note('historyRows: 没给影子根时不做任何过滤 (老调用方一个字节不变)')
  } else {
    fail(`historyRows 三参调用被过滤了: ${JSON.stringify(unfiltered)}`)
  }

  const unpaired = terminalGateState(null, { ok: false, busy: false, why: '', at: 0 })
  const off = terminalGateState({ paired: true, syncOn: false, terminalReady: true }, { ok: false, busy: false, why: '', at: 0 })
  const legacy = terminalGateState({ paired: true, syncOn: true, terminalReady: false }, { ok: false, busy: false, why: '', at: 0 })
  const probing = terminalGateState({ paired: true, syncOn: true, terminalReady: true }, { ok: false, busy: true, why: '', at: 0 })
  const offline = terminalGateState({ paired: true, syncOn: true, terminalReady: true }, { ok: false, busy: false, why: '网络不通', at: 1 })
  const online = terminalGateState({ paired: true, syncOn: true, terminalReady: true }, { ok: true, busy: false, why: '', at: 2 })
  if (unpaired.state === 'unpaired' && off.state === 'off' && legacy.state === 'offline'
    && probing.state === 'probing' && offline.state === 'offline' && online.state === '') {
    note('terminalGateState: 六档分开 (没配对 / 终端关着 / 配对码没配好 / 探测中 / 连不上 / 在线不弹)')
  } else {
    fail(`terminalGateState 分档不对: ${JSON.stringify([unpaired.state, off.state, legacy.state, probing.state, offline.state, online.state])}`)
  }
  if (offline.note.includes('网络不通') && unpaired.body.includes('配对码')) {
    note('terminalGateState: 每一档都给一句能照着做的人话 (原因也带出来)')
  } else {
    fail('terminalGateState: 那一句人话没给 / 原因没带出来')
  }
  // 2026-11-22 (主人: "在没有配对时扫码配对下加一个「去给PC装luwi终端」"): 那颗钮只在没配对那一档出现
  if (unpaired.install === true && off.install === false && offline.install === false && online.install === false) {
    note('terminalGateState: 「去给 PC 装 luwi终端」只在没配对那一档出现')
  } else {
    fail(`terminalGateState: install 那一格不对: ${JSON.stringify([unpaired.install, off.install, offline.install, online.install])}`)
  }

  // ①b 进终端落哪一场 (2026-11-21): 1 小时窗口真跑一遍真值表
  const nowAt = 1_700_000_000_000
  const minute = 60 * 1000
  const hour = 60 * minute
  const recentRowOf = (list, window = hour) => terminalRecentRow(list, nowAt, window)
  const fresh = recentRowOf([{ id: 'fresh', at: nowAt - 59 * minute }])
  const stale = recentRowOf([{ id: 'stale', at: nowAt - 61 * minute }])
  if (fresh && fresh.id === 'fresh') {
    note('terminalRecentRow: 59 分钟前那一场算"最近"')
  } else {
    fail('terminalRecentRow: 窗口里的那一场没被选中')
  }
  if (stale === null) {
    note('terminalRecentRow: 61 分钟前的不算 (过了 1 小时就新建)')
  } else {
    fail('terminalRecentRow: 窗口外的那一场还是被拉起来了')
  }
  const mixed = recentRowOf([
    { id: 'oldest', at: nowAt - 61 * minute },
    { id: 'middle', at: nowAt - 50 * minute },
    { id: 'newest', at: nowAt - 30 * minute },
  ])
  // 反过来再排一次: 只认"时间最大"的实现两趟都过, "取第一条 / 取最后一条"各会在其中一趟翻车
  const mixedFlipped = recentRowOf([
    { id: 'oldest', at: nowAt - 61 * minute },
    { id: 'newest', at: nowAt - 30 * minute },
    { id: 'middle', at: nowAt - 50 * minute },
  ])
  if (mixed && mixed.id === 'newest' && mixedFlipped && mixedFlipped.id === 'newest') {
    note('terminalRecentRow: 混排时取时间最大的那个 (两种排法都不认数组顺序)')
  } else {
    fail(`terminalRecentRow: 没取到最近那一场 (认数组顺序了: ${JSON.stringify([mixed && mixed.id, mixedFlipped && mixedFlipped.id])})`)
  }
  const exact = recentRowOf([{ id: 'exact', at: nowAt - hour }])
  const oneMsLate = recentRowOf([{ id: 'late', at: nowAt - hour - 1 }])
  if (exact && exact.id === 'exact' && oneMsLate === null) {
    note('terminalRecentRow: 恰好 1 小时算在里面, 多 1 ms 就不算')
  } else {
    fail('terminalRecentRow: 1 小时那条边界不对')
  }
  if (recentRowOf([{ id: 'unknown', at: 0 }]) === null
    && recentRowOf([]) === null
    && recentRowOf(null) === null
    && terminalRecentRow([{ id: 'x', at: nowAt }], nowAt, 0) === null
    && terminalRecentRow([{ id: 'x', at: nowAt }], nowAt, Number.NaN) === null
    && terminalRecentRow([{ id: 'x', at: nowAt }], 0, hour) === null) {
    note('terminalRecentRow: 没时间 / 空表 / 窗口无效 / 现在读不到, 一律不当"最近"')
  } else {
    fail('terminalRecentRow: 空表或无效参数那一档没兜住')
  }

  const returnSnapshot = {
    byId: {
      s_local: { id: 's_local', cwd: '/sdcard/DSH/Luwi' },
      s_pc1: { id: 's_pc1', cwd: `${shadowRoot}/PC/DSH` },
    },
  }
  const keptLocal = terminalReturnOf({ on: true, back: { id: 's_local' } }, returnSnapshot, shadowRoot)
  const keptPeer = terminalReturnOf({ on: true, back: { id: 's_pc1' } }, returnSnapshot, shadowRoot)
  const keptGone = terminalReturnOf({ on: true, back: { id: 's_gone' } }, returnSnapshot, shadowRoot)
  if (keptLocal !== null && keptLocal.id === 's_local') {
    note('terminalReturnOf: 门户那一场照认 (重载之后还回得去)')
  } else {
    fail('terminalReturnOf: 门户那一场没认出来')
  }
  if (keptPeer === null) {
    note('terminalReturnOf: 记成电脑那一场的不认 (老记录里可能就是这个)')
  } else {
    fail('terminalReturnOf: 电脑那一场被当成返回点了')
  }
  if (keptGone !== null && keptGone.id === 's_gone') {
    note('terminalReturnOf: 快照里还没加载到的那一场先信任 (与 restore 同一套宽松口径)')
  } else {
    fail('terminalReturnOf: 快照里没有就不认了 —— 重载那一拍会把返回点丢掉')
  }
  if (terminalReturnOf({ on: true }, returnSnapshot, shadowRoot) === null
    && terminalReturnOf({ on: false, back: { id: 's_local' } }, returnSnapshot, shadowRoot) === null
    && terminalReturnOf(null, returnSnapshot, shadowRoot) === null
    && terminalReturnOf({ on: true, back: { id: '' } }, returnSnapshot, shadowRoot) === null) {
    note('terminalReturnOf: 没记过 / 终端已关 / 空 id 都不认 (老记录是 `{on:true}` 也照样退回当前这一场)')
  } else {
    fail('terminalReturnOf: 没记过或空 id 那一档不对')
  }

  // 记返回点那一侧: **电脑那一场永远不许被记成返回点** (记上了"返回"就等于没退)
  const returnLocal = terminalReturnFor('s_local', '', false, false)
  const returnPeer = terminalReturnFor('s_pc1', 's_local', true, false)
  const returnPeerOnly = terminalReturnFor('s_pc1', 's_pc1', true, true)
  const returnNull = terminalReturnFor(null, '', false, false)
  if (returnLocal.id === 's_local') {
    note('terminalReturnFor: 屏上不是电脑那一场就记它')
  } else {
    fail(`terminalReturnFor: 门户那一场没记上 (${JSON.stringify(returnLocal)})`)
  }
  if (returnPeer.id === 's_local') {
    note('terminalReturnFor: 屏上就是电脑那一场时退门户自己记着的那一场')
  } else {
    fail(`terminalReturnFor: 屏上是电脑那一场还是记了错的返回点 (${JSON.stringify(returnPeer)})`)
  }
  if (returnPeerOnly.id === '') {
    note('terminalReturnFor: 记忆里也是电脑那一场 / 什么都没记 → 空串 (由 terminalRestore 回默认工作区)')
  } else {
    fail(`terminalReturnFor: 两边都是电脑场时没退回空串 (${JSON.stringify(returnPeerOnly)})`)
  }
  if (returnNull.id === '') {
    note('terminalReturnFor: 屏上还没有任何一场时记空串 (不是 null)')
  } else {
    fail(`terminalReturnFor: 空屏没退货 ${JSON.stringify(returnNull)}`)
  }

  // 落地判据: 只看 `switchTo` 的返回值不够 (那只是"画得上", mainView 可能还在电脑那一场)
  if (terminalLanded(true, 's_local', 's_local', false) === true
    && terminalLanded(true, 's_pc1', 's_local', true) === false
    && terminalLanded(false, 's_local', 's_local', false) === false
    && terminalLanded(true, null, 's_local', false) === true) {
    note('terminalLanded: 要"画上了 且 mainView 不在电脑那一场" (main 读不到时按真算)')
  } else {
    fail('terminalLanded: 判据不对 —— 光看"画得上"会让门户停在电脑那一场')
  }

  // ② 页面: 皮肤 / 两扇历史 / 身份 / 新建 / 发送闸
  expect('client.js', client, '#lwp-root[data-mode="terminal"]{background:#000}')
  expect('client.js', client, "els.termGate.id = 'lwp-term-gate'")
  expect('client.js', client, "els.termPair = h('button', null, '扫码配对')")
  expect('client.js', client, "els.termExit = h('button', null, '返回')")
  // 2026-11-22: 卡片那张黑幕**不许吃掉卡片外的点击** —— 终端的出口是头栏那颗「对话」,
  // 少了 `pointer-events:none` 真机上点它纹丝不动 (卡片自己再收回可点)
  expect('client.js', client, 'background:rgba(0,0,0,.72);pointer-events:none}')
  expect('client.js', client, '.lwp-term-card{width:100%;max-width:360px;border-radius:20px;padding:20px 18px 16px;')
  expect('client.js', client, 'color:#e8e8e8;pointer-events:auto;')
  expect('client.js', client, "els.termPair.onclick = function () { call('portalTerminalPair') }")
  // 2026-11-22 (主人: "在没有配对时扫码配对下加一个「去给PC装luwi终端」")
  expect('client.js', client, "els.termInstall = h('button', null, '去给 PC 装 luwi终端')")
  expect('client.js', client, "els.termInstall.onclick = function () { call('portalTerminalInstall') }")
  expect('client.js', client, 'if (els.termInstall) els.termInstall.hidden = said.install !== true')
  expect('client.js', client, "call('portalTerminalVisible', true)")
  expect('client.js', client, "call('portalTerminalVisible', false)")
  expect('client.js', client, 'function applyTerminalMode')
  expect('client.js', client, 'root.setAttribute(\'data-mode\', \'terminal\')')
  expect('client.js', client, 'if (terminalMode) {')
  expect('client.js', client, 'name = TERMINAL_TITLE')
  expect('client.js', client, "var TERMINAL_TITLE = 'luwi终端'")
  expect('client.js', client, 'function terminalNew')
  expect('client.js', client, 'function ensureTerminalWorkspace')
  expect('client.js', client, "var TERMINAL_KEY = 'dsh.luwi.portal.terminal'")
  expect('client.js', client, 'readStored(TERMINAL_KEY)')
  expect('client.js', client, 'function terminalBack')
  expect('client.js', client, "'电脑上的对话'")
  expect('client.js', client, "'在电脑上开一场新对话'")
  expect('client.js', client, 'if (terminalMode) {\n          terminalNew()')
  expect('client.js', client, 'if (!terminalMode) call(\'portalBind\', sessionId)')
  expect('client.js', client, 'if (terminalMode && !isTerminalSession(ledger && ledger.id))')
  expect('client.js', client, 'terminal: setTerminal')
  expect('client.js', client, 'back: terminalBack')
  expect('client.js', client, 'terminal: function (open) { portal.terminal(open) }')
  expect('client.js', client, 'back: function () { return portal.back() }')
  expect('client.js', client, 'function pickSync')
  // 2026-11-22 主人: "终端不加返回按钮, 而是从终端按钮返回, 在终端时, 按钮上的字应当是「对话」"
  // —— 那颗钮成了一个开关: 不在终端时进终端, 在终端里回对话; 头栏那颗「‹ 返回」整块撤掉
  expect('client.js', client, 'var TERMINAL_BACK_TITLE = \'对话\'')
  expect('client.js', client, 'var TERMINAL_BACK_HINT = \'回到对话\'')
  expect('client.js', client, 'function applySyncTitle')
  expect('client.js', client, 'els.syncButton.textContent = TERMINAL_BACK_TITLE')
  expect('client.js', client, 'if (terminalMode) closeTerminal()\n        else openTerminal()')
  expect('终端里没有自己的返回按钮', String(!/lwp-term-back|termBack/u.test(client)), 'true')
  // 那颗钮的字归 `applyTerminalMode` 每进每出对一次 (页面重载 / 配对重启回来也走这一句)
  expect('client.js', client, 'applySyncTitle()\n        // 落到电脑那一场没有')

  // ②b 进终端落哪一场 / 退出回哪一场的接线 (2026-11-21)
  expect('client.js', client, 'var TERMINAL_RECENT_MS = 60 * 60 * 1000')
  expect('client.js', client, 'var TERMINAL_ENTER_COOLDOWN_MS = 20 * 1000')
  expect('client.js', client, 'if (!isTerminalSession(id)) rememberSession(id)')
  expect('client.js', client, 'writeStored(TERMINAL_KEY, { on: true, back: terminalReturn })')
  expect('client.js', client, 'terminalRestore(back)')
  expect('client.js', client, 'terminal auto-enter: no shadow workspace yet')
  const enterSource = takeFunction('terminalEnter')
  if (enterSource === '') fail('client.js: 抽不出 terminalEnter')
  else {
    expectOrder('terminalEnter: 已经在电脑那几场里就不动', enterSource, 'if (isTerminalSession(sessionId)) return', 'terminalRecentRow(')
    expectOrder('terminalEnter: 自动那趟的冷却在挑场之前', enterSource, 'TERMINAL_ENTER_COOLDOWN_MS) return', 'terminalRecentRow(')
    expect('client.js', enterSource, 'terminalAutoAt = Date.now()')
    expectOrder('terminalEnter: 1h 内一场都没有 → 新建一场与电脑连的', enterSource, 'recent === null', 'terminalNew({ quiet: true })')
    // 窗口得真的传下去: 只在注释里留个 `TERMINAL_RECENT_MS` 不算
    const recentArgs = callArgs(enterSource, 'terminalRecentRow')
    if (recentArgs !== null && recentArgs.length === 3
      && recentArgs[0].startsWith('terminalRows(')
      && recentArgs[1] === 'Date.now()'
      && recentArgs[2] === 'TERMINAL_RECENT_MS') {
      note('terminalEnter: 挑场用的是 1 小时那个窗口 (terminalRecentRow 三个实参对得上)')
    } else {
      fail(`client.js: terminalEnter 没把 1 小时窗口传下去 (${JSON.stringify(recentArgs)})`)
    }
  }
  const newSource = takeFunction('terminalNew')
  if (newSource === '') fail('client.js: 抽不出 terminalNew')
  else {
    expect('client.js', newSource, 'options.quiet === true')
    expect('client.js', newSource, '}, quiet)')
    // 退出终端之后这一趟作废 (等影子工作区要 10 秒, 中间人可能已经按了返回) —— 缩进不进锚点, 数道数
    expectOrder('terminalNew: 等出工作区的中间退出了终端就不开', newSource, "if (workspaceId === '') return", '等这 10 秒的中间可能已经退出终端了')
    const guardCount = newSource.split('if (!terminalMode) return').length - 1
    if (guardCount === 2) {
      note('terminalNew: 两道 `!terminalMode` 的 return 闸 (函数口 + 等出工作区之后)')
    } else {
      fail(`client.js: terminalNew 的 \`!terminalMode\` return 闸是 ${String(guardCount)} 道, 应该 2 道`)
    }
    expectOrder('terminalNew: 等出来的新场在退出终端之后不许上屏', newSource, "if (workspaceId === '') return", 'if (!terminalMode) {')
    // 静默那趟也得让人知道出了什么事 (一分钟最多一句)
    expect('client.js', newSource, 'terminalNoteOnce(')
  }
  const restoreSource = takeFunction('terminalRestore')
  if (restoreSource === '') fail('client.js: 抽不出 terminalRestore')
  else {
    expectOrder('terminalRestore: 没记返回点就回门户那个默认工作区', restoreSource, "if (id === '')", "landInDefaultWorkspace('back')")
    expectOrder('terminalRestore: 有返回点就换回那一场', restoreSource, "landInDefaultWorkspace('back')", "switchTo(id, 'history')")
    if (restoreSource.includes('ledgerHoldUntil = Date.now() + 15000')) {
      note('terminalRestore: 真换了场才 15 s 不跟账本 (球那边说话也不把人拽走)')
    } else {
      fail('client.js: terminalRestore 没有那 15 s 的账本闸')
    }
    if (restoreSource.includes('if (terminalMode) return')) note('terminalRestore: 这中间又点进终端就不再抢回来')
    else fail('client.js: terminalRestore 不看终端是否又开着')
    // 成功判据不能只看 `switchTo` 的返回值 (那只是"画得上", mainView 可能还在电脑那一场)
    // **实参次序也要钉**: 第 3 个是"要落地的那一场", 第 4 个必须是 mainView 那一场 (写成 sessionId 就白改)
    const landedArgs = callArgs(restoreSource, 'terminalLanded')
    if (JSON.stringify(landedArgs) === JSON.stringify(['drawn', 'main', 'id', 'isTerminalSession(main)'])) {
      note('terminalRestore: terminalLanded(drawn, main, id, isTerminalSession(main)) —— 看的是 mainView 那一场')
    } else {
      fail(`client.js: terminalLanded 的实参不对 (${JSON.stringify(landedArgs)}) —— 第 4 个必须是 mainView 那一场`)
    }
    if (restoreSource.includes('tries >= 20')) {
      note('terminalRestore: 补拍到 5 秒 (跨工作区那趟 RPC 慢机上也等得起)')
    } else {
      fail('client.js: terminalRestore 的补拍预算不到 20 拍 —— 慢机上返回点会点不开')
    }
  }
  const openSource = takeFunction('openTerminal')
  if (openSource === '') fail('client.js: 抽不出 openTerminal')
  else {
    // 记返回点那一侧: 屏上本来就是电脑那一场时不许把它记成返回点 (实参次序也钉住)
    const returnForArgs = callArgs(openSource, 'terminalReturnFor')
    const wantReturnFor = ['sessionId', 'recallSession()', 'isTerminalSession(sessionId)', 'isTerminalSession(recallSession())']
    if (JSON.stringify(returnForArgs) === JSON.stringify(wantReturnFor)) {
      note('openTerminal: terminalReturnFor(当前场, SESSION_KEY, 当前场是不是电脑场, 记忆那次是不是电脑场)')
    } else {
      fail(`client.js: terminalReturnFor 的实参不对 (${JSON.stringify(returnForArgs)}) —— 三个/四个实参换位就把电脑场记成返回点了`)
    }
  }
  const closeSource = takeFunction('closeTerminal')
  if (closeSource === '') fail('client.js: 抽不出 closeTerminal')
  else {
    expectOrder('closeTerminal: 先把返回点取出来再清 (顺序写反 = 点返回什么都不发生)', closeSource, 'var back = terminalReturn', 'terminalReturn = null')
    expect('client.js', closeSource, 'terminalRestore(back)')
  }
  const setTerminalSource = takeFunction('setTerminal')
  if (setTerminalSource === '') fail('client.js: 抽不出 setTerminal')
  else if (setTerminalSource.includes('terminalAutoAt = 0')) {
    note('setTerminal: 人再点一次「终端」就清冷却 (失败了当场能再试)')
  } else {
    fail('client.js: setTerminal 不清冷却 —— 失败后 20 秒内再点「终端」什么都不发生')
  }
  // 会话表那条跟随也要两扇门互不串 (mainView 落在电脑那一场时不许把普通门户拽过去)
  expectExactLine('listUnsub: 两扇门互不串只用同一个判据 (不许再追加 `|| terminalMode`)', client, 'var sameKind = isTerminalSession(id) === terminalMode')
  // 静默那趟的两处 (读数 / 影子工作区) 都要能说一句, 删掉一处就退回"黑底上不吭声"
  const ensureSource = takeFunction('ensureTerminalWorkspace')
  if (ensureSource === '') fail('client.js: 抽不出 ensureTerminalWorkspace')
  else {
    const quietNotes = ensureSource.split('terminalNoteOnce(').length - 1
    if (quietNotes === 2) note('ensureTerminalWorkspace: 两处静默分支都留了 terminalNoteOnce')
    else fail(`client.js: ensureTerminalWorkspace 里 terminalNoteOnce 是 ${String(quietNotes)} 处, 应该 2 处`)
  }
  // 卸挂那段只许切工作区: 影子工作区里的场 `openSession` 一个都留不住
  const unmountSource = takeFunction('unmount')
  if (unmountSource === '') fail('client.js: 抽不出 unmount')
  else {
    if (unmountSource.includes('openSession(') || unmountSource.includes('openBallWorkspace(')) {
      fail('client.js: unmount 又去 openSession / openBallWorkspace —— 影子工作区里那两下都落不回门户那一场')
    } else {
      note('unmount: 退出终端时只切工作区 (不碰 openSession / openBallWorkspace)')
    }
    expectOrder('unmount: 只有 mainView 真在电脑那一场才换', unmountSource, 'isTerminalSession(currentSessionId())', 'currentWorkspaceId()')
    expect('client.js', unmountSource, 'openWorkspace(home)')
  }

  // ②c 2026-11-21 返工: 门牌不闪 + 进终端不显示门户对话
  //
  // 主人两条: ① 「正在找电脑」那张卡一直反复闪 —— 探针 5/15 秒一拍, 每一拍都先把卡翻成 probing
  // 再翻回来; ② 进终端时门户的对话仍显示在终端 (黑底上透出门户那一场的气泡)
  const firstProbeGate = terminalGateState(
    { paired: true, syncOn: true, terminalReady: true },
    { ok: false, busy: true, why: '', at: 0 },
  )
  const refreshingOnline = terminalGateState(
    { paired: true, syncOn: true, terminalReady: true },
    { ok: true, busy: true, why: '', at: 2 },
  )
  const refreshingOffline = terminalGateState(
    { paired: true, syncOn: true, terminalReady: true },
    { ok: false, busy: true, why: '网络不通', at: 1 },
  )
  if (firstProbeGate.state === 'probing' && refreshingOnline.state === ''
    && refreshingOffline.state === 'offline' && refreshingOffline.note.includes('网络不通')) {
    note('terminalGateState: 只有首探说「正在找电脑」; 之后每一拍重探按上一次结论画 (在线不弹 / 掉线卡连原因都不闪)')
  } else {
    fail(`terminalGateState: 重探那一拍还是把卡片翻面了 (${JSON.stringify([firstProbeGate.state, refreshingOnline.state, refreshingOffline.state])})`)
  }
  expect('client.js', client, 'var firstProbe = busy && !(at > 0)')
  expect('client.js', client, 'if (terminalMode && firstProbe) renderTerminalGate()')
  expect('client.js', client, 'terminalProbe = { at: terminalProbe.at, ok: terminalProbe.ok, busy: true, why: terminalProbe.why }')

  // ②d 2026-11-22: 弹窗的 3 秒门槛 —— 主人: "终端还是一直会闪正在连接的窗口, 但只出现不到 1s,
  // 要求若未连接超过 3s 才出现那个窗口"
  //
  // 闪的就是首探那张「正在找电脑」: 一进终端就上屏, 而探针多半 200 ms 内就回来了. 现在先黑着,
  // 从"这一轮没连上的第一拍"(`terminalGateSince`) 起满 3 秒才许弹; 门槛的算法是纯函数
  // (`terminalGateWait`), 这里把源码抽出来真跑, 不复制第二份实现
  const gateWait = new Function(`${takeFunction('terminalGateWait')}\nreturn terminalGateWait`)()
  const waitCases = [
    [0, 1000, 3000, 3000, '还没开始算: 失败关闭, 给满门槛'],
    [1000, 1200, 3000, 2800, '刚过 200 ms: 还差 2.8 秒'],
    [1000, 3999, 3000, 1, '差 1 ms 也不许弹'],
    [1000, 4000, 3000, 0, '满 3 秒: 当场弹'],
    [1000, 99000, 3000, 0, '掉线久了也一直是 0 (弹出来的卡不会自己收回去)'],
    [1000, 2000, 0, 0, '门槛为 0: 老行为, 立刻弹'],
  ]
  const wrongWait = waitCases.filter((item) => gateWait(item[0], item[1], item[2]) !== item[3])
  if (wrongWait.length === 0) {
    note('terminalGateWait: 没连上满 3 秒才许弹窗 (不满先黑着, 到点再画一次)')
  } else {
    fail(`terminalGateWait: 门槛算错了 ${JSON.stringify(wrongWait.map((item) => ({ why: item[4], got: gateWait(item[0], item[1], item[2]), want: item[3] })))}`)
  }
  expect('client.js', client, 'var TERMINAL_GATE_GRACE_MS = 3000')
  // 门槛只管"要靠活探测才有结论"的那两档: 配置能直接读出结论的三档当场画, 不让人对着黑屏等
  const gateFlags = [unpaired.probe, off.probe, legacy.probe, probing.probe, offline.probe, online.probe]
  if (JSON.stringify(gateFlags) === JSON.stringify([false, false, false, true, true, false])) {
    note('terminalGateState: 门槛只卡探测中 / 电脑没连上两档 (没配对 / 关着 / 没配好当场就画)')
  } else {
    fail(`terminalGateState: probe 那一格不对 ${JSON.stringify(gateFlags)}`)
  }
  const gateSource = takeFunction('renderTerminalGate')
  if (gateSource === '') {
    fail('client.js: 抽不出 renderTerminalGate')
  } else {
    expect('client.js', gateSource, 'if (said.probe === true) {')
    expect('client.js', gateSource, 'var wait = terminalGateWait(terminalGateSince, now, TERMINAL_GATE_GRACE_MS)')
    expectOrder('renderTerminalGate: 不满门槛先黑着, 到点才上屏', gateSource, 'if (wait > 0)', 'els.termGate.hidden = false')
    expect('client.js', gateSource, 'terminalGateTimer = setTimeout(function () {')
    expect('client.js', gateSource, 'terminalGateSince = 0')
  }
  // 进出终端各把门槛那一拍清掉: 上一趟的计时器不许在出去之后还画一次, 也不许把门槛算到这一次头上
  const gateCloseSource = takeFunction('closeTerminal')
  const gateOpenSource = takeFunction('openTerminal')
  expect('client.js', gateCloseSource, 'clearTimeout(terminalGateTimer)')
  expect('client.js', gateCloseSource, 'terminalGateSince = 0')
  // 门口那一拍起算 (不从第一帧渲染起算: 穿皮 + 清 DOM 那零点几秒不该算进门槛)
  expect('client.js', gateOpenSource, 'terminalGateSince = Date.now()')
  expectOrder('openTerminal: 门槛先起算, 再探一次电脑', gateOpenSource, 'terminalGateSince = Date.now()', 'probeTerminal()')
  // 门户对话那条: 样式兜第一帧, 脚本清 DOM, 退出终端再画回来
  expect('client.js', client, '#lwp-root[data-mode="terminal"]:not([data-term-session="on"]) #lwp-flow{visibility:hidden}')
  expect('client.js', client, 'function markTerminalSession')
  expect('client.js', client, "root.setAttribute('data-term-session', isTerminalSession(sessionId) ? 'on' : 'off')")
  expect('client.js', client, 'var TERMINAL_HIDDEN_SIG')
  const markSource = takeFunction('markTerminalSession')
  if (markSource !== '' && markSource.includes('root.removeAttribute(\'data-term-session\')')) {
    note('markTerminalSession: 不在终端时把记号摘掉 (门户照旧显示对话)')
  } else {
    fail('client.js: markTerminalSession 不在终端时不摘记号 —— 门户会一直空着')
  }
  const metaSource = takeFunction('renderMeta')
  const modeSource = takeFunction('applyTerminalMode')
  if (metaSource.includes('markTerminalSession()') && modeSource.includes('markTerminalSession()')) {
    note('renderMeta / applyTerminalMode 各对一次「落到电脑那一场没有」')
  } else {
    fail('client.js: renderMeta 或 applyTerminalMode 没对记号 —— 换场之后对话上不了屏')
  }
  const flowSource = takeFunction('renderFlow')
  if (flowSource === '') fail('client.js: 抽不出 renderFlow')
  else {
    expectOrder('renderFlow: 终端里还没落到电脑那一场就一格都不画', flowSource, 'renderMeta()', 'if (terminalMode && !isTerminalSession(sessionId))')
    expect('client.js', flowSource, 'flowSig = TERMINAL_HIDDEN_SIG')
  }
  // 退出终端要把门户那一场立刻画回来 (没真换过场时 terminalRestore 一个字节都不动)
  expect('client.js', closeSource, 'flowSig = null')
  const openForClean = takeFunction('openTerminal')
  if (openForClean.includes('flowSig = null') && openForClean.includes('renderFlow()')) {
    note('openTerminal: 进终端当场把 DOM 也清掉 (不等 3 秒那一拍)')
  } else {
    fail('client.js: openTerminal 没当场清掉门户对话 —— 离线门牌期会一直贴着旧气泡')
  }

  // ③ 原生那一半
  const portalTerminalKt = read('app/src/main/java/io/github/yuloong07star/luwi/ui/PortalTerminal.kt')
  expect('PortalTerminal.kt', portalTerminalKt, 'var open by mutableStateOf(false)')
  expect('PortalTerminal.kt', portalTerminalKt, 'fun status(context: Context): String')
  expect('PortalTerminal.kt', portalTerminalKt, '"shadowRoot"')
  expect('PortalTerminal.kt', portalTerminalKt, 'window.__LUWI_PORTAL__.terminal(true)')
  expect('PortalBridge.kt', portalBridge, 'fun portalTerminal(): String = PortalTerminal.status(context)')
  expect('PortalBridge.kt', portalBridge, 'fun portalTerminalVisible(open: Boolean): String')
  expect('PortalBridge.kt', portalBridge, 'fun portalTerminalPair(): String')
  // 2026-11-22: 未配对卡片那颗钮走同一条掷标路 (PC_INSTALL), 由 HostScreen 开系统浏览器
  expect('PortalBridge.kt', portalBridge, 'fun portalTerminalInstall(): String')
  expect('PortalTerminal.kt', portalTerminalKt, 'const val PC_INSTALL_URL')
  expect('HostScreen.kt', hostScreen, 'PortalAsk.Target.PC_INSTALL -> {')
  expect('HostScreen.kt', hostScreen, 'if (PortalTerminal.open) Color.Black else Color.Transparent')
  expect('HostScreen.kt', hostScreen, 'preview != null && !windowHidden && !PortalTerminal.open')
  expect('HostScreen.kt', hostScreen, 'PortalAsk.Target.PAIR -> {')
  expect('HostScreen.kt', hostScreen, 'QrScanDialog(')
  expect('HostScreen.kt', hostScreen, 'SyncSetting.applyPairing(context, payload)')
  expect('HostScreen.kt', hostScreen, 'PortalTerminal.open(context)')
  expect('HostScreen.kt', hostScreen, 'window.__LUWI_PORTAL__.terminal(true)')
  expect('HostScreen.kt', hostScreen, "portal.back() === 'closed'")
  expect('PortalTerminal.kt', portalTerminalKt, 'private const val OPEN_SCRIPT')
  // 原生那一份读数里不许有口令
  if (!/put\("(token|peerToken)"|sync\.peerToken/u.test(portalTerminalKt)) {
    note('PortalTerminal：读数里没有口令 (页面一个字节都拿不到)')
  } else {
    fail('PortalTerminal: status 里把口令写出去了')
  }
}

// ── 二十八、点发送必须看得见结果 (2.8.1 #33) ──────────────────────────────────
//
// 主人报的是"在前台点发送, 只有按钮变色, 没有内容发出去, 过一会又恢复原状". 三件都要钉住:
// 1. `prompt()` 回 `{ok:false}` / 抛错时, 那句错误必须落到**时间线可见处** (`who:'error'`,
//    与图片失败同一档), 不许只剩一行 `console.log` —— 门户盖着 dsh 自己的错误条, 屏上就等于没发生
// 2. 空草稿点发送不再静默 `return`: 要么给一句提示, 要么那颗钮本来就是按不动的
// 3. 一次 `pointerdown`→`pointerup` 只能投一次: 轻点 = `queue`, 长按 = `steer`, 长按之后那次抬起
//    不再补一次 `queue` (以前靠"计时器有没有被清掉"当记号, 第二根手指就会投两次)
//
// 2 与 3 都是纯函数, 这里把源码原样抽出来真跑 (`sendGesture` / `pendingEchoState` /
// `sendFailText`), 不复制第二份实现

const sendSource = takeFunction('send')
if (sendSource === '') {
  failures.push('client.js: 抽不出 send (发送那一条链)')
} else {
  if (!sendSource.includes("showNote('先写点什么, 再发', true)")) {
    failures.push('client.js: 空草稿点发送还是静默 return (屏上什么都不说)')
  } else {
    notes.push('ok   空草稿点发送留一句「先写点什么, 再发」')
  }
  if (sendSource.includes('throw new Error(reason)')) {
    failures.push('client.js: 拒答还走 throw —— 只有 catch 里那行 console.log 看得见')
  } else {
    notes.push('ok   拒答不再靠 throw, 由 [failed] 一处收尾')
  }
  const failedBranch = sendSource.slice(sendSource.indexOf("if (failed !== '')"))
  if (failedBranch.includes('pushSendFail(failed)') && failedBranch.includes('showNote(failed, true)')) {
    notes.push('ok   拒答 / 抛错都落成时间线上一行红字 + 输入卡一句提示')
  } else {
    failures.push('client.js: 失败那一支没把话落到时间线上 (只剩 console.log)')
  }
  if (failedBranch.includes('pendingEcho = null') && failedBranch.includes("els.input.value = text")) {
    notes.push('ok   失败那一拍: 撤掉本机占位 + 把草稿还回去')
  } else {
    failures.push('client.js: 失败那一拍没撤占位 / 没还草稿')
  }
  if (sendSource.includes('pendingEcho = pendingEchoStart(text, attach)')) {
    notes.push('ok   投出去先在本机占一行 (dsh 的回显要等 Host 收下才进快照)')
  } else {
    failures.push('client.js: 投出去时没有本机占位 —— 点完发送时间线上会空好几拍')
  }
}
expect('client.js', client, 'var sendFails = []')
expect('client.js', client, 'function pushSendFail')
// `session.prompt()` 同步抛的时候不许把 `sending` 永远钉在 true (按钮就一直转圈)
expect('client.js', client, 'started = Promise.reject(error)')
expect('client.js', client, "var rejected = promptErrorText(snapshot.promptError)")
// 时间线上那一档: 本机那几条必须真的进 `extras` (画成 `who:'error'`), 不是只记不画
if (/for \(var sf = 0; sf < sendFails\.length; sf \+= 1\) \{[\s\S]*?who: 'error',[\s\S]*?text: sendFails\[sf\]\.text/u.test(client)) {
  notes.push('ok   本机那几条「这句没发出去」真的进了 extras (画成红字气泡)')
} else {
  failures.push('client.js: sendFails 没接进 nodesOf 的 extras —— 记下来却画不出来')
}
// 一次按下只投一次: 发送钮那三个监听器必须都走 [sendGesture]
const sendWiring = client.slice(client.indexOf("els.send.addEventListener('pointerdown'"), client.indexOf("row.appendChild(els.send)"))
if (sendWiring.includes('sendGesture(sendPress') && sendWiring.includes("held.act === 'hold'")
  && sendWiring.includes("step.act === 'tap'") && !sendWiring.includes('longPress')) {
  notes.push('ok   发送钮三个监听器都走 sendGesture (轻点 queue / 长按 steer 各一次)')
} else {
  failures.push('client.js: 发送钮还在用 longPress 那套记号 —— 一次按下可能投两次')
}
// 长按投出去之后状态必须复位 (2026-11-19 审查): send() 同步把按钮置 disabled, 手指还按着时
// pointerup 收不到 —— 不复位就卡在 `fired`, 之后每一次轻点都被判 'ignore', 正是这单要修的观感
if (sendWiring.includes('sendPress = { pressed: false, fired: false }')
  && /window\.addEventListener\('pointerup'[\s\S]{0,120}sendPress\.pressed/u.test(sendWiring)) {
  notes.push('ok   长按投完复位 + 窗口捕获兜底 (按钮被禁用也不丢抬起)')
} else {
  failures.push('client.js: 长按投出去之后没有复位 sendPress —— 按钮被置 disabled 后 pointerup 丢失, 下一次轻点会被吞')
}

/**
 * 按大括号配对接一个具名函数的整段源 (缩进不是 6 空格的也认得 —— `describeError` 在模块那一层)
 * @param name - 函数名
 * @returns 从 `function name(` 到配对 `}` 的那一段; 找不到回空串
 */
function sliceFunction(name) {
  const start = client.indexOf(`function ${name}(`)
  if (start < 0) return ''
  let depth = 0
  const from = client.indexOf('{', start)
  for (let index = from; index < client.length; index += 1) {
    const char = client[index]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return client.slice(start, index + 1)
    }
  }
  return ''
}

const failTextSource = sliceFunction('sendFailText')
const describeSource = sliceFunction('describeError')
const promptErrorSource = sliceFunction('promptErrorText')
if (failTextSource === '' || describeSource === '' || promptErrorSource === '') {
  failures.push('client.js: 抽不出 sendFailText / describeError / promptErrorText (拒答那句话)')
} else {
  const describeError = new Function(`${describeSource}\nreturn describeError`)()
  const sendFailText = new Function('describeError', `${failTextSource}\nreturn sendFailText`)(describeError)
  const promptErrorText = new Function('sendFailText', `${promptErrorSource}\nreturn promptErrorText`)(sendFailText)
  const codeCase = sendFailText({ code: 'session/model-unavailable', message: 'Select an available model' })
  const cases = [
    ['码与话都在', codeCase === '这句没发出去: session/model-unavailable: Select an available model'],
    ['只有 Error', sendFailText(new Error('boom')) === '这句没发出去: boom'],
    ['只有码', sendFailText({ code: 'gateway/internal' }) === '这句没发出去: gateway/internal'],
    ['什么都没有', sendFailText(null) === '这句没发出去'],
    ['空串不算话', sendFailText('   ') === '这句没发出去'],
    ['快照上那一格', promptErrorText({ op: 'send', error: { code: 'c', message: 'm' } }) === '这句没发出去: c: m'],
    ['停那一轮失败不在这条链上说', promptErrorText({ op: 'stop', error: { code: 'c', message: 'm' } }) === ''],
    ['没有拒答就是空串', promptErrorText(null) === '' && promptErrorText({}) === ''],
  ]
  const broken = cases.filter((one) => one[1] !== true).map((one) => one[0])
  if (broken.length === 0) {
    notes.push('ok   sendFailText / promptErrorText: 有码有话就照抄, 没有才用兜底那句')
  } else {
    failures.push(`拒答那句话拼错了: ${broken.join(' / ')}`)
  }
}

const gestureSource = sliceFunction('sendGesture')
if (gestureSource === '') {
  failures.push('client.js: 抽不出 sendGesture (发送钮那一次按下的判据)')
} else {
  const sendGesture = new Function(`${gestureSource}\nreturn sendGesture`)()
  const acts = []
  let state = { pressed: false, fired: false }
  const step = (event) => {
    const one = sendGesture(state, event)
    state = one.state
    acts.push(one.act)
    return one.act
  }
  // 轻点一下: down -> up
  if (step('down') === 'arm' && step('up') === 'tap') notes.push('ok   轻点一下 = arm -> tap (投 queue 一次)')
  else failures.push(`轻点那一下判错了: ${acts.join(' -> ')}`)
  // 长按: down -> hold -> up (抬起那一下不许再投 queue)
  acts.length = 0
  state = { pressed: false, fired: false }
  const longActs = [step('down'), step('hold'), step('up')]
  if (longActs.join(',') === 'arm,hold,ignore') notes.push('ok   长按 = arm -> hold -> ignore (抬起不再补一次 queue)')
  else failures.push(`长按那一下判错了: ${longActs.join(' -> ')}`)
  // 多一根手指: 按着的时候第二次 down 不许挂第二个计时器
  state = { pressed: false, fired: false }
  const twice = [step('down'), step('down')]
  if (twice.join(',') === 'arm,ignore') notes.push('ok   按着时第二次 down 被挡住 (一根手指一次投递)')
  else failures.push(`第二次按下没挡住: ${twice.join(' -> ')}`)
  // 抬起离开按钮 (cancel): 什么都不投
  state = { pressed: false, fired: false }
  const cancelled = [step('down'), step('cancel'), step('up')]
  if (cancelled.join(',') === 'arm,disarm,ignore') notes.push('ok   按下后离开 (cancel) 撤计时器, 不投递')
  else failures.push(`取消那一路判错了: ${cancelled.join(' -> ')}`)

  const holdMs = grab(client, /var SEND_HOLD_MS = (\d+)/u)
  const wiringHold = grab(client, /sendTimer = setTimeout\(function \(\) \{[\s\S]*?\n          \}, (SEND_HOLD_MS)\)/u)
  if (holdMs === '550' && wiringHold === 'SEND_HOLD_MS') notes.push('ok   长按阈值 550 ms 由 SEND_HOLD_MS 一处给')
  else failures.push(`长按阈值没走 SEND_HOLD_MS (抓到 ${String(holdMs)} / ${String(wiringHold)})`)
}

const echoSameSource = sliceFunction('pendingEchoSame')
const echoStateSource = sliceFunction('pendingEchoState')
if (echoSameSource === '' || echoStateSource === '') {
  failures.push('client.js: 抽不出 pendingEchoSame / pendingEchoState (本机占位那一行)')
} else {
  const pendingEchoSame = new Function(`${echoSameSource}\nreturn pendingEchoSame`)()
  const pendingEchoState = new Function('pendingEchoSame', `${echoStateSource}\nreturn pendingEchoState`)(pendingEchoSame)
  const hold = { id: 'pending\u00011', at: 1_000_000, text: '测试发送', attach: [] }
  const landed = { who: 'user', time: 1_000_400, text: '测试发送', attach: [] }
  const older = { who: 'user', time: 900_000, text: '测试发送', attach: [] }
  const other = { who: 'user', time: 1_000_500, text: '别的' , attach: [] }
  const cases = [
    ['落盘那条到了就让位', pendingEchoState(hold, [landed], true, 1_000_800, 15_000) === 'done'],
    ['还在投就占着', pendingEchoState(hold, [], true, 1_000_800, 15_000) === 'keep'],
    ['投完了还没落盘也占着', pendingEchoState(hold, [other], false, 1_000_800, 15_000) === 'keep'],
    ['等太久就撤', pendingEchoState(hold, [], false, 1_020_000, 15_000) === 'drop'],
    ['没有占位就什么都不画', pendingEchoState(null, [], true, 1_000_800, 15_000) === 'drop'],
    ['同一句话的旧那条不算落盘', pendingEchoState(hold, [older], false, 1_000_800, 15_000) === 'keep'],
  ]
  const broken = cases.filter((one) => one[1] !== true).map((one) => one[0])
  if (broken.length === 0) {
    notes.push('ok   pendingEchoState: 落盘就让位 / 在投就占着 / 等太久撤 / 旧那条不冒充')
  } else {
    failures.push(`本机占位判错了: ${broken.join(' / ')}`)
  }
}
expect('client.js', client, "row.setAttribute('data-pending', 'on')")
expect('client.js', client, '.lwp-row[data-pending="on"] .lwp-bubble{opacity:.6}')

// ── 第二十九节: 缺省那张脸跟着 Luwi 图标走 (2026-11-22) ───────────────────────

expect('client.js', client, 'var MARK_CACHE')
expect('client.js', client, "if (markVer !== '')")
expect('client.js', client, "if (mark === '') mark = MARK_PNG")
expect('client.js', client, 'writeStored(MARK_CACHE, { ver: markVer, url: mark })')
expect('client.js', client, "var src = avatar === '' ? mark : avatar")

const identitySource = sliceFunction('applyIdentity')
if (identitySource === '') {
  failures.push('client.js: 抽不出 applyIdentity (缺省那张脸)')
} else if (!/terminalMode[\s\S]*?avatar = ''[\s\S]*?var src = avatar === '' \? mark : avatar/u.test(identitySource)) {
  failures.push('applyIdentity: 终端里清空头像之后没有落到当前那套的 mark')
} else {
  notes.push('ok   applyIdentity: 终端页也吃当前那套图标')
}

// 图的搬运闸: 没配背景也没配头像的机器, fetchLook 会一直是"读数那一份" —— mark 必须自己算进这道闸,
// 否则它永远是空, 页面永远回退到内嵌的 MARK_PNG (2026-11-22 真机踩到的那一条)
const lookSource = sliceFunction('fetchLook')
if (lookSource === '') {
  failures.push('client.js: 抽不出 fetchLook (缺省那张脸的搬运闸)')
} else if (!/var markReady = cachedMark && cachedMark\.ver === markVer/u.test(lookSource)
  || !/markVer !== '' && !markReady/u.test(lookSource)) {
  failures.push('fetchLook: mark 没进"要不要搬图"的闸 (没配背景的机器会永远画旧标记)')
} else {
  notes.push('ok   fetchLook: 换套才搬一次 mark')
}

// 空态那圈描边只给自选头像 (2026-11-22): 原来拿 `avatar !== MARK_PNG` 判, 而换套之后 avatar 是
// data URL, 永远不等于内嵌常量 —— 终端页那张截图外面那圈框就是这么冒出来的 (`face.json` 里 avatar 是空串)
const heroSource = sliceFunction('heroNode')
if (heroSource === '') {
  failures.push('client.js: 抽不出 heroNode (空态那圈描边的判据)')
} else if (!/data-photo', identity\.photo \? 'on' : 'off'/u.test(heroSource)) {
  failures.push('heroNode: 描边没按 identity.photo 判 (图标套那张会被当成自选头像)')
} else if (/identity\.avatar !== MARK_PNG/u.test(heroSource)) {
  failures.push('heroNode: 还在拿 MARK_PNG 认"自选头像"')
} else {
  notes.push('ok   heroNode: 描边只给自选头像')
}
if (identitySource !== '' && !/avatar = ''[\s\S]{0,600}?var photo = avatar !== ''/u.test(identitySource)) {
  failures.push('applyIdentity: photo 没在终端清空 avatar 之后算')
} else if (identitySource !== '') {
  notes.push('ok   applyIdentity: 终端里 photo 一定是 false')
}
expect('client.js', client, "'dsh.luwi.portal.mark2'")

// ── 三十、长文本发完, 输入框高度回到一行 (2.8.1 #51) ───────────────────────────
//
// 主人报的是"打满十几行发出去, 输入框还是那么高, 要再敲一个字才收回去". 根因: 高度只挂在
// `input` 事件上, 而清空是**程序改 `value`** —— 那一趟没有事件, 框就停在上一份高度.
//
// 现在三条路都走同一个 `autoSizeInput`: `input` 事件 / `send()` 清空之后 / 失败还草稿之后.
// 换算与"清不清"是纯函数 (`inputHeightPx` / `inputResetsToLine`), 这里把源码原样抽出来真跑:
// 1 行 / 5 行 / 20 行的换算 (20 行封顶 14 行)、清空后回 CSS 的一行默认高、再输入重新长高、
// 失败还回来的长文本高度对得上

const inputLineConst = Number(grab(client, /var INPUT_LINE_PX = (\d+)/u))
const inputMaxConst = Number(grab(client, /var INPUT_MAX_LINES = (\d+)/u))
// 这两个数与 CSS 那一档必须是同一份 (漂了就会出现"封顶是 14 行, 而框长到 20 行")
const cssInputBox = /max-height:calc\((?<lines>\d+) \* \((?<line>\d+)px \+ var\(--dsh-content-font-delta,0px\)\)\)/u.exec(client)
if (cssInputBox !== null && Number(cssInputBox.groups.lines) === inputMaxConst
  && Number(cssInputBox.groups.line) === inputLineConst) {
  notes.push(`ok   输入框的 ${String(inputMaxConst)} 行封顶 / 一行 ${String(inputLineConst)}px 与 CSS 逐数相同`)
} else {
  failures.push(`输入框的封顶行数 / 一行高与 CSS 对不上 (JS ${String(inputMaxConst)} 行 / ${String(inputLineConst)}px,`
    + ` CSS ${String(cssInputBox?.groups.lines)} 行 / ${String(cssInputBox?.groups.line)}px)`)
}

const heightPxSource = sliceFunction('inputHeightPx')
const resetsSource = sliceFunction('inputResetsToLine')
const autoSizeSource = sliceFunction('autoSizeInput')
if (heightPxSource === '' || resetsSource === '' || autoSizeSource === '') {
  failures.push('client.js: 抽不出 inputHeightPx / inputResetsToLine / autoSizeInput (输入框高度那一段)')
} else {
  const inputHeightPx = new Function('INPUT_LINE_PX', 'INPUT_MAX_LINES',
    `${heightPxSource}\nreturn inputHeightPx`)(inputLineConst, inputMaxConst)
  const inputResetsToLine = new Function(`${resetsSource}\nreturn inputResetsToLine`)()
  // `autoSizeInput` 在页面里读闭包里的 `els` / 这一份 `inputPx` / 两个常量, 这里原样喂进去
  const autoSizeOf = (box) => new Function(
    'els', 'inputHeightPx', 'inputResetsToLine', 'inputLinePx', 'INPUT_LINE_PX', 'INPUT_MAX_LINES',
    `var inputPx = 0\n${autoSizeSource}\nreturn autoSizeInput`,
  )(
    { input: box }, inputHeightPx, inputResetsToLine, () => inputLineConst, inputLineConst, inputMaxConst,
  )

  const line = inputLineConst
  const heights = [
    ['1 行', inputHeightPx(line, line, inputMaxConst), line],
    ['5 行', inputHeightPx(line * 5, line, inputMaxConst), line * 5],
    ['20 行封顶 14 行', inputHeightPx(line * 20, line, inputMaxConst), line * inputMaxConst],
    ['量不出 (0) 也要有一行', inputHeightPx(0, line, inputMaxConst), line],
  ]
  const wrongHeights = heights.filter((one) => one[1] !== one[2]).map((one) => `${one[0]}: ${String(one[1])} ≠ ${String(one[2])}`)
  if (wrongHeights.length === 0) {
    notes.push(`ok   inputHeightPx: 1 行 ${String(line)} / 5 行 ${String(line * 5)} / 20 行封顶 ${String(line * inputMaxConst)}`)
  } else {
    failures.push(`输入框高度换算错了: ${wrongHeights.join(' / ')}`)
  }

  // 清空 → 高度回 CSS 那一行 (写回 ''), 也就是"发完长文本那一拍"
  const cleared = { value: '', scrollHeight: line * 10, style: { height: `${String(line * 10)}px` } }
  const clearedPx = autoSizeOf(cleared)()
  if (cleared.style.height === '' && clearedPx === 0) {
    notes.push('ok   清空回一行: 发完那一拍 inline height 写回 CSS 的一行默认高')
  } else {
    failures.push(`清空之后高度没回去 (style.height=${JSON.stringify(cleared.style.height)} / 回 ${String(clearedPx)})`)
  }
  // 清空之后接着打字: 从一行重新往上长
  const retyped = { value: '五行的\n第二行\n第三行\n第四行\n第五行', scrollHeight: line * 5, style: { height: '' } }
  if (autoSizeOf(retyped)() === line * 5 && retyped.style.height === `${String(line * 5)}px`) {
    notes.push('ok   再输入长高: 清空之后打 5 行, 高度从一行重新长到 5 行')
  } else {
    failures.push(`清空之后再输入没长高 (style.height=${JSON.stringify(retyped.style.height)})`)
  }
  // 失败还草稿那一路: 还回来的那一整段要对得上内容, 不能停在清空后的一行
  const restored = { value: '十行的草稿\n'.repeat(10).trim(), scrollHeight: line * 10, style: { height: '' } }
  if (autoSizeOf(restored)() === line * 10 && restored.style.height === `${String(line * 10)}px`) {
    notes.push('ok   失败还草稿: 还回来的长文本高度跟着内容 (不停在一行)')
  } else {
    failures.push(`失败还草稿之后高度没对齐 (style.height=${JSON.stringify(restored.style.height)})`)
  }
  // 全是空白的草稿不算"清空": 仍按内容量, 那一行还在
  if (inputResetsToLine('   ') === false && inputResetsToLine('') === true) {
    notes.push('ok   inputResetsToLine: 只有真的空才算清空 (空白草稿仍按内容量)')
  } else {
    failures.push('inputResetsToLine: 把空白草稿也当成清空了')
  }
}

// 三条路必须真的都调那一处换算 (少一条就有一路停在旧高度)
const sendClearAt = sendSource.indexOf("els.input.value = ''")
if (sendClearAt >= 0 && sendSource.slice(sendClearAt, sendClearAt + 400).includes('autoSizeInput()')) {
  notes.push('ok   send(): 清空草稿的那一拍当场重算高度')
} else {
  failures.push('client.js: send() 清空草稿之后没有重算高度 —— 发出去还留着上一截')
}
const sendFailAt = sendSource.indexOf('if (failed !== \'\')')
const sendFailBranch = sendFailAt < 0 ? '' : sendSource.slice(sendFailAt)
if (/els\.input\.value = text[\s\S]{0,200}?autoSizeInput\(\)/u.test(sendFailBranch)) {
  notes.push('ok   send(): 失败还草稿之后高度跟着还回来的那一段')
} else {
  failures.push('client.js: 失败还回来的草稿没有重算高度')
}
const inputWiring2 = /els\.input\.addEventListener\('input'[\s\S]{0,400}?\n        \}\)/u.exec(client)?.[0] ?? ''
if (inputWiring2.includes('autoSizeInput()') && !inputWiring2.includes('scrollHeight')) {
  notes.push('ok   input 事件也走 autoSizeInput (换算只有一份, 两处不会漂)')
} else {
  failures.push('client.js: input 事件里还在自己算 scrollHeight —— 与 autoSizeInput 两处漂')
}
// 只有 autoSizeInput 一处写 `#lwp-input` 的高度
const inputHeightWrites = (client.match(/els\.input\.style\.height = String\(/gu) ?? []).length
if (inputHeightWrites === 1) {
  notes.push('ok   输入框写高度的地方只有 autoSizeInput 一处')
} else {
  failures.push(`client.js: 写输入框高度的地方有 ${String(inputHeightWrites)} 处 (应该只有 autoSizeInput)`)
}

// ── 三十一、录音态的实时文字层与波形行显隐开关 (2.8.1 #F10, 第三轮) ──────────────
//
// 主人这条要的是"边说边出字": 录音时**波形行下面多一行实时文字** (`aria-live="polite"`, 两行封顶之后
// 单行滚动), 波形行本身兼作这颗文字层的显隐开关; 「60 秒一到整段作废」那条路要消失, 录到 90 秒也不丢
// 前面说的话.
//
// 第二轮按轮内审查 12 条重写; 第三轮再按 12 条把**兜底生命周期**与**阈值取值**钉进判据
// (第二轮只钉了符号名: 阈值改 99 / 同义 CSS 规则都能蒙混过关):
//
// ① 实时层节点 + `aria-live` + `role=log` 逐格追加 (整段重写会让读屏反复重播) + 显隐真机制
// ② 显隐钮只切层不动录音, **且命中小录条三兄弟的 auto 行数恰好 1 行、必须带 data-on="on"**
// ③ `VOICE_CHUNK_MS = 0` 一块都不送: 闸在送块之前 + 切块纯函数真跑 (cursor 严格前进、不越界)
// ④ 块回来先比 `generation`; 失败块与空串分得开; **两侧背压阈值都钉取值** (页面 2 / 宿主 3);
//    busy 不记失败、成功清零连败、连败上限钉 3
// ⑤ 两处上限同值, 且不越过上游 (120 s / 8 MiB), 节拍同值 (1500 ms)
// ⑥ 超长分支不再回旧拒绝; 草稿只认整段转写, **兜底与迟到的整段不许双写** (voiceLanded + 抬号),
//    同步被拒也要把实时层那句接住并说出原因

// ① 实时层: 节点 / 无障碍 / 两行封顶 / 挂在录音条里波形行下面 / 显隐的真机制 / 逐格追加 / 预览小字
expect('client.js', client, "els.recLive = h('div', 'lwp-rec-live')")
expect('client.js', client, "els.recLive.id = 'lwp-voice-live'")
expect('client.js', client, "els.recLive.setAttribute('aria-live', 'polite')")
expect('client.js', client, "els.recLive.setAttribute('role', 'log')")
expect('client.js', client, "'#lwp-voice-live{position:fixed;left:12px;right:12px;bottom:var(--lwp-live-bottom,140px);z-index:9;'")
expect('client.js', client, 'font-size:15px;line-height:21px;letter-spacing:.01em;color:rgba(255,255,255,.97);')
expectOrder('实时层挂在波形行下面', client, 'els.rec.appendChild(els.recWaveRow)', 'els.rec.appendChild(els.recLive)')
expect('client.js', client, 'function paintRecLive')
expect('client.js', client, 'els.recLive.scrollTop = els.recLive.scrollHeight')
// 预览那一行小字 (审查 ⑪): 3 s 硬切不带重叠, 不写这句人会逐字比对, 以为丢字
expect('client.js', client, "var REC_LIVE_NOTE = '实时文字 · 以松手后的整段为准'")
expect('client.js', client, 'els.recLiveNote = h(\'div\', \'lwp-rec-live-note\', REC_LIVE_NOTE)')
expect('client.js', client, "'.lwp-rec-live-note{flex:none;font-size:10.5px;line-height:14px;letter-spacing:.02em;'")
// 两行封顶 = 2 × 18px 行高: 再多也不许把录音条撑高 (只往上滚)
if (client.includes("'#lwp-voice-live{position:fixed;")
  && client.includes('max-height:132px;overflow-y:auto;overscroll-behavior:contain;pointer-events:none;')) {
  notes.push('ok   实时层浮在录音条上方 (position:fixed, 132px 封顶, 只往上滚)')
} else {
  failures.push('client.js: 实时层不再是浮在录音条上方的那一层 (position:fixed + 132px 上限)')
}
// 显隐真机制: 记号 (applyRecLive 写 data-live) + CSS 只认它 + 钮只调 applyRecLive —— 三处少一处就红
const applyLiveSource = sliceFunction('applyRecLive')
const recLiveToggle = sliceFunction('toggleRecLive')
if (applyLiveSource === '' || recLiveToggle === '') {
  failures.push('client.js: 抽不出 applyRecLive / toggleRecLive (显隐机制那一段)')
} else if (!applyLiveSource.includes("setAttribute('data-live', voiceLiveOn ? 'on' : 'off')")
  || !client.includes("'#lwp-rec[data-live=\"off\"] #lwp-voice-live{display:none}'")
  || !recLiveToggle.includes('applyRecLive()')) {
  failures.push('client.js: 显隐机制链断了 —— data-live 记号 / CSS 藏层的规则 / 钮调 applyRecLive 少一处')
} else {
  notes.push('ok   显隐真机制: applyRecLive 写 data-live, CSS 按它藏这一层, 钮只调 applyRecLive')
}
// 逐格追加 (审查 ⑩): 每块一格 span, 读屏只念新加的那几个字; 整段那份才整句重画
const appendLiveSource = sliceFunction('appendRecLive')
const chunkAnswerSource = sliceFunction('voiceChunkAnswer')
if (appendLiveSource === '' || chunkAnswerSource === '') {
  failures.push('client.js: 抽不出 appendRecLive / voiceChunkAnswer (实时层的两条写路)')
} else if (!appendLiveSource.includes("appendChild(h('span', 'lwp-live-part'")
  || !appendLiveSource.includes('voiceLiveJoin(voiceLiveText, text)')
  || !chunkAnswerSource.includes('appendRecLive(')
  || chunkAnswerSource.includes('paintRecLive(')) {
  failures.push('client.js: 实时层不是逐格追加 —— 每 1.5 s 整段重写会让读屏反复念同一句')
} else {
  notes.push('ok   实时层逐格追加 (role=log 只念增量, 整段那份才整句重画)')
}
// 转写中波形让位给三个点, 但实时文字**留着**: 松手那一刻屏上还看得见那句话
if (client.includes("'#lwp-rec[data-busy=\"on\"] .lwp-rec-wave-row{display:none}'")
  && !client.includes('#lwp-rec[data-busy="on"] #lwp-voice-live{display:none}')) {
  notes.push('ok   转写中实时层仍留着 (波形那一行让位, 文字不闪掉)')
} else {
  failures.push('client.js: 转写中把实时层藏了 —— 松手那一刻屏上就看不到那句话了')
}

// ② 显隐钮: 波形行右侧一颗 24px, 点波形本身也是同一件事; **只切那一层, 录音一动不动**
const recLiveWire = sliceFunction('wireRecLiveToggle')
if (recLiveWire === '') {
  failures.push('client.js: 抽不出 wireRecLiveToggle (显隐开关的接线)')
} else if (/stopRecording|releaseVoiceCapture|voiceState\s*=|voiceStream\s*=/u.test(recLiveToggle)) {
  failures.push('client.js: 显隐钮碰到了录音态 —— 它只许切那一层文字, 不许停录 / 释放采集')
} else {
  notes.push('ok   显隐钮只切文字层 (toggleRecLive 不碰录音 / 不释放采集 / 不改 voiceState)')
}
expect('client.js', client, "els.recLiveBtn = h('button', 'lwp-rec-live-btn')")
if (client.includes("'.lwp-rec-live-btn{display:grid;place-items:center;flex:none;align-self:center;width:24px;height:24px;'")) {
  notes.push('ok   显隐钮是 24px 的圆钮 (贴波形行右侧)')
} else {
  failures.push('client.js: 显隐钮的尺寸不是 24px')
}
expectOrder('波形行与那颗钮共用一个 handler', recLiveWire, 'var onTapLive = function', "els.recWave.addEventListener('pointerup', onTapLive)")
expect('client.js', client, "els.recWave.addEventListener('pointerup', onTapLive)")
expect('client.js', client, "els.recLiveBtn.addEventListener('click', onTapLive)")
expectOrder('那颗钮的 handler 里真的切了层', recLiveWire, 'var onTapLive = function', 'toggleRecLive()')
// **收起态不许收事件** (审查 ①): 条子收起只是 opacity:0, 命中区还在输入卡顶上就点不进输入框 ——
// 钮与波形默认 `pointer-events:none`, 只有 `[data-on="on"]` (条子升起来) 才 auto.
// 第三轮补反向断言 (审查 B2): 光查"有没有那两条 auto 行"挡不住有人在别处补一条同义规则
// (specificity 更高、pointer-events 又是继承属性, 收起态命中区原样回来)
// **#F10 判据单第四轮: 不数行, 数规则.** 数行有两处躲得过 —— 同义规则写在**同一行**上行数不变;
// 就算抽成规则, 往那条规则的选择器表里**加一条不带闸的选择器**也是全绿 (选择器表命中任意一条就生效).
// 所以从 client.js 里抽出所有 CSS 规则, 要求: 命中小录条三兄弟且声明 `pointer-events:auto` 的规则
// **恰好 1 条**, 而且它的**每一条**选择器都从 `#lwp-rec[data-on="on"]` 起头
const waveRule = grab(client, /'\.lwp-rec-wave\{([^']*)'/u) ?? ''
const waveRowRule = grab(client, /'\.lwp-rec-wave-row\{([^']*)'/u) ?? ''
const liveBtnRule = /'\.lwp-rec-live-btn\{[\s\S]{0,240}?pointer-events:none/u.test(client)
// 规则抽法: 先把 CSS 数组那些 `',\n      '` 的拼接缝抹平 (数组是 join('') 进去的), 再去掉注释,
// 剩下的 `选择器{声明}` 就是真规则
const flatCss = client
  .replace(/\/\*[\s\S]*?\*\//gu, '')
  .replace(/^\s*\/\/.*$/gmu, '')
  .replace(/',\s*\n\s*'/gu, '')
const cssRules = []
{
  const rulePattern = /([^{}]*)\{([^{}]*)\}/gu
  for (;;) {
    const one = rulePattern.exec(flatCss)
    if (one === null) break
    cssRules.push({ selector: one[1], body: one[2] })
  }
}
const REC_HIT_CLASSES = ['.lwp-rec-wave-row', '.lwp-rec-wave', '.lwp-rec-live-btn']
const autoRules = cssRules.filter((rule) => /pointer-events\s*:\s*auto/u.test(rule.body)
  && REC_HIT_CLASSES.some((one) => rule.selector.includes(one)))
const autoParts = autoRules.length === 1
  ? autoRules[0].selector.split(',').map((one) => one.trim()).filter((one) => one !== '')
  : []
const autoGated = autoParts.length > 0 && autoParts.every((one) => one.startsWith('#lwp-rec[data-on="on"]'))
const autoCovers = autoRules.length === 1 && REC_HIT_CLASSES.every((one) => autoRules[0].selector.includes(one))
if (waveRule.includes('pointer-events:none') && liveBtnRule && waveRowRule.includes('pointer-events:none')
  && autoRules.length === 1 && autoGated && autoCovers) {
  notes.push(`ok   收起态不收事件: 三兄弟默认 none, 命中它们的 pointer-events:auto 规则恰好 1 条`
    + ` (${String(autoParts.length)} 条选择器, 每条都带 data-on="on" 的闸)`)
} else {
  const why = autoRules.length !== 1
    ? `命中三兄弟的 auto 规则有 ${String(autoRules.length)} 条`
    : `那 1 条的选择器表里 ${autoGated ? '漏了' : '混进了不带闸的'}选择器: ${JSON.stringify(autoParts.join(' , '))}`
  failures.push(`client.js: 收起态命中区挡不住 —— ${why}`
    + ' (必须恰好 1 条规则, 且每条选择器都从 #lwp-rec[data-on="on"] 起头)')
}

// ③ `VOICE_CHUNK_MS = 0` 一块都不送 (回到整段转写): 节拍那条纯函数真跑 + 闸的次序与位置
const dueSource = sliceFunction('voiceChunkDue')
const pumpChunkSource = sliceFunction('pumpVoiceChunk')
const sendChunkSource = sliceFunction('sendVoiceChunk')
const joinSource = sliceFunction('voiceLiveJoin')
const draftTextSource = sliceFunction('voiceDraftText')
if (dueSource === '' || pumpChunkSource === '' || sendChunkSource === '' || joinSource === '' || draftTextSource === '') {
  failures.push('client.js: 抽不出 voiceChunkDue / pumpVoiceChunk / sendVoiceChunk / voiceLiveJoin / voiceDraftText')
} else {
  const due = new Function(`${dueSource}\nreturn voiceChunkDue`)()
  const dueCases = [
    ['关掉流式 (0) → 一块都不送', due(0, 9e9, 0), false],
    ['节拍没到 → 不送', due(1000, 2400, 1500), false],
    ['节拍到了 → 送', due(1000, 2500, 1500), true],
    ['这一趟还没送过 → 立刻送第一块', due(0, 5000, 1500), true],
  ]
  const wrongDue = dueCases.filter((one) => one[1] !== one[2]).map((one) => one[0])
  if (wrongDue.length === 0) {
    notes.push('ok   voiceChunkDue: 节拍 1500 ms 到点才送, VOICE_CHUNK_MS=0 时一块都不送')
  } else {
    failures.push(`voiceChunkDue: ${wrongDue.join(' / ')}`)
  }
  // 次序: 0 档的闸 → 背压 → 节拍 → 送块. 少一道或放错位置就等于没闸
  expectOrder('0 档的闸在送块之前', pumpChunkSource, 'if (!(VOICE_CHUNK_MS > 0)) return', 'sendVoiceChunk()')
  expectOrder('节拍闸也在送块之前', pumpChunkSource, 'if (!voiceChunkDue(', 'sendVoiceChunk()')
  expectOrder('背压在节拍之前', pumpChunkSource, 'VOICE_CHUNK_INFLIGHT_MAX) return', 'if (!voiceChunkDue(')
  // 采样一块都不剪: 剪了的话整段兜底就只剩尾巴 (审查 ⑥)
  if (/chunks\.splice\(/u.test(client) || /voiceChunks\.splice\(/u.test(client)) {
    failures.push('client.js: 还在剪采样 —— 整段那条路只剩尾巴, 前面几十秒的字会一起丢')
  } else {
    notes.push('ok   采样一块都不剪 (整段兜底拿得到从头到尾的声音)')
  }
  // 送块那条腿挂在 200 ms 的 ticker 上, 不只挂 rAF (切后台 rAF 会停而采样照走)
  if (client.includes('voiceTicker = setInterval(function () { paintRecTime(); pumpVoiceChunk() }, 200)')) {
    notes.push('ok   送块挂在 voiceTicker 的 200 ms 一拍上 (rAF 停了也照送)')
  } else {
    failures.push('client.js: 送块只挂 rAF —— 切后台就不出字了')
  }
  // 一块最多 3 s: 后台回来别把半分钟封成一个几十 MB 的 base64
  if ((Number(grab(client, /var VOICE_CHUNK_SLICE_MS = (\d+)/u)) || 0) === 3000
    && sendChunkSource.includes('VOICE_CHUNK_SLICE_MS / 1000')) {
    notes.push('ok   一块最多 3 s 的声音 (切片有上限, 后台回来按 3 s 一段追)')
  } else {
    failures.push('client.js: 送块没有切片上限 (后台回来会封一坨过桥)')
  }
  // 切块那条纯函数真跑 (审查 ⑫): cursor 必须**严格前进**且不超过已采到的样本 ——
  // 把推进量改成 `+= 0` 时同一段会被每 1.5 s 反复送, 只有真跑才拦得住
  const cutSource = sliceFunction('chunkCut')
  if (cutSource === '') {
    failures.push('client.js: 抽不出 chunkCut (切块与 cursor 推进那条纯函数)')
  } else {
    const chunkCut = new Function(`${cutSource}\nreturn chunkCut`)()
    const lengths = [4096, 4096, 4096, 4096]
    const first = chunkCut(lengths, 0, 6000)
    const rest = chunkCut(lengths, first.count, 6000)
    const over = chunkCut(lengths, lengths.length, 6000)
    const atEnd = first.count > 0 && first.count <= lengths.length
      && rest.count === lengths.length - first.count
      && over.count === 0 && over.samples === 0
      && chunkCut([], 0, 6000).count === 0
    if (atEnd && sendChunkSource.includes('chunkCut(lengths, voiceChunkCursor, want)')
      && sendChunkSource.includes('voiceChunkCursor += cut.count')) {
      notes.push(`ok   chunkCut: 每次推进 ${String(first.count)} 块 (${String(first.samples)} 样本), 到末尾回 0; 送块只用它推进 cursor`)
    } else {
      failures.push('client.js: 切块 / cursor 推进不对 (同一段会被反复送, 或者越界)')
    }
  }
  // **cursor 那一行右值必须真的往前推** (#F10 判据单): `includes()` 挡不住
  // `voiceChunkCursor += cut.count * 0` —— 字面一模一样, 同一段每 1.5 s 被重送一遍
  const cursorRhs = (grab(sendChunkSource, /voiceChunkCursor \+= ([^;\n]+)/u) ?? '').trim()
  const cursorStill = cursorRhs === ''
    || /^0+(?:\.0+)?$/u.test(cursorRhs)
    || /\*\s*0(?:\.0+)?$/u.test(cursorRhs)
  if (!cursorStill) {
    notes.push(`ok   cursor 每次送块都往前推 (${cursorRhs}), 同一段不会被反复送`)
  } else {
    failures.push(`client.js: 送块之后的 cursor 推进量是 ${JSON.stringify(cursorRhs)} —— 没有前进, 同一段会被每 1.5 s 重送`)
  }
  const join = new Function(`${joinSource}\nreturn voiceLiveJoin`)()
  const joinCases = [
    ['第一块', join('', '你好'), '你好'],
    ['接着接', join('你好', '世界'), '你好世界'],
    ['空块不动已有的字', join('你好', '  '), '你好'],
    ['两边都有空白就收掉', join('你好 ', ' 世界'), '你好世界'],
    ['英文两个词之间补一格', join('hello', 'world'), 'hello world'],
  ]
  const wrongJoin = joinCases.filter((one) => one[1] !== one[2]).map((one) => one[0])
  if (wrongJoin.length === 0) {
    notes.push('ok   voiceLiveJoin: 只往后接字, 空块不写, 空白收掉')
  } else {
    failures.push(`voiceLiveJoin: ${wrongJoin.join(' / ')}`)
  }
  const draftText = new Function(`${draftTextSource}\nreturn voiceDraftText`)()
  if (draftText('先说的那几个字', '整段那一句') === '整段那一句'
    && draftText('先说的那几个字', '  ') === '先说的那几个字'
    && draftText('', '') === '') {
    notes.push('ok   voiceDraftText: 整段那份最准, 它空了才退回实时层那份')
  } else {
    failures.push('voiceDraftText: 草稿取哪一份不对')
  }
}

// ④ 块的几条硬约束: 认 generation / 不抬 generation / 失败块分得开 / 两侧都有背压
const chunkFn = /fun voiceChunk\([\s\S]*?\n    \}\n/u.exec(portalVoice)?.[0] ?? ''
if (chunkFn === '') {
  failures.push('PortalVoice.kt: 抽不出 fun voiceChunk (流式那一块)')
} else {
  if (!chunkFn.includes('val token = generation.get()') || !chunkFn.includes('token != generation.get()')) {
    failures.push('PortalVoice.kt: voiceChunk 没有比 generation —— 取消之后旧块还会回写实时层')
  } else {
    notes.push('ok   PortalVoice.kt: 块回来先比 generation, 对不上就丢')
  }
  if (chunkFn.includes('incrementAndGet')) {
    failures.push('PortalVoice.kt: voiceChunk 抬了 generation —— 在途的下一块全成"过时", 实时层会缺字')
  } else {
    notes.push('ok   PortalVoice.kt: 块不抬 generation (抬只有 transcribe / cancel 两处)')
  }
  expectOrder('先比 generation 再回推', chunkFn, 'token != generation.get()', 'done(')
  if (chunkFn.includes('"chunk=" + seq')) {
    notes.push('ok   PortalVoice.kt: 每块落一行 Log.i chunk=N (真机读数认它, 90 s 应到 N ≥ 40)')
  } else {
    failures.push('PortalVoice.kt: 块没有落 chunk=N 那行日志')
  }
  // 宿主侧的背压: 在途的块判重 (同一块重发只认一次), 太深就回 busy —— 页面据此这一拍不送
  if (chunkFn.includes('pendingChunks') && chunkFn.includes('"busy"') && chunkFn.includes('MAX_PENDING_CHUNKS')) {
    notes.push('ok   PortalVoice.kt: 块有 pending 判重, 太深回 busy (不往单线程队列里继续压)')
  } else {
    failures.push('PortalVoice.kt: 块没有 pending 判重 / busy 回执 —— 一串块会排队排到松手之后')
  }
  // **阈值要钉取值** (审查 B4): 只查符号名的话 3 改成 99 也全绿, 那道闸等于不存在
  // #F10 判据单: 换成**读常量那一行**再取值 —— 全文正则会连注释里举的例子一起抓, 注释写 `= 3`、
  // 代码写 `= 99` 时那种抓法照样绿
  const hostPendingLine = (portalVoice.split('\n').find((line) => /const val MAX_PENDING_CHUNKS\b/u.test(line)) ?? '').trim()
  const jsInflightLine = (client.split('\n').find((line) => /var VOICE_CHUNK_INFLIGHT_MAX\s*=/u.test(line)) ?? '').trim()
  const hostPending = Number(grab(hostPendingLine, /const val MAX_PENDING_CHUNKS\s*(?::\s*Int)?\s*=\s*(\d+);?$/u))
  const jsInflight = Number(grab(jsInflightLine, /var VOICE_CHUNK_INFLIGHT_MAX\s*=\s*(\d+);?$/u))
  if (hostPending === 3 && jsInflight === 2 && jsInflight < hostPending) {
    notes.push('ok   背压阈值钉住取值: 页面在途 2 / 宿主在途 3 (页面先停, 宿主那一侧才有余量)')
  } else {
    failures.push(`背压阈值不对: 页面=${String(jsInflight)} 宿主=${String(hostPending)}`
      + ` (应当 2 / 3, 且页面 < 宿主; 读的是 ${JSON.stringify(jsInflightLine)} / ${JSON.stringify(hostPendingLine)})`)
  }
  // **调用点必须用这个常量** (#F10 判据单): 常量对了但闸上写死 `>= 2`, 改常量等于没改
  const inflightAtCallSite = /voiceChunkSeq\s*-\s*voiceChunkSeen\s*>=\s*VOICE_CHUNK_INFLIGHT_MAX/u.test(pumpChunkSource)
  const inflightLiteral = /voiceChunkSeq\s*-\s*voiceChunkSeen\s*>=\s*\d/u.test(pumpChunkSource)
  if (inflightAtCallSite && !inflightLiteral) {
    notes.push('ok   背压那道闸读的是 VOICE_CHUNK_INFLIGHT_MAX 这个常量 (不是写死的数字)')
  } else {
    failures.push('client.js: 背压的调用点用了字面量 (或者压根没有这道闸) —— 改 VOICE_CHUNK_INFLIGHT_MAX 等于没改')
  }
  // 宿主那条单测: **取值**要用 assertEquals 钉着; `assertTrue(x >= 2)` 那种改成 99 也全绿
  const voiceTest = read('app/src/test/java/io/github/yuloong07star/luwi/ui/PortalVoiceTest.kt')
  const pendingPinned = /assertEquals\(\s*3\s*,\s*PortalVoice\.MAX_PENDING_CHUNKS\s*\)/u.test(voiceTest)
  const pendingLoose = /MAX_PENDING_CHUNKS\s*>=\s*\d/u.test(voiceTest)
  if (pendingPinned && !pendingLoose) {
    notes.push('ok   PortalVoiceTest 用 assertEquals 钉住 MAX_PENDING_CHUNKS 的取值 (不是 >= 2 那种)')
  } else {
    failures.push('PortalVoiceTest.kt: MAX_PENDING_CHUNKS 没有用 assertEquals 钉取值 —— 改成 99 也全绿')
  }
  // 失败块带 `failed`: 与"认出空串"不再同形 (审查 ⑤)
  if (chunkFn.includes('put("failed", true)')) {
    notes.push('ok   PortalVoice.kt: 失败块带 failed 标记 (与空串分得开)')
  } else {
    failures.push('PortalVoice.kt: 失败块没带 failed 标记 —— 页面分不清"认失败"与"没说话"')
  }
}
// 页面对这几格回执的处理: busy 只跳过一拍, failed 只记一笔, 都不许关流式之外乱写
if (pumpChunkSource === '' || sendChunkSource === '' || sliceFunction('voiceChunkAnswer') === '') {
  failures.push('client.js: 抽不出 pumpVoiceChunk / sendVoiceChunk / voiceChunkAnswer')
} else {
  const chunkAnswerSource = sliceFunction('voiceChunkAnswer')
  if (sendChunkSource.includes("answer.code === 'busy'")) {
    notes.push('ok   client.js: 宿主回 busy 时这一拍不送, 也不算失败')
  } else {
    failures.push('client.js: 没认宿主的 busy 回执 —— 忙时会被当成"宿主不支持"而关掉流式')
  }
  // busy 支**不许记失败** (审查 ⑦): 宿主稍慢就连着三次 busy, 记了失败就把流式关了
  // (只截 busy 那一支: 后面那段"宿主不认这一块"本来就该关流式)
  const busyAt = sendChunkSource.indexOf("answer.code === 'busy'")
  const busyEnd = busyAt < 0 ? -1 : sendChunkSource.indexOf('\n        }', busyAt)
  const busySlice = busyAt < 0 || busyEnd < 0 ? '' : sendChunkSource.slice(busyAt, busyEnd)
  if (busySlice !== '' && busySlice.includes('return false')
    && !busySlice.includes('voiceChunkFails') && !busySlice.includes('voiceStreamOff')) {
    notes.push('ok   busy 支只跳过一拍: 不记失败, 也不关流式')
  } else {
    failures.push('client.js: busy 支记了失败 / 关了流式 —— 宿主慢一点实时层就没了')
  }
  // busy 支**一个字都不许给连败记账** (#F10 判据单点名的那一下): 宿主稍慢就连着三次 busy,
  // 记了失败就把流式关了 —— 这里单独认 `voiceChunkFails +=` 这个形态, 别只靠上面那条复合条件
  const busyBumpsFails = /voiceChunkFails\s*\+=/u.test(busySlice)
  if (busySlice !== '' && !busyBumpsFails) {
    notes.push('ok   busy 支没有 `voiceChunkFails +=` (宿主慢不折成连败)')
  } else {
    failures.push('client.js: busy 支给连败记账了 —— 宿主慢一点就把流式关掉')
  }
  // 连败那条: 阈值钉 3、比较式是 >=、成功一块要清零 (审查 ⑧: 注释写"连着", 实际是累计)
  // #F10: 取值改成读常量那一行 (全文正则抓不到"注释里 3 / 代码里 99"这种)
  const failMaxLine = (client.split('\n').find((line) => /var VOICE_CHUNK_FAIL_MAX\s*=/u.test(line)) ?? '').trim()
  const failMax = Number(grab(failMaxLine, /var VOICE_CHUNK_FAIL_MAX\s*=\s*(\d+);?$/u))
  const failAt = chunkAnswerSource.indexOf('voiceChunkFails += 1')
  const failSlice = failAt < 0 ? '' : chunkAnswerSource.slice(failAt, failAt + 160)
  const okResetAt = chunkAnswerSource.lastIndexOf('voiceChunkFails = 0')
  if (failMax === 3 && failSlice.includes('>= VOICE_CHUNK_FAIL_MAX')
    && okResetAt > chunkAnswerSource.indexOf('payload.failed === true')) {
    notes.push('ok   连败上限钉 3, 比较式 >=, 成功一块就把连败清零')
  } else {
    failures.push(`连败兜底不对: 上限=${String(failMax)} 比较式/清零有一处不对 (改了也全绿等于没这条)`)
  }
  if (pumpChunkSource.includes('voiceChunkSeq - voiceChunkSeen >= VOICE_CHUNK_INFLIGHT_MAX')) {
    notes.push('ok   页面这侧的背压在送块之前 (在途超过 2 块不再送)')
  } else {
    failures.push('client.js: 页面没有背压 —— 块比认得快就会一路排队')
  }
}
expect('PortalBridge.kt 认流式那一块', portalBridge, '"voice-chunk" -> PortalVoice.voiceChunk(')
expect('PortalBridge.kt 块也走同一条回推', portalBridge, '{ answer -> pushVoice(answer) }')

// ⑤ 上限: 两侧同值, 而且**不越过上游** (LwDeepseekAsr 的 120 s / 8 MiB); 节拍也同值
const deepAsr = read('app/src/main/java/io/github/yuloong07star/luwi/tool/LwDeepseekAsr.kt')
const jsVoiceMaxS = Number(grab(client, /var VOICE_MAX_MS = (\d+) \* 1000/u))
const ktVoiceMaxS = Number(grab(portalVoice, /const val MAX_SECONDS = (\d+)/u))
const upVoiceMaxS = Number(grab(deepAsr, /const val MAX_SECONDS = (\d+)/u))
const jsChunkMs = Number(grab(client, /var VOICE_CHUNK_MS = (\d+)/u))
const ktChunkMs = Number(grab(portalVoice, /const val VOICE_CHUNK_MS = (\d+)/u))
if (jsVoiceMaxS === ktVoiceMaxS && ktVoiceMaxS === upVoiceMaxS && upVoiceMaxS === 120) {
  notes.push('ok   语音上限三处同一个数 (120 s: client / PortalVoice / LwDeepseekAsr)')
} else {
  failures.push(`语音上限对不上: 页面=${String(jsVoiceMaxS)}s 宿主=${String(ktVoiceMaxS)}s 上游=${String(upVoiceMaxS)}s`)
}
const ktMaxBytes = (Number(grab(portalVoice, /const val MAX_BYTES = (\d+) \* 1024 \* 1024/u)) || 0) * 1024 * 1024
const upMaxBytes = (Number(grab(deepAsr, /const val MAX_BYTES = (\d+) \* 1024 \* 1024/u)) || 0) * 1024 * 1024
if (ktMaxBytes > 0 && ktMaxBytes === upMaxBytes && upMaxBytes === 8 * 1024 * 1024) {
  notes.push('ok   字节上限与上游同档 (8 MiB): 120 s 的合成音频 3.84 MB 落在里面')
} else {
  failures.push(`字节上限越过上游: 宿主=${String(ktMaxBytes)} 上游=${String(upMaxBytes)}`)
}
if (jsChunkMs === ktChunkMs && jsChunkMs === 1500) {
  notes.push('ok   流式节拍两侧同一个数 (1500 ms)')
} else {
  failures.push(`流式节拍对不上: 页面=${String(jsChunkMs)}ms 宿主=${String(ktChunkMs)}ms`)
}

// ⑥ 草稿只认整段转写; 「60 秒以内再说」与滚段那一路都不许回来
if (!client.includes('60 秒以内再说') && !portalVoice.includes('60 秒以内再说')) {
  notes.push('ok   两侧都不再有「60 秒以内再说」那句拒绝')
} else {
  failures.push('还留着「60 秒以内再说」—— 说 90 秒不该被一句拒绝打回去')
}
for (const gone of ['VOICE_SEGMENT_MS', 'commitVoiceSegment', 'commitVoiceLive', 'pumpVoiceSegment']) {
  if (client.includes(gone)) {
    failures.push(`client.js: 还留着滚段那一路 ${JSON.stringify(gone)} —— 它会把草稿改成切片拼接`)
  } else {
    notes.push(`ok   滚段那一路已经撤干净 (${gone})`)
  }
}
const stopSource = sliceFunction('stopRecording')
if (stopSource.includes("op: 'transcribe'") && !stopSource.includes("op: 'voice-chunk'")) {
  notes.push('ok   松手只走整段转写 (op=transcribe), 流式开没开都是这一条')
} else {
  failures.push('client.js: 松手那条路被流式改过 —— 草稿必须来自整段那次转写')
}
const watchSource = sliceFunction('armVoiceWatch')
if (watchSource.includes('take !== voiceId') && watchSource.includes('toast(')) {
  notes.push('ok   看门狗只认这一趟, 兜底落草稿时明说"这是实时层那句"')
} else {
  failures.push('client.js: 看门狗跨趟能动手 / 或者在兜底时静默落草稿')
}
// **兜底与迟到的整段不许双写** (审查 B1): 兜底那一支落完就抬号 + 记 voiceLanded,
// 整段分支进来先看 voiceLanded —— 少一处, 45 s 之后同一句会进草稿两遍
const answerSource = sliceFunction('voiceAnswer')
const bumpAt = watchSource.indexOf('voiceId += 1')
const landedAt = watchSource.indexOf('voiceLanded =')
const hideAt = watchSource.indexOf('hideRecPanel()')
if (bumpAt < 0 || landedAt < 0 || hideAt < 0 || bumpAt > hideAt || landedAt > hideAt
  || !answerSource.includes('if (voiceLanded)')) {
  failures.push('client.js: 兜底那一支没有作废这一趟 —— 迟到的整段会在草稿里把同一句写两遍')
} else {
  notes.push('ok   兜底落草稿即作废这一趟 (抬号 + voiceLanded), 迟到的整段一个字都不写')
}
// 同步被拒 (桥抛错 / 录音解不开 / 太长) 也要把刚认出来的字接住, 并说出宿主那句原因 (审查 ⑤)
if (stopSource.includes('answer.error') && stopSource.includes('voiceDraftText(voiceLiveText')
  && /answer === null \|\| answer\.ok !== true[\s\S]{0,700}?insertDraft\(held\)/u.test(stopSource)) {
  notes.push('ok   同步被拒: 实时层那句先落草稿, 原因照宿主那一句说出来')
} else {
  failures.push('client.js: 同步被拒时把实时层丢了 / 吞了 answer.error —— 屏上刚认出来的字全没了')
}
// 计时那条 (审查遗留清单里点过): 90 s 要写 1:30, 不许写 0:90
const clockSource = sliceFunction('clockOf')
if (clockSource === '') {
  failures.push('client.js: 抽不出 clockOf (计时胶囊的换算)')
} else {
  const clockOf = new Function(`${clockSource}\nreturn clockOf`)()
  const clocks = [[0, '0:00'], [3, '0:03'], [59, '0:59'], [90, '1:30'], [120, '2:00']]
  const wrongClocks = clocks.filter((one) => clockOf(one[0]) !== one[1]).map((one) => `${one[0]}s→${clockOf(one[0])}`)
  if (wrongClocks.length === 0 && sliceFunction('paintRecTime').includes('clockOf(seconds)')) {
    notes.push('ok   clockOf: 90 s 写 1:30 (计时胶囊不再出 0:90), paintRecTime 走它')
  } else {
    failures.push(`计时换算不对: ${wrongClocks.join(' / ')}`)
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




