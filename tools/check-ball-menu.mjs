/**
 * 「换个形象」与「看余额」这两行的判据 (2026-10-16)
 *
 * 这一条横着四处接缝, 每一处**漂开了都不会报错**, 只会在主人点下去那一刻变成"看起来没反应":
 *
 *   1. **名字与顺序两份一致**: 新键进了两份 strings.xml (en 与 zh), 键与顺序都得对上
 *   2. **文本框那三档分得开**: 余额走 `¥` 那一档, 它**不许**碰那三笔会话账 (双击回复框与「返回应用」
 *      的去向是 2026-10-09/11 两轮定下来的口径, 不能因为看了一眼余额就变)
 *   3. **文件字段两侧一致**: `balance.json` 那几个键应用与宿主各写一份约定 (与 ball-phase.json 同一条
 *      规矩), 还要校验签名清单之外的 sha256; 两个窗口数 (旧值 5 分钟 / 请求记号 30 s) 谁都不许单边改
 *   4. **候选只有一份口径**: 设置页那份对话框与球菜单那行「换个形象」都认 `BallTheme.choices`
 *   5. **余额两条触发** (2026-11-01 深夜改口径): 每轮对话结束覆盖缓存 (seq 0, 只动文件不进框) 与
 *      主人点「看余额」(先给上次那份, 同时发一问); 应用上屏按 seq 认答案, 框已经被关掉也会张回来 ——
 *      三处缺一个, 要么结果消失, 要么那一行会自己长在回答后面
 *
 * 不需要设备: 全是拿真源码对着核 (与 `check-image-edit.mjs` 同一个办法)。
 *
 * 用法: node tools/check-ball-menu.mjs
 */

import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')

const src = (name) => `app/src/main/java/io/github/yuloong07star/luwi/${name}`
const overlay = await read(src('overlay/OverlayService.kt'))
const box = await read(src('overlay/BoxView.kt'))
const balance = await read(src('overlay/BalanceFile.kt'))
const ball = await read(src('overlay/Ball.kt'))
const theme = await read(src('plugin/theme/BallTheme.kt'))
const settings = await read(src('ui/SettingsScreen.kt'))
const lwOverlay = await read(src('tool/LwOverlay.kt'))
const plugin = await read('host-plugin/index.mjs')
const en = await read('app/src/main/res/values/strings.xml')
const zh = await read('app/src/main/res/values-zh/strings.xml')

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

/* ── 一、字符串两份一致 (键与顺序) ─────────────────────────────────────── */

const KEYS = [
  'ball_menu_theme',
  'ball_theme_builtin',
  'ball_menu_balance',
  'ball_balance_line',
  'ball_balance_line_by',
  'ball_balance_quota_line',
  'ball_balance_quota_line_by',
  'ball_balance_bonus',
  'ball_balance_just_now',
  'ball_balance_minutes',
  'ball_balance_pending',
  'ball_balance_failed',
]
const keysOf = (text) => [...text.matchAll(/name="(ball_[a-z_]+)"/g)].map((one) => one[1])
const enBall = keysOf(en)
const zhBall = keysOf(zh)
check('两份 strings 里 ball_* 的键与顺序完全一致', enBall, zhBall)
for (const key of KEYS) {
  check(`新键 ${key} 两份都有`, [enBall.includes(key), zhBall.includes(key)], [true, true])
}
check(
  '带参数的串占位符对得上 (不带裸 %, 那条会崩主线程)',
  [
    en.includes('name="ball_menu_theme">Change look · %1$s<'),
    zh.includes('name="ball_menu_theme">换个形象 · %1$s<'),
    en.includes('name="ball_balance_minutes">%1$d min ago<'),
    zh.includes('name="ball_balance_minutes">%1$d 分钟前<'),
    // 额度那一档的 % 是字面百分号: 两份都得写 %%, 裸 % 会让 Resources 抛异常打死主线程
    en.includes('name="ball_balance_quota_line_by">%1$s quota left %2$d%% · %3$s<'),
    zh.includes('name="ball_balance_quota_line_by">%1$s 额度剩余 %2$d%% · %3$s<'),
  ],
  [true, true, true, true, true, true],
)

/* ── 二、文本框那一档: 余额走 ¥, 三笔会话账一个都不许碰 ────────────────── */

const appendInfo = box.slice(box.indexOf('fun appendInfo('), box.indexOf('fun replaceInfo('))
const replaceInfo = box.slice(box.indexOf('fun replaceInfo('), box.indexOf('private fun render('))
check('文本框多了 ¥ 那一档 (appendInfo / replaceInfo)', [appendInfo.length > 0, replaceInfo.length > 0], [true, true])
check(
  '信息行不进会话账 (replySession / inputSession / boxSession / pendingReply 都不许出现)',
  [appendInfo.includes('OverlayState'), replaceInfo.includes('OverlayState')],
  [false, false],
)
check(
  '菜单里那两行都在, 而且余额走的是本地信息那条路',
  [
    overlay.includes('R.string.ball_menu_theme'),
    overlay.includes('R.string.ball_menu_balance'),
    overlay.includes('private fun showLocalInfo(text: String)'),
    overlay.includes('boxView?.appendInfo(text)'),
    overlay.includes('boxView?.replaceInfo(balanceLine(snapshot))'),
  ],
  [true, true, true, true, true],
)
// 那一道闸 2026-10-17 加的 (主人: 「余额查询只能用户主动在 ball 菜单主动查询」), 2026-11-01 深夜改成
// **按 seq 认答案**: 宿主每轮结束也会覆盖缓存 (seq 0), 那一份不该自己上屏; 而主人真点过的那一问迟到的
// 答案 (宿主在重启时可能晚十几秒) 反而必须上屏 —— 所以闸从"30 s 窗口"换成"这一问的编号"
const readBalance = overlay.slice(
  overlay.indexOf('private fun readBalance()'),
  overlay.indexOf('private fun balanceLine('),
)
check(
  '文件到了也不许多长一行: 按 seq 认答案, 只有主人点过的那一问才上屏',
  [
    readBalance.includes('snapshot.seq != balanceAskedSeq'),
    readBalance.includes('balanceShownSeq'),
    // 关掉的框也要拿到答案: 张回来给主人看, 而不是让结果消失
    readBalance.includes('if (!boxOnScreen) openChannel(focus = false)'),
    // 「正在取…」被真数顶掉那一条仍在 (点菜单那条路照旧, 屏上不会留两行)
    readBalance.includes('replaceInfo(balanceLine(snapshot))'),
  ],
  [true, true, true, true],
)

// B1-b (2026-11-01): 点「看余额」那一拍分四档 —— 旧值先上屏再问、没有数就是「正在取」、失败那一行
// 本身就是重试的入口 (新 seq + force)、「不支持」是稳定事实不进重试. 判据落在 `BalanceFile.decide`
// 那个纯函数上 (单测在 `BalanceFileTest`), 这里只钉"服务那一侧真的接上了"
// 2026-11-02 主人改口径: 那一行只给余额 + 时间, 「正在刷新…」「正在重试…」两句都不上屏 (键也删了)
check(
  '「看余额」四档都接上了, 失败那一行就是重试的入口, 两档都不挂说明 (B1-b ⑤~⑧)',
  [
    overlay.includes('BalanceFile.decide('),
    overlay.includes('R.string.ball_balance_refreshing'),
    overlay.includes('R.string.ball_balance_retry'),
    overlay.includes('balanceAskedSeq = BalanceFile.request(this, force = decision.force)'),
    balance.includes('Decision(Ask.RETRY, snapshot, request = true, force = true)'),
    balance.includes('Ask.UNSUPPORTED'),
  ],
  [true, false, false, true, true, true],
)

// B1-c (2026-11-01): ⑨ 5 分钟窗口仍在 —— 它现在只决定要不要再发后台那一问.
// **上屏不标旧** (2026-11-02 主人: "不要显示'当前不是最新''正在刷新'这样的句子, 只告诉我余额+时间"):
// 那一行只有余额 + 「N 分钟前」, 三句说明的键一份都不许留
const balanceLine = overlay.slice(
  overlay.indexOf('private fun balanceLine('),
  overlay.indexOf('private fun balanceAge('),
)
check(
  '旧值 5 分钟窗口还在, 但那一行不再标旧 (B1-c ⑨ + 2026-11-02 改口径)',
  [
    balance.includes('fun isOld(at: Long'),
    balance.includes('const val FRESH_MS = 5 * 60_000L'),
    overlay.includes('private val BALANCE_FRESH_MS = BalanceFile.FRESH_MS'),
    overlay.includes('BalanceFile.decide(BalanceFile.snapshot(this), balanceAskedAt, balanceAskedSeq, BALANCE_FRESH_MS, now)'),
    balanceLine.includes('BalanceFile.isOld(snapshot.at)'),
    balanceLine.includes('R.string.ball_balance_stale'),
    en.includes('name="ball_balance_stale"'),
    zh.includes('name="ball_balance_stale"'),
  ],
  [true, true, true, true, false, false, false, false],
)

// 2026-11-02 主人: 只显示最近余额 + 时间. 钉住"上屏那一行只有 balanceLine 一个来源" ——
// FRESH 与 OLD 两档都是 `showBalanceInfo(balanceLine(it))`, 后面不接任何一句; 连点几次也只留一行
const showBalance = overlay.slice(
  overlay.indexOf('private fun showBalance()'),
  overlay.indexOf('private fun balanceFailure('),
)
const showBalanceInfo = overlay.slice(
  overlay.indexOf('private fun showBalanceInfo('),
  overlay.indexOf('private fun showLocalInfo('),
)
check(
  '看余额那一行只有余额 + 时间, 旧值与失败两档都不挂说明',
  [
    (showBalance.match(/showBalanceInfo\(balanceLine\(it\)\)/gu) ?? []).length,
    showBalanceInfo.includes('boxView?.replaceInfo(text)'),
    // 屏上已经有数时, pending / 失败 / 无回音一律不吭声 (2026-11-02)
    showBalance.includes('if (!balanceShownMoney)'),
    readBalance.includes('if (balanceShownMoney) return'),
    // 真机 A 上 inotify 不叫醒: tick 那一拍拿 mtime 兜一眼, 不然新数永远上不了屏 (2026-11-02)
    overlay.includes('BalanceFile.file(this@OverlayService).lastModified()'),
    showBalance.includes('ball_balance_refreshing'),
    showBalance.includes('ball_balance_retry'),
    showBalance.includes('ball_balance_stale'),
  ],
  [2, true, true, true, true, false, false, false],
)

/* ── 三、文件约定两侧一致 (字段 + 两个窗口数) ─────────────────────────── */

/** 应用侧认的是带引号的键 (JsonPrimitive), 宿主侧写的是对象字面量的裸键 —— 两份写法各验各的 */
const HOST_KEYS = {
  '"at"': 'at: now',
  '"ok"': 'ok: false',
  '"unsupported"': 'unsupported: false',
  '"provider"': "provider: ''",
  '"label"': "label: ''",
  '"model"': "model: ''",
  '"kind"': "kind: ''",
  '"currency"': "currency: ''",
  '"value"': "value: ''",
  '"bonus"': "bonus: ''",
  '"percent"': 'percent: 0',
  '"reason"': "reason: ''",
}
for (const [field, literal] of Object.entries(HOST_KEYS)) {
  check(`balance.json 的 ${field} 应用侧认得`, balance.includes(field), true)
  check(`balance.json 的 ${field} 宿主侧写得出`, plugin.includes(literal), true)
}
check(
  '两个窗口数谁都不许单边改 (旧值 5 分钟只在 BalanceFile, 应用只认那一份; 请求记号 30 s 两侧, 没回音 9 s 应用侧)',
  [
    balance.includes('const val FRESH_MS = 5 * 60_000L'),
    overlay.includes('BALANCE_FRESH_MS = BalanceFile.FRESH_MS'),
    overlay.includes('BALANCE_NO_ANSWER_MS = 9_000L'),
    plugin.includes('BALANCE_REQUEST_FRESH_MS = 30 * 1000'),
  ],
  [true, true, true, true],
)
check(
  '宿主侧原子写 (唯一临时名 + rename), 失败如实不编 0',
  [
    /async function refreshBalance[\s\S]{0,80}/.test(plugin),
    // 临时名自 2026-11-02 起是唯一的 (`${path}.<pid>.<n>.tmp`): 固定 `.tmp` 会让同一个文件的
    // 两个写者在 rename 上撞车 —— 先到的把临时文件搬走, 后到的报 ENOENT, 两边都以为自己成功了
    plugin.includes('const temporary = temporaryName(path)'),
    plugin.includes('await rename(temporary, path)'),
    plugin.includes("payload.reason = 'the DeepSeek account is not signed in on this host'"),
  ],
  [true, true, true, true],
)

/* ── 四、外观候选只有一份口径 ─────────────────────────────────────────── */

check(
  'BallTheme.choices / rotate / ring / parseColor 都在',
  [
    theme.includes('fun choices(context: Context)'),
    theme.includes('fun rotate(context: Context)'),
    theme.includes('fun ring(context: Context, state: String)'),
    theme.includes('fun parseColor(text: String?): Int?'),
  ],
  [true, true, true, true],
)
check(
  '设置页那份对话框与球菜单都认 choices (候选不再两处各列一份)',
  [
    settings.includes('BallTheme.choices(context).drop(1)'),
    !settings.includes('java.io.File(directory, "theme/ball.json")'),
  ],
  [true, true],
)
check(
  '半隐那一档喂进了球 (BallPet 的 peeked 才有得画)',
  [
    overlay.includes('ballView?.show(word, ring = ring, peeked = peeked)'),
    ball.includes('if (next == null && peeked) "peeked"'),
    theme.includes('rings: Map<String, Int>'),
  ],
  [true, true, true],
)
check(
  '读数里那两样报得出来 (lw_overlay op=state)',
  [lwOverlay.includes('put("theme"'), lwOverlay.includes('put("balanceAgeMs"')],
  [true, true],
)

/* ── 五、「看余额」查的是当前模型, 那一家从 DeepSeek 扩到主流厂商 (2026-10-17) ──── */

check(
  '宿主先认当前模型再认余额源 (agentDefaultModel.currentSelection + 那张表)',
  [
    plugin.includes("ctx.get('agentDefaultModel')"),
    plugin.includes('currentSelection()'),
    plugin.includes('const BALANCE_SOURCES = ['),
    plugin.includes("const ACCOUNT_ROUTES = ['deepseek-account']"),
    plugin.includes("const DEEPSEEK_ROUTES = ['deepseek-official', 'deepseek-account', 'deepseek']"),
    plugin.includes('DEEPSEEK_ROUTES.includes(provider)'),
  ],
  [true, true, true, true, true, true],
)
check(
  'DeepSeek 官方走它自己那把 key (它是 API Key 路线, 不是账号缝), 账号缝只当兜底',
  [
    plugin.includes("routes: ['deepseek-official', 'deepseek'],"),
    plugin.includes('function profileLabel(profile, fallback)'),
    plugin.includes('path.length === 0'),
    plugin.includes('await readAccountBalance(ctx, payload'),
    plugin.includes('this host holds no API key for ${provider}: ${problem}'),
  ],
  [true, true, true, true, true],
)
check(
  '主流那几家真在表里 (金额一档与额度一档各有)',
  [
    plugin.includes('https://api.deepseek.com/user/balance'),
    plugin.includes('https://api.moonshot.cn/v1/users/me/balance'),
    plugin.includes('https://openrouter.ai/api/v1/credits'),
    plugin.includes('https://api.stepfun.com/v1/accounts'),
    plugin.includes('https://api.novita.ai/v3/user/balance'),
    plugin.includes('https://api.ppio.com/openapi/v1/billing/balance/detail'),
    plugin.includes('https://open.bigmodel.cn/api/monitor/usage/quota/limit'),
    plugin.includes('https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains'),
  ],
  [true, true, true, true, true, true, true, true],
)
check(
  '认门只按 baseURL 的 host 与 route 名 (认不出来就是"不支持", 绝不拿别家的数充数)',
  [
    plugin.includes('function balanceSourceFor(provider, baseURL)'),
    plugin.includes('source.hosts.includes(host)'),
    plugin.includes('source.routes.includes(route)'),
  ],
  [true, true, true],
)
check(
  '取数失败一律抛, 由那句原话落地 (一个 0 都不编)',
  [
    plugin.includes('async function readWallet(source, key)'),
    plugin.includes('if (!response.ok) throw new Error('),
    plugin.includes('if (wallet === null) throw new Error('),
  ],
  [true, true, true],
)
// 那三条自己起来的触发 2026-10-17 全部拿掉 (见下面那条判据): 起点是 startBalance 那个函数体
const balanceFeed = plugin.slice(
  plugin.indexOf('function startBalance(ctx)'),
  plugin.indexOf('function registerVoiceInput(ctx)'),
)
check(
  '余额只有两条触发: 主人点菜单 + 每轮对话结束覆盖缓存 (起来那几拍仍不许回来)',
  [
    balanceFeed.includes('balanceRequested()'),
    balanceFeed.includes('BALANCE_WATCH_MS'),
    // 一个 seq 只刷一次 (30 s 窗口配 500 ms 兜底轮询, 不记住处理过哪一问就是点一次问上百遍)
    balanceFeed.includes('request.seq <= handled'),
    // 2026-11-01 主人: 「每轮对话结束时自动刷新, 此时扣费刚结算」—— 只覆盖缓存 (seq 0), 不进框
    balanceFeed.includes('refreshQuiet'),
    balanceFeed.includes("event?.type !== 'turn/end'"),
    balanceFeed.includes('QUIET_MIN_MS'),
    // 起来那几拍 (3 / 10 / 30 s 补刷) 与"每轮结束当心跳"仍不许回来
    !plugin.includes('BALANCE_WARMUP_MS'),
    !plugin.includes('BALANCE_MIN_INTERVAL_MS'),
    !plugin.includes('balanceLast'),
    // `ctx.locale` 直接点会抛 (没 inject 那个服务时), 只有 ctx.get 这条路走得通
    plugin.includes("ctx.get('locale')"),
    !plugin.includes('ctx.locale?.'),
  ],
  [true, true, true, true, true, true, true, true, true, true, true],
)
check(
  '余额快路径 (2026-11-01): fs.watch 优先 + 500 ms 兜底, 请求带 seq / force, 答案带 seq 与三段读数',
  [
    balance.includes('internal data class Request('),
    // 两个键在不在才是这一条要的: 值是 `JsonPrimitive(...)` 还是裸数由写的人挑 (两者都进同一份 JSON)
    balance.includes('put("seq",'),
    balance.includes('put("force",'),
    balance.includes('val seq: Long'),
    balance.includes('fun isOld(at: Long'),
    balance.includes('const val FRESH_MS = 5 * 60_000L'),
    plugin.includes('watch(dirname(path)'),
    balanceFeed.includes('const BALANCE_WATCH_MS = 500'),
    plugin.includes('async function balanceRequested()'),
    plugin.includes('seenAfterMs:'),
    plugin.includes('networkMs:'),
    plugin.includes('writeMs:'),
    // 网络那一笔预算 6 s (验收: 断网 6.2 s 之内能重试)
    plugin.includes('const BALANCE_TIMEOUT_MS = 6000'),
  ],
  Array.from({ length: 13 }, () => true),
)
check(
  '地址与凭据都从 dsh 自己那份配置里读 (settings.describe + credentials.resolve)',
  [
    plugin.includes('function providerProfile(ctx, provider)'),
    plugin.includes("ctx.get('settings')?.describe?.()"),
    plugin.includes('async function providerKey(ctx, profile)'),
    plugin.includes('credentials.resolve(ref)'),
  ],
  [true, true, true, true],
)
check(
  '提供方不在表里 → unsupported: true, 应用说「不支持」而不是念英文原话',
  [
    plugin.includes('payload.unsupported = true'),
    overlay.includes('snapshot.unsupported'),
    overlay.includes('R.string.ball_balance_unsupported'),
    zh.includes('name="ball_balance_unsupported">当前模型不支持查询余额<'),
    en.includes('name="ball_balance_unsupported">Balance lookup is not supported for the current model<'),
  ],
  [true, true, true, true, true],
)
check(
  '两档答案各说各的话: 金额带厂商名与赠金, 额度那一档认百分比',
  [
    balance.includes('const val KIND_QUOTA = "quota"'),
    overlay.includes('snapshot.kind == BalanceFile.KIND_QUOTA'),
    overlay.includes('R.string.ball_balance_quota_line_by'),
    overlay.includes('R.string.ball_balance_line_by'),
    zh.includes('name="ball_balance_quota_line_by">%1$s 额度剩余 %2$d%% · %3$s<'),
    en.includes('name="ball_balance_quota_line_by">%1$s quota left %2$d%% · %3$s<'),
  ],
  [true, true, true, true, true, true],
)
check(
  '旧宿主那一份也读得出来 (没有 label / kind 的当"没有名字的金额")',
  [
    balance.includes('kind = text("kind").ifBlank { KIND_MONEY }'),
    balance.includes('label = text("label")'),
  ],
  [true, true],
)
check(
  '已经有答案的失败就地给 (「不支持」是稳定事实, 不该每次都「正在取」)',
  [
    overlay.includes('showLocalNote(balanceFailure(it))'),
    overlay.includes('private fun showLocalNote(text: String)'),
  ],
  [true, true],
)

/* ── 六、设置页那个刷新按钮 (2026-10-17 主人: 改完设置当场生效) ───────────── */

check(
  // 2026-11-04 主人撤了右上角那个刷新按钮 (各段自己在进页面 / ON_RESUME 时读一次), 判据跟着翻面:
  // 它现在要的是"那一排一个都别回来" —— 原来这六条查的是"在", 撤按钮那天没跟着改, 一直红着
  '刷新按钮已经撤掉 (六个记号一个都不许回潮)',
  [
    !settings.includes('MiuixIcons.Refresh'),
    !settings.includes('var reload by remember { mutableIntStateOf(0) }'),
    !settings.includes('key(reload) {'),
    !settings.includes('reload += 1'),
    !settings.includes('R.string.settings_refreshed'),
    !settings.includes('R.string.settings_refresh'),
  ],
  [true, true, true, true, true, true],
)
check(
  '刷新那两条文案两份 strings 都有 (键与顺序由上面那份 ball_* 判据之外单看)',
  [
    en.includes('name="settings_refresh">Refresh<'),
    zh.includes('name="settings_refresh">刷新<'),
    en.includes('name="settings_refreshed">Settings reloaded<'),
    zh.includes('name="settings_refreshed">设置已重新读取<'),
  ],
  [true, true, true, true],
)

/* ── 七、会话事件看得见本机的轮次 (2026-10-15 真机: 「正在想」与回复框都是空的) ── */

check(
  '六条 session/event 订阅一律走 onSessionEvent, 而且真的带 { global: true } (第六条是 2026-11-01 夜里加的余额缓存刷新)',
  [
    [...plugin.matchAll(/^\s*ctx\.on\('session\/event'/gm)].length,
    [...plugin.matchAll(/^\s*onSessionEvent\(ctx, \(session, event\) => \{/gm)].length,
    plugin.includes("ctx.on('session/event', listener, { global: true })"),
  ],
  [0, 6, true],
)
check(
  '投影判据两边都归一 (DSH_HOME 写 /data/user/0, 影子会话的 cwd 写 /data/data)',
  [
    plugin.includes('const root = peerWorkspaceRoot()'),
    plugin.includes('const canonical = normalizePath(cwd)'),
    plugin.includes("return normalizePath(join(home, 'lw', 'peer-workspaces'))"),
    plugin.includes('return canonical === root || canonical.startsWith(root + sep)'),
    plugin.includes("String(value).replace(/^\\/data\\/data\\//, '/data/user/0/')"),
  ],
  [true, true, true, true, true],
)
check(
  'sep 真的导入了 —— 少了它 isPeerProjection 一抛, 几条会话钩子全静默死掉',
  [
    /^import \{[^}]*\bsep\b[^}]*\} from 'node:path'$/m.test(plugin),
    plugin.includes('root + sep'),
  ],
  [true, true],
)
check(
  '事件链上一个文件系统调用都没有 (realpath 撞 FUSE: 一句话要十几秒), 而且便宜的判据排最前',
  [
    plugin.includes('realpathSync'),
    [...plugin.matchAll(/onSessionEvent\(ctx, \(session, event\) => \{\n(?:\s*\/\/[^\n]*\n)*\s*if \(event\.type/g)].length,
  ],
  [false, 5],
)
check(
  '回复框排在朗读开关前面 (关掉朗读也要有框), 正文有限长',
  [
    plugin.includes('reportReply(replyChannelText(speakable), session.id)'),
    plugin.indexOf('reportReply(replyChannelText(speakable), session.id)')
      < plugin.indexOf("void call('speak', { op: 'status' })"),
    plugin.includes('line.length <= 2000'),
  ],
  [true, true, true],
)
// 那一条限长得真跑一遍: 抽出来单独求值 (与 check-mode-model.mjs 同一个办法)
const replyChannelText = new Function(
  `${plugin.slice(
    plugin.indexOf('function replyChannelText('),
    plugin.indexOf('/**', plugin.indexOf('function replyChannelText(')),
  )}; return replyChannelText`,
)()
check(
  '推给框的正文: 2000 字以内原样, 超了截断加省略号',
  [
    replyChannelText('好的'),
    replyChannelText('x'.repeat(2000)).length,
    replyChannelText('x'.repeat(2001)).length,
    replyChannelText('x'.repeat(2001)).endsWith('…'),
    replyChannelText('  '),
  ],
  ['好的', 2000, 2001, true, ''],
)

/* ── 余额: 两位小数 + 关掉的框也要拿到答案 (2026-11-01 深夜) ───────────── */

// 两位小数在两条路上各收一次: 显示层 (BalanceFile.moneyText) 与落盘前 (host money2)
const money2 = new Function(
  `${plugin.slice(
    plugin.indexOf('function decimalOf('),
    plugin.indexOf('/**', plugin.indexOf('function money2(')),
  )}; return money2`,
)()
check(
  '金额只留两位小数: 落盘与上屏各收一次',
  [
    balance.includes('fun moneyText(raw: String)'),
    overlay.includes('BalanceFile.moneyText(snapshot.value)'),
    overlay.includes('BalanceFile.moneyText(it)'),
    money2('236.9677291600000000'),
    money2('12.3'),
    money2(''),
    money2('n/a'),
  ],
  [true, true, true, '236.97', '12.30', '', 'n/a'],
)
check(
  '关掉的框也要拿到答案: 按 seq 交付 (不在 30 s 窗口外丢结果), 没回音就说实话',
  [
    overlay.includes('snapshot.seq != balanceAskedSeq'),
    overlay.includes('if (!boxOnScreen) openChannel(focus = false)'),
    overlay.includes('R.string.ball_balance_no_answer'),
    en.includes('name="ball_balance_no_answer"'),
    zh.includes('name="ball_balance_no_answer"'),
  ],
  [true, true, true, true, true],
)

/* ── 点击语音输入开关 + 换状态只跑一段过渡 (落实表 #33, 2026-11-04) ──────── */

// show() 的身体: 从函数头切到 stateName 之前 —— 断言只许落在这一段里, 免得哪一句跑到别处
const showStart = ball.indexOf('fun show(next: BallWord?')
const showBody = ball.slice(showStart, ball.indexOf('private fun stateName', showStart))
// 注释里也会提到那几个 API 名字 (那几行正是在讲改之前是什么样), 数动画之前先把注释剥掉
const showCode = showBody.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
// tapAction 的身体: 单击真正动手的那四段都在这儿
const tapStart = overlay.indexOf('private fun tapAction(now: Long)')
const tapBody = overlay.slice(tapStart, overlay.indexOf('private fun leaveVideoMode', tapStart))

check(
  '「点击语音输入」: 键与缺省 true 都在 BallSpot 里, 关掉那一支挂在 tapAction 的 LISTEN 上',
  [
    ball.includes('KEY_TAP_VOICE = "ball-tap-voice"'),
    ball.includes(
      'fun tapVoice(context: Context): Boolean = prefs(context).getBoolean(KEY_TAP_VOICE, true)',
    ),
    ball.includes('fun setTapVoice(context: Context, on: Boolean)'),
    // 关掉那一支: 点球不进语音 (只滑回来), 而这一支必须排在 listenNow 之前
    tapBody.includes('if (!BallSpot.tapVoice(this))'),
    tapBody.indexOf('if (!BallSpot.tapVoice(this))') < tapBody.indexOf('listenNow()'),
    // 关着时也不排确认窗: 否则"点了一下球, 一秒半之后才有反应"
    overlay.includes('if (!BallSpot.tapVoice(this@OverlayService))'),
    // 长按那条路不许被这个开关牵连 —— 点球 != 长按, 菜单照旧
    /override fun onLongPress\(\) \{\s*toggleMenu\(\)/.test(overlay),
    settings.includes('BallSpot.setTapVoice(context, wanted)'),
    en.includes('name="settings_ball_tap_voice"'),
    zh.includes('name="settings_ball_tap_voice"'),
  ],
  [true, true, true, true, true, true, true, true, true, true],
)

check(
  '换状态只跑一段过渡 (不再"先淡到 0 → withEndAction 里再淡回 1"那种双跳)',
  [
    // 那一段切得对: 真的落在 show() 里
    showBody.includes('fun show(next: BallWord?'),
    showCode.includes('withEndAction'),
    // 一次换字只许有一个动画启动点; 也不许再链一条"淡出去再淡回来"
    [...showCode.matchAll(/\.start\(\)/g)].length,
    showCode.includes('withEndAction {'),
    showCode.includes('.alpha(0f)'),
    // alpha 动画只有一条 (淡回满亮那一趟), 前面那次归零是直接赋值, 不是第二段动画
    (showCode.match(/\.animate\(\)\.alpha\(/g) || []).length,
    // 归零与淡回之间不许夹"结束回调里再开一段"
    /withEndAction\s*\{[\s\S]*alpha\(1f\)/.test(showCode),
  ],
  [true, false, 1, false, false, 1, false],
)

console.log(failures === 0 ? `\n${checks} / ${checks} 条通过` : `\n${failures} / ${checks} 条判据不过`)
process.exit(failures === 0 ? 0 : 1)
