# Luwi

把 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) 搬到安卓: Miuix 界面 + 自建虚拟屏, 把屏幕与输入能力做成 dsh 原生工具交给模型

仓库 `Miuzarte/LittleWhale`, 开发分支 `release/2.0.0`, dsh 以 submodule 挂在 `third_party/deepseek-harness/`

**本文只留现状 / 决策 / 约束 / 操作**, 过程、实测数字与踩坑在 `docs/step2-record.md` … `step8-record.md` 与 `docs/ui-record.md`, 构建旧账在 `docs/host-build.md`, fork 相对上游的改动唯一权威是 submodule 里 `patch.md` —— 细节去那几处翻, 别再往本文加过程

## 文档地图

| 文档 | 放什么 |
| :-- | :-- |
| `README.md` | 对外门面: 能力 / 已知问题 / 构建 / Credits |
| `docs/step2…step8-record.md` / `docs/ui-record.md` | 每一步的清单、实测数字、踩坑、界面那一轮 |
| `docs/host-build.md` | 构建事实与依赖缺口 (**平时不读**) |
| `third_party/deepseek-harness/patch.md` | fork 相对上游的全部改动 |
| `docs/subsystems/web-client.md` | 会话界面为什么不重写 |

「第 N 步」: 2 dsh 上安卓 / 3 特权通道 / 4 虚拟屏 / 5 dsh 工具 / 6 主屏 / 7 读屏 / 8 端侧 OCR

## 当前版本

**2.7.10 (发布候选已冻结, 2026-11-01 周日发布)**: `versionCode 18 / versionName "2.7.10"` —— 酒馆 (角色卡/故事书/存档/主题/主动说话, 最多十人一桌) / 账号与签到 (官网设备码登录, 签到只在官网, 应用里没有写操作) / 开屏 (图标 + 转圈 + 加载日志, `splash.json` 可配) / 老 WebView 兼容层 (polyfill + 四步更新指引) / 切后台回来不重载 (renderer 钉住 + 回前台 host 自愈 + 后台保活白名单) / 探索不看省电 / 一状态多支动作 / 立绘按高贴满 / 半隐改一半透明度 / 鲸鱼娘外观随包发 / API 音色库与接口文档

- **外观包的 minLw 跟着这一版走**: `whalegirl-balltheme-1.1.3.lwp` 已用 `backups\lw-publisher-key.pem` 签到 `minLw 2.7.10` (包内 `version` 也抬到 1.1.3 —— 不改号的话设备上装着的旧副本永远比不过), 插件索引随之换 sha256 与内容 tag; 改号时忘了重签 = 这份外观在设备上永远装不上 (`check-bundled-ball-theme.mjs` 会红)
- **发布材料**: `docs\DSH-LW-2.7.10-release-notes.md` (对外正文); **发布候选已冻结 (2026-10-30 12:44, r2)**: `D:\apk\archive\releases\Luwi-2.7.10-frozen-20261030-r2.apk`, 250,390,159 字节 (238.8 MiB), sha256 `F89348B9…F19296`, 无归属区间 4,140 字节, `lw-release-check` PASS (含首启告示与 dsh 0.2.1-rc.5; 同日更早冻的 r1 已按主人指示删除, 2.7.10 只剩这一只); 重建所需的一切在 `archive\frozen\2.7.10-20261030\FREEZE.md` (两个仓的 patch + 未跟踪文件 + HEAD 指针)。**2026-11-01 (周日) 发布**; 做下一版功能不许改这份包的任何一个字节, `app/build/outputs/apk/debug/app-debug.apk` 下一次构建就被重写 (公开推送的父提交必须是 `2c61255`, 见下面「酒馆的源在仓库外」)

**2.7.9 (2026-10-25 发布, 产物 10-24 已备好)**: `versionCode 17 / versionName "2.7.9"`, 干净构建 244,866,859 字节 (233.5 MiB), sha256 `F5358ADB…D0FC7`, host 树 353 tarball / 35,814 文件 / 341.4 MB, `host.zip` 98.9 MB, 最大无归属区间 3 字节

- **发布只认** `D:\apk\archive\releases\Luwi-2.7.9-release.apk`; `app/build/outputs/apk/debug/app-debug.apk` 下次构建就被重写
- **这份包剔除了酒馆**: 出包时 `git stash push -u -- <酒馆那 16 项>` 再 pop; 判据 = 181 条目无 `tavern`, `classes.dex` 里 0 次
- **坑**: `:app:clean` 删 `app/build/host-tree`, 而 `host-plugins/luwi-dsh-sync/node_modules` 两个手工 junction 指着它 → `packHostTree` 报 `NoSuchFileException`; 先摘 junction, 构建完再 `mklink /J` 挂回
- **发布动作**: 提交信息给主人过目 → 提交 → `tools\lw-api-push.ps1` 先 dry run 再 `-Apply -Tag v2.7.9` → 发 Release; 材料 `docs\DSH-LW-2.7.9-release-notes.md` / `-施工单.md`
- **公告口径**: 对外只叫 `Luwi`, 不写 DSH / LW; 未上过真机的项不进公告

## 仓库形态

- dsh 是可写 fork: submodule 的 `origin` = `yuloong07-star/deepseek-harness`, 上游 `Miuzarte/deepseek-harness` 配成 `upstream` (只读, 别把 origin 改回去)
- **dsh 构建产物不进 git**: `pnpm install` + `build:official` 在构建 APK 时由 Gradle task 跑
- **pin 必须是 fork 上推过的提交** —— 只活在 submodule 工作区的改动, 克隆方看不见
- **当前基座 rc.5** (2026-10-30 升, 官方 tag `dsh-v0.2.1-rc.5` / `b830ec950`): 分支 `lw-sync-rc2`, pin `f202323a90` (19 个本地补丁 rebase 过来, 零冲突); 升法 = 浅取上游 tag 的树 (本机 github.com:443 被挡, 用 `codeload.github.com` 下载 tar.gz, 再按临时 index 导成合成提交) → `git commit-tree <tree> -p <旧基座>` → `git rebase --onto <新基座> <旧基座> lw-sync-rc2`; **导入时三个坑**: Windows 建不了符号链接 (14 条 120000 要按旧树名单补)、中文文件名会按本机代码页写歪 (`说明.txt` → `璇存槑.txt`)、4 个上游 force-track 的夹具被 .gitignore 挡住 (要 `add -f`); 公开前 fork 那个 pin 必须先用 `lw-api-push.ps1` 推上去
- rc.2 删了 `{{cwd}}` 提示词变量, 由 `host-plugin` 的 `systemPrompt.variable('cwd', …)` 按原名补回, 老模板一个字不改

## 酒馆的源在仓库外 (2026-10-29, 闭源 C 方案)

- 酒馆 13 个 Kotlin + 4 个测试 + 宿主插件 + 预置 + 判据都在 **`D:\apk\Luwi-private\tavern\`** (私有仓),
  公开仓只留 `app/src/tavern-stub/java/io/github/yuloong07star/luwi/ui/LuwiTavernStub.kt`
- 目录在 = 完整版构建: `app/build.gradle.kts` 的 `tavernRoot` 把私有 `app/src/main/java` 与
  `app/src/test/java` 并进来, **必须用 `kotlin.srcDir`** —— 这一版 AGP 9 的 `java.srcDir` 加的目录
  不进 Kotlin 编译 (症状是满屏 `Unresolved reference 'LuwiTavern'`, 而文件都在盘上);
  `-PluwiTavernDir=<目录>` 可以换私有仓, 目录不在 = 公开构建 (stub, `enabled = false`)
- `tools/pack-host.mjs` 新增 `--tavern-root`: 从私有目录拷 `host-plugins/luwi-tavern` 与
  `presets/tavern`, 没有这个参数就两样都不进树 (Gradle 在有目录时自动传)
- 共享文件 (AppNav / SettingsScreen / HostScreen / MainActivity / CustomPresets / PluginOverlay)
  **只准调 `LuwiTavern`** 的八个入口, 不准 import `luwi.tavern.*` —— 这就是公开侧干净的唯一判据
- 判据: `node D:\apk\Luwi-private\tavern\tools\check-tavern.mjs` (70 条) 与
  `check-tavern-account.mjs` (18 条); 它们默认按兄弟目录找 `D:\apk\Luwi`, `--repo` 可改
- **公开推送的父提交必须是 `2c61255`** (v2.7.9): `c6aa501` 里就有酒馆 85 个文件, 直接推等于连历史
  一起公开 —— 导出无酒馆树后以 `2c61255` 为父做一次提交, 细则见 `docs/Luwi-酒馆-C-拆分方案-20261029.md`

## 架构

Luwi = 远程 dsh 服务器 + 安卓控制端, 一个进程:

1. **dsh host** — APK 里的 Node 跑 dsh, 监听回环, 界面是它的 Web GUI (装进 WebView)
2. **安卓控制端** — Miuix + Shizuku / root 通道 + 虚拟屏, 屏幕与输入做成 dsh 原生工具

- **前台服务常驻** (Node / host / WebView 都在里面), 否则一切后台被系统收掉
- host 以「上游 pack → 平铺 `npm install`」进 APK, 不用源码 + tsx; 改 dsh 必须重新 build + pack
- **监听地址不写死**: `HostSettings.lanAccess` → `--host 0.0.0.0 --allow-lan`; 设置页已无这个开关, 改 `luwi.xml` 再重启 host
- **安卓侧坑**: `os.cpus().length` 返回 0, 按 CPU 数并行要容忍 0; 随包 node 的 `OPENSSL_CONF` / `SHELL` / `TMPDIR` 少一个起不来
- **探 host 那个口用 `127.0.0.1` 字面量, 判据是 connect**: Android 的 `InetAddress.getLoopbackAddress()` 解成 **`::1`** (2026-10-27 在 vivo 上量到), 而 host 绑 `127.0.0.1` —— 拿那个名字去探永远答"空着" (`host/HostPort.kt`, 与 `PrivilegedBridge` 那条同一个理由)。症状: 每开一次应用多一个死在 `EADDRINUSE` 的 host, 而**活着的那个一直在 3080 上答话**, 界面却写「host 启动失败」(插件全在等 `webServer`); connect 比 bind 准 —— bind 会被 TIME_WAIT 骗
- **「说不了话」先查投屏**: scrcpy 3.1 默认 `--audio` 把 MUSIC / SYSTEM / NOTIFICATION 路由到 Remote Submix; 判据 `dumpsys audio` 报 `remote_submix(8000)` / `deviceIds [2023]`; `setAllowedCapturePolicy` 无效, 真解 `scrcpy --no-audio`
- **术语**: dsh = 被移植对象; **SFA** 只当 Miuix 界面参考 (它的 scrcpy 层与 socket 那套全部作废); **MAA-Meow** 是虚拟屏 / 注入的做法参考 (**AGPL, 只看做法别抄代码**); 文档里的 `B:\Git\...` 是作者机器路径, 本机取不到

## 测试设备

- 文档那台 (小米 13 `192.168.1.103:5555`, `fuxi`, Android 16, KernelSU + Shizuku, Termux `targetSdk 28` 别升 Play 版) 在本机**通常不在线**
- **本机默认目标是模拟器** `Luwi_API36` (`emulator-5554`); 装机走 `tools\lw-install.ps1`, 工作区入口 `D:\apk\dev.ps1`

## 代码风格

- 注释中英都行, 中英文/数字之间留空格, **不用全角标点**, 用 `, . ( ) /`
- **注释里不用句号**, 该断句用逗号; 这条同样管本文档正文
- UI 字符串同时进 `values/strings.xml` 与 `values-zh/strings.xml` (**设置页也不例外**), 键与顺序两边一致; 设置页键以 `settings_` 开头
- 不用 `;` 把该分行的语句挤一行; 改代码优先小步, 不整文件重写
- 先 `import` 再用短名; 多余 import 交给格式化器

## 界面

**上原生渲染虚拟屏预览, 下 `weight(1f)` 的 WebView 渲染 dsh Web GUI, 会话界面不重写** (那是 ~40 个 client 包的内部协议)

- **画面在 `TopAppBar` 下面** (否则顶进状态栏 inset); 手势层贴 `SurfaceView` 的 modifier; **看画面时整条顶栏不画** (`CollapsedHeight = 52.dp`), 菜单浮右上角, 静 3 秒淡出
- 缩进与段间距由 `scaffolds/LazyColumn.kt` 给; **Card 不写水平边距, 也不套 `padding(16.dp)`**; 按钮一律 `fillMaxWidth()`
- **转场已取消, 换页直接完成** (2026-10-27 主人: "取消左右跳转, 直接跳转"): `AppNav.kt` 的 `transition` 从 `NavTransitions.MiuixDefault` 换成 `NavTransitions.None`, 起因是酒馆进出的**明暗闪** (真机录屏逐帧 YAVG: 夜曲首页 25 / 羊皮纸聊天页 216, 0.3 s 扫完 ≈ 8.6 倍亮度差, 转场只是把两页的亮度差演出来); 横滑返回的登记仍在每个 `entry(swipeDismiss = …)` 上 (`NavSwipeDirection.LeftToRight` 不动), 只是 `None` 这一档没有跟手位移; `ThemeSettings.transition` / `.swipeBack` 仍只剩读旧 pref, **别把开关接回去**; **`NavDisplayEffects.dimAmount = 0f`** 也不动 (2026-10-25 主人: 进场不再压暗上一页)
- **酒馆的主题是全局设置: 存档跟着主题** (2026-10-28 主人: "主题的设置应该是存档随主题而不是主题随存档", 10-27 那条"主题只有一份 = 当前存档"作废): `config.defaultThemeId` 是唯一一份, 首页 / 存档页 / 配置页 / 聊天页首帧都按它上色 —— **没有存档时也有主题可画, 主题页不再空**; `TavernStore.colorThemeOf(status)` 读 `config.defaultThemeId`, 本地 `cachedColorTheme` (`luwi` 偏好里的 `tavern-color-theme`) 只当冷启动首帧兜底。主题页永远列六套, 点一下写 `PUT /config {defaultThemeId}` (宿主顺手把这一工作区所有 `session.themeId` 同步过去); 新建存档跟全局主题; 老接口 `PUT /sessions/:id/theme` 保留但同样写全局; `themedIndexPage` 也按 `config.defaultThemeId` 填 `__THEME__`; `/themes` 允许未绑定读取, 于是没绑/没存档也能选主题
- **酒馆聊天页进页是"首帧就对 + 一帧到位"** (2026-10-27 主人: "进入后那 0.3~0.5 s 空白也收掉"): ① 宿主在 `GET /lw-tavern/` 把 index.html 里两个 `__THEME__` 按**全局主题**填掉 (`themedIndexPage`, `cache-control: no-store`), 页面第一帧就是对的颜色与对的 CSS; ② `#chat` 里铺一块 `.stSkeleton` 骨架 (中性灰块, 用主题色会与底色糊在一起; `renderMessages` 的 `textContent=''` 会把它一起清掉), 输入区从第一帧就在 (不再因为 `hidden` 让布局跳一下); ③ 页面自举从 4 发串行变成 `/status` 一发 + 会话/资料并发 (`themeArt`、当前存档 id 都在 status 里, 不再打 `/themes` 与 `/config`); ④ **那块 WebView 退出时只从父容器摘下来, 不 `destroy()`** (`TavernWebViewCache` 复用槽), 再进来直接是上次那一屏, 随后 `__lwTavernRefresh()` 静默补一次 (内容没变 `skipUnchanged` 不动 DOM、不抢焦点); ⑤ **背景画那一层在 Box 里始终存在**, 只换里面那张图 —— 写成 `if (picture != null) { … }` 会在图加载完那一刻插一个兄弟节点、整块重排, WebView 的层被清掉重画, 屏幕上就是"内容 → 一片空白 → 内容" (真机录屏量到约 300 ms)
- **`has-bg` 必须由 JS 加, 不能静态写在 index.html 上** (2026-10-27 踩到): 页面若是从第一帧就全透明, 这台 vivo 上那块 WebView **只画第一下, 之后 DOM 变了也不再重画** —— 内容在 DOM 里 (`Runtime.evaluate` 量到 3 条消息、composer 都在), 屏幕上看不见一片; 改成先把底色画实、等 `/status` 回来再由 `updateBackdrop()` 加 `has-bg` 就正常 (主题此时两侧同色, 这次"由实到透"看不出来)。判据 `check-tavern` 钉住这两条
- 系统栏图标深浅由 `theme/SystemBars.kt` 按实际渲染配色定; 顶栏没有模糊
- **三处图标同一份标记**, 由 `tools/brand/luwi-mark.png` 出 (`vector-trace.py` + `vector-ink.py --ink-width 0.46`, 位图 `make-icons.py`); **0.46 是唯一个数别改**, 球那处 `GLYPH_INK_RATIO` **0.65**
- **设置页右上 ⋮** 五条: Luwi反馈 / 检测更新 / 账号 / 关于 / 重启 host, 同一刻只开一个; 反馈缺省投 `https://luwi.dpdns.org/feedback`, 有 `$DSH_HOME/lw/feedback-channel.json` 时它优先; 「账号」那一条只跳官网 `/login` (签到在官网, 2026-10-26 恢复); **material3 不是本项目依赖**; 会话界面浮标菜单里另有「Luwi反馈」(2026-10-29, 同一个窗)
- **设置页两层分组 + 逐段折叠**: 一级 `GroupTitle`, 二级 `SectionTitle`; 缺省只展开省电与常用六段 (`SettingsSectionsAlwaysOpenKeys`), **新加一段天然收起**; 判据 `SettingsSectionsTest` + `tools/check-settings-sections.mjs` (对齐 20 个 section, 顺序也管)
- **同步段**写 `$DSH_HOME/lw/session-sync.json` (`SyncSetting.kt`, 保留未知键, 令牌只出打码); **关同步三件事一起做** (remote 挪 `lw.savedRemote` + 三个节奏键归零), 缺一件照旧白烧电; 2026-10-20 起扫码配对 (`PairPayload.kt` + `QrScanner`); **生成配对码不要求登录** (2026-10-25 主人: `buildPairing()` 里那道登录闸与面板的「生成配对码前要先登录」都删了, 只要求保存过仓库地址; 账号只剩给 P2P 收费闸提供到期读数); 对端通道与同步无关
- **视频模式段**: 最上面是用哪个模型 (`mode-model.json`), 判定纯函数 `resolveModeModel`; **每次切换后必须 `saveSelection` 把部署默认还回去**; 还原按 `agentAvailable === true` 判 (**不是 `running`**); **工具 `execute` 里没有 `ctx`, 用模块级 `hostCtx`**; 「添加模型」写 `endpoint` (url + model 都非空), 宿主 `ensureVideoRoute()` 挂成路由 `luwi-video` (**key 只进 `ctx.credentials`**)
- **预设只剩 `Luwi` 与 `探索模式`**; 随包 `dsh-custom-mode` 版本号**必须跟着抬**, 否则 `copyDurable` 不刷新, 迁移白写
- **返回键**: `BackHandler` 后登记先赢, 由 `AppNav` 那个自己弹一层; 网页里盖住会话的面板先问 `ui/PageBack.kt` (`PAGE_BACK_JS`, 500 ms 没答话就还给「再按一次退出」); **别在 `HostScreen` 再登记 BackHandler**; `HostWebView.shouldOverrideUrlLoading` 只放行同 origin
- **「正在想」由文件说了算**: `$DSH_HOME/lw/ball-phase.json` 宿主原子写 + 应用 `FileObserver` 盯目录, 事件驱动**零轮询**; 球取 `startedAt` 最大那场, 环色按会话固定; **会话钩子必须带 `{ global: true }`** (监听器异常会被吞, 只在 `ctx.logger`)
- **余额只在主人点「看余额」时查**: 宿主只认应用写的请求记号, 应用成功/失败共用一个 30 s 闸; **同一记号只刷一次** (比 `handled` 时间戳); 服务属性一律 `ctx.get('locale')`
- **手势时间轴**: 单击开麦等 `BallFeel.thinkingTapMs()` (标准 430 ms), 双击/三击到了就取消待办; 三击只对"真要开麦"那几支排队 (`BallCommit.deferMs`); 召出 / 收麦 / 掐播报**不等**; **半隐与半藏都关着时没有"召出"这一步** —— 球一直全亮全露, 单击当场开语音 (`BallTouch.opensVoiceNow` 的 `canRest`, 主人 2026-10-25: "当半隐和半藏都关闭时, 则只用点一次即可语音输入, 不用再点一次唤醒"), 任一开关开着仍是"先召出"; 状态词优先级「在念 > 在想 / 在听 (最近变真的谁上) > 失败」, 动作仍是「念 > 想 > 听」; 七个门槛在 `BallFeel` (标准 300/350/1000 ms, 防误触 220/450/1500 ms)
- **手势只有防误触一档** (2026-10-28 主人: "去掉手势灵敏度, 只使用防误触"): 设置页那一行撤了, `BallSpot.feel()` 一律回 `BallFeel.GUARD` (220/450/1500 ms), 偏好键 `ball-feel` 不再读也不再写 (老值留着无害); `BallFeel.STANDARD` 与它的 300/350/1000 ms 只活在单测里, 没有入口了 —— 别再照旧文档去找那个下拉
- **念与听有呼吸 + 涟漪**: 描边 0.45~1.0 / 1.2 s, **字色不跟着闪**; 涟漪自己一块 overlay 窗, **唯一硬条件 `FLAG_NOT_TOUCHABLE`**, 认球窗的脚本认类名 `BallView`
- **球休闲两档: 半隐 / 半藏, 各一个开关**, 共用 `PEEK_IDLE_MS` 5 s; alpha 只有 `BallMinutes.alphaFor(translucent)`, `TRANSLUCENT_ALPHA` = **0.5** (2026-10-25 主人: "半隐改为一半透明度"), 半藏**不参与**; 停靠点按 `ballSizePx()` 实数重算
- **不该收边的时刻一定会把球拉回来** (2026-10-28 补, 主人: "补一下, 我要看到其它动作"): `waitNow()` 里除了 `if (wait.peek) hideNow()` 还有一条回弹 —— 开关两档都关、或者说这一刻不再闲置, 球就得回停靠位; 从前只有收边那一半, 于是"半藏收着时把开关关掉"要等人碰一下才回来, 而收边那一档画的是 `peeked` (**东张西望**), 看着就像"球只会一个动作" —— 排查这类"只看到某个动作"先看球是不是还挂在边上
- **回弹那条的判据必须是 `idleDueNow`, 不能拿 `wait.peek` 反推** (2026-10-28 装到真机上当场抖): `BallRest.wait` 在**已经收着**时会先命中 `peeked` 那条, 回的是 `peek=false / reason=asleep` —— 拿 `!wait.peek` 当"该出来"会让球每 400 ms 收一下放一下 (主人报的就是"打开半藏时会反复半挂"); 正解是在 `waitNow()` 里把 `BallMinutes.idleDue(now, lastActiveAt) && BallSpot.autoPeek(this)` 单独算一份 `idleDueNow`, 传进 `BallRest.wait` 的同时也给回弹那条用
- **一个状态可以有好几支动作** (2026-10-25): `ball.json` 的 `frames.<状态>` 写对象是一支、写数组是一组; 进这一档随机起头 (`BallTheme.startAction`), 演完一圈换下一支 (`nextAction`); 下一支**提前在后台解好**, 解好前这一圈照演当前那支, 两截加起来过 `BallView.MAX_DECODED_FRAMES` 就不预解 (内存闸); 换状态才重抽, 环色变 / 半藏变不重抽; **桌面组件只跟第一支**
- **立绘那一档按高贴满** (2026-10-25 主人: "东张西望动作左右比例被挤压了"): `fit: contain` 的素材是按**同一高度**出的 (成品里宽度随动作 175~255 px 不等), 所以 `BallFaceDrawable`/`BallFit` 按高贴到 core 上、宽度按比例居中, 比方窗宽的两边裁掉; **别改回 `BitmapDrawable` 的 `Gravity.FILL`** —— 它两个方向各缩一次拉满方窗, 越窄的动作被拉得越宽 (七档胖瘦各不相同); 判据 `BallFitTest` 钉的是"素材宽高比原样落进窗里"
- **老 WebView 要垫 polyfill** (2.7.10, 主人 2026-10-25): dsh 往页面里塞的第一行是
  `(globalThis.__DSH_BOOT_READY__ ??= Promise.withResolvers())`, 而 `Promise.withResolvers` 是 Chrome 119
  才有的 —— 2022 年前后出厂、WebView 停在 100~116 的机器**解析期就抛**, 入口脚本一个都跑不起来, 屏幕
  上永远是"连接中"。治本是 `assets/web/lw-compat.js` + `WebViewCompat.addDocumentStartJavaScript`
  (`ui/WebCompat.kt`, **文档开始**那一刻注入, 不是 onPageFinished); 兜底是"还缺什么就报回来"或 12 秒
  没画出 `root` 子节点就弹真 `Dialog` (WebView 是子 View, OverlayDialog 盖不住) 让人去更新 WebView。
  判据 `tools/check-web-compat.mjs` 会**真的把那段 js 跑一遍** (一个删光 API 的沙箱 + 一个原生都有的沙箱)
- **真正卡住 vivo Y77 那批的是 `AbortSignal.any`** (2.7.10 补, 2026-10-28): 主产物里没有它, 它在
  **按插件单独加载的 client chunk** 里 —— `dsh-api-gateway` 的开 SSE 流 / 每帧投递 / 每代连接生命周期
  三处都调, 缺了连接层整条起不来, 界面永远"重新连接中" (而 `Promise.withResolvers` 那条早垫上了, 所以
  页面能起来, 只是连不上)。`AbortSignal.any` 是 Chrome 116, `lw-compat.js` 现在一并垫上, `MIN_MAJOR`
  从 119 降到 **116** (再往下只剩 CSS 降级: `color-mix` 111 / `dvh` 108 / `:has` 105, 都不致命)
- **补 polyfill 要扫 `host-tree` 里所有 client bundle, 不能只看 `dsh-web-frontend/dist`** (2026-10-28
  的教训): 那两个主产物只占界面的一半, 插件 client 是 `/plugins/??…/client.js` 按需拼的; 扫法 = 对每个包
  的 `lib/client.js` / `lib/*.browser.js` 跑一遍 API 清单, `AbortSignal.any` 就藏在 8 个包里
- **切后台回来不重载** (2026-10-26 主人: "加强 dsh 后台持久化，当前每次打开都要重新加载"): WebView 的
  renderer 是独立进程, 视图不可见时缺省允许被降级回收 —— `HostScreen` 把它钉在
  `setRendererPriorityPolicy(RENDERER_PRIORITY_BOUND, false)` (后台也占内存, 那是"回来不重载"的代价);
  renderer 真死时 `onRenderProcessGone` **返回 true 并换一块新的** (缺省行为是把整个应用进程一起带走,
  而进程里还有 host 与虚拟屏), 同一窗最多自动重建 3 次 (`MAX_PAGE_REBUILDS`), 用完就把更新弹窗摆出来,
  「重试」把额度清零; **同一个地址只 load 一次** (`launched[0]` 记上一次交出去的 URL — host 那个
  token URL 会 302 到根路径, 拿 `view.url` 跟它比会在每次重组时重载, 开屏淡出那几帧里就能重载两三次);
  `MainActivity.onResume` 再把前台服务拉一次 (幂等, host 活着时空转);
  电池白名单那一行叫**后台保活** (`BatteryWhitelist`: 先弹系统确认框, 退名单页; `PermissionGate`
  那条「忽略电池优化」也走它, 判据全仓只有一处)。**2026-10-28 起它不在「省电」段了** (主人: "把后台保活
  放到允许luwi自启动下方"): 挪到「连接」段末尾、`ChannelItems()` 里「允许 Luwi 自启动」下面那一行
  (`KeepAliveRow()`), 两行都是"去系统页点一下"的入口。判据 `tools/check-host-persistence.mjs`
- **酒馆与浮标输入条两块 WebView 也复用** (2026-10-28): 酒馆 `TavernWebViewCache` 记住 `token`, 退出只摘不
  destroy; host 重启换了 token 就重建/重载一次, 否则旧 cookie 是一块 401 的坏页面; renderer 同样钉在
  `BOUND` 并在 `onRenderProcessGone` 里自己换一块新的 (缺省会带走整个应用进程);
  `MainActivity.onDestroy` 调 `TavernWebViewCache.release()`, 免得 Activity 没了还留着一个持有旧 context 的
  WebView。浮标输入条 (第三块 dsh WebView) 收起只摘、再展开重新 `addView`, host URL 变了才 `loadUrl`
  一次。判据仍在 `tools/check-host-persistence.mjs`
- **WebView 更新指引是分步的** (2026-10-26 主人: "加 webview 更新指引"): 卡住那个真 Dialog 里是四步
  (商店更新那一份包 / 商店没有更新时看是否被停用与「卸载更新」/ 分身多用户各一份 / 更新完清掉最近任务
  重开) + 达标一行 (Chrome 116), 「打开应用详情页」与「打开应用商店」是两个按钮 (`WebCompat.openDetails`
  / `openMarket`), 正文自己滚、按钮钉在底下。判据 `check-web-compat.mjs` 第五段
- **开屏是"图标 + 转圈 + 加载日志"** (2.7.10, 主人 2026-10-25): `HostBootPanel` 三样 —— 品牌标记 (108dp 矢量)、
  一圈自己画的转 (Miuix 没有进度环, material3 不是本项目依赖)、下面一行 **host 最后一行输出** (等宽压暗,
  换行淡入一次; 点一下展开完整 300 行, 失败时默认展开), 最底下一行 `powered by deepseek harness`;
  解压那一档多一条定长进度条 (只有它有真实数字)。**页面加载那一段也盖着**: host 一就绪 WebView 就以
  alpha 0 挂着加载, 开屏画在它**底下** (Compose 画不到子 View 上面, 见 OverlayDialog 那条同一个根因),
  页面 `root` 有子节点才淡进来, 淡到 1 才撤开屏 —— 中间没有白屏
- **开放接口只有一份文档** (2026-10-25 主人: "接口文档不能只放开屏的，还要有浮标的状态等，其它开放的接口，
  版块只留接口文档和复制文档地址"): 设置页最末那一段「接口」(`ApiItems`, 段名 `api`) **只有两行** ——
  接口文档 (弹窗看全文) 与 复制文档地址 (剪贴板里放 `$DSH_HOME/lw/interfaces.md` 这条路径);
  文档正文是 `assets/interfaces/README.md`, 由 `host/LwInterfaces.kt` 在开屏时抄到
  `$DSH_HOME/lw/interfaces.md` (**内容一致就不重写**), 里面的 `$DSH_HOME` 换成真实路径。文档覆盖九条:
  开屏 `lw/splash.json` / 浮标状态 `lw/ball-phase.json` (应用写, 只读) / 浮标外观 `plugins/.theme.json` /
  语音状态 `lw/voice-live.json` (应用写, 只读) / 快捷指令 `quick-commands/*.md` / 技能 `skills/*/SKILL.md` /
  自动指令 `automations/*.json` / 探索卡 `lw/explore-card.md` / API 朗读与音色库 (第 9 节: 地址 / 补全端点 /
  模型 / 当前音色的实况, **密钥只报有没有设置、明文不进文档**, 以及 `lw/tts-voices.json` 的登记格式)。判据
  `tools/check-interfaces-doc.mjs` 会把文档里每个文件名拿去源码里对一遍 (漂开的样子是 agent 照旧路径写文件, 没人读)
- **两笔自动收口**挂在"起了新的一轮"那个边沿: 说只掐同一场, 听任何一轮都收; 只动播报与麦克风, **不取消任何轮次**
- **网格图是字节不是路径**: host 侧 `gridOf` 拼的图不落盘, `attachPictures` 两种形状都收 (路径 / `{data,name}`)
- **双击打断打「正在想」那场** (`pickInterruptTarget`: 根会话 + running + `startedAt` 最大); 应用**不乐观清字**
- **截图两条预算**: 像素三档 (262144 / 640000 / 1690000) + 字节 256 KiB~1 MiB, 都是 app 这一半; 路由那一半在 dsh `settings.yaml`, app 读写不到
- **`AndroidView` 里 WebView 必须显式 `layoutParams` MATCH_PARENT**, 否则 viewport unit 解析成 0
- **两块 WebView 的键盘避让** (2026-10-28): `ui/KeyboardInsets.kt` 的 `rememberImeLift` 只认贴底键盘 (IME 边框并集全宽 + 贴底或停在导航条上沿), 悬浮键盘不抬; `targetSdk 37` + `enableEdgeToEdge` 下 `adjustResize` 不再缩窗口, 别把它当解; 酒馆页面在 `resize` 时只在原本贴底时补一次 `scrollToBottom`
- **`strings.xml` 带参字符串里 `%` 必须写 `%%`**, 裸 `%` 抛 `UnknownFormatConversionException`; `tools/check-bare-percent.py` 扫
- **酒馆聊天页不钉软件层**: 背景图由 Compose 画、WebView 透明走默认硬件渲染; 钉软件层再让 `body` 铺整屏图, 滚动实测 48.7% 掉帧 (p90 165 ms → 现在 12 ms, 2026-10-25)
- **酒馆主题画与纹理** (2026-10-26, 本地 AI 出图): 六套主题各带一张 864x1536 背景画 (`web/backdrops/<id>.webp`) 与一张带 alpha 的灰阶纹理 (`web/textures/<id>.webp`); **画由 Compose 画** (与导入背景同一条, `TavernChatScreen` 按 `导入 > 主题画 > 纯色` 选), 页面只留 `has-bg` 透明; 纹理走 `body::before` 固定层 (`--tw-texture` / `--tw-texture-strength`), 明暗底都看得见, 不用 `mix-blend-mode`; **有画时必须 `html.has-bg { color-scheme: normal !important }`** —— 暗色主题的 `color-scheme: dark` 会让 WebView 把 iframe 底衬按黑画, 把底下 Compose 的画整块盖掉 (2026-10-26 在 headless Edge 上量到); 主题元数据 `textureUrl` / `backdropUrl` / `scrim` 与 Kotlin `TavernTheme` 同步, `TavernStore.PALETTE` 必须与 `lib/themes.mjs` 颜色一致 (判据 `check-tavern`); 静态白名单只放行 `textures|backdrops/<主题 id>.webp`, 出图脚本在 `tools/tavern-art/`
- **酒馆角色复选**: 勾几个就按勾选顺序依次回几条 (`turn` 回 `replies` 数组), 每位单独拼提示词、后面的看得见前面的; 选中挂小勾、亮框只给 `is-speaking`; 不勾选仍是一轮一人加权
- **酒馆只有一条引擎 (2026-10-29 主人: "不再直连, 必须走dsh")**: 一场存档 = 一场 DSH 会话 (`preset: tavern`), 存档里没有 `engine` 这一档, `config.defaultEngine` 也删了; 旧存档/旧配置里的键读进来忽略、下次写盘消失。每一轮: `ensureSession` (`presets.resolve('tavern')` + `sessionController.create({workspaceId, agentPreset})`, 工作区 `dsh-tavern`) → `applyModel` (配置的模型 `selectModel` 到这一场, **随后 `agentDefaultModel.saveSelection(旧值)` 还回去** —— 不还就把部署默认换了) → 投一段场景消息 (`agent.followup` + `ctx.sessions.flush`) → 等 `turn/end` (`reason.kind === 'completed'`; 180 s 超时但**不取消那一轮**)。气泡由预设作用域里的 `tavern_say` **直接落盘**, 宿主经 `ctx.provide('luwiTavernBridge')` 收结果; 一条工具调用都没有就按正文兜底解析 (`【名字】…` / `名字：…`), 仍过 `guardReply`。失败按 409 busy / 413 budget_exceeded / 503 bridge-failed 回, **没有直连可退**; 插件不再 inject `llm`
- **故事书: 内联只是索引, 整本走 `tavern_worldbook` (2026-10-29 主人: "第一轮把故事书的文件发给 agent, 这样就没有 1200 token 的限制")**: 开场 / 会话重建 / `bridge.worldVersion < 1` 的那一轮仍把这一场挑中的书按 priority 塞进 `worldText` 的 1200 token 预算, 但那一节只是快速索引; 场景消息另带 `【故事书】` 段 (每本的 id + 条目数) 并点名"第一轮先用 tavern_worldbook 读完整本 (op=list, op=read 按 `nextOffset` 翻页), 再开口"。工具只读这一场 `worldbookIds` 里的书, 每页最多 20 条, 整本不再受 1200 截断; 之后各轮仍只带关键词命中的条目。`worldVersion` 只在成功那一轮写 1, 失败下轮再补
- **酒馆预设 `presets/tavern/cordis.patch.yml`** (`- insert:` 进 profile patch, `CustomPresets.PRESET_ROWS` 加 `preset-tavern`, `pack-host.mjs` 把声明拷进 `lw-presets/`): persona 写酒馆协议 (文本只是思考, 发言只能走 `tavern_say`; 另有只读故事书的 `tavern_worldbook`), `tavern-tools` 行在作用域内注册这两个工具并挂运行期白名单, 另有 qq-chat-v2 那组 compaction。**预设子行的 `name` 按 profile 目录解析** (qq-tool-restrict 的坑), 所以 `CustomPresets` 的 `PROFILE_PACKAGES` 还要给 `luwi-tavern` 建 `profiles/node_modules` link + 依赖 (**不进 `dsh.profile.bundles`**: 它不是 bundle)
- **音色: 每个角色一份, 四类引擎都可选, 回复时由宿主直接调说话工具 (2026-10-29 主人: "在角色设置里加上音色选择, 回答时直接调用说话工具即可" / "把 luwi 设置里音色板块都复制到角色设置里")**: 卡上 `voice` 带引擎前缀 —— `sys:名字@地区` / `dev:模型名` / `edge:音色` / `api:登记 id` (老写法没前缀 = 引擎跟设置页, 仍然有效; `api:` 空 = 用设置页那个默认 API 音色); 场景的 `【同席的人】` / `【你扮演的角色】` 带「音色：…」; `recordSay` 落完气泡后把台词**去掉括号动作** (`spokenText`), 经 `LW_CHANNEL_ENDPOINT` / `LW_CHANNEL_TOKEN` 直接调应用的 `speak` (与 `lw_speak` 同一条通道, `interrupt:false` 排队), 旁白不念。模型不用第三个工具, DSH 正文仍只是思考, 不落明文
- **酒馆会话的正文在 LLM 流上就丢掉 (2026-10-29 主人: "dsh 里不要有明文输出")**: 提示词说"text 必须为空"仍会被 deepseek-flash 补一句收尾, 所以宿主在 `ctx.on('llm/stream')` 上把 `text` 块 (`block-start` / `text-delta` / `block-end`) 整个滤掉, reasoning 与 tool-call 原样过; **只滤 `env.tavernSessions` 里出现过的 DSH 会话**, 别的会话不动。公开插件那边 `startReadAloud` 也跳过 `session.agentPreset === 'tavern'`, 双保险不让浮标拿到它。判据 `check-tavern` 钉住 `tavernSessions` 与 `withoutText`; 真机新会话 5 条 assistant 的 text 长度全是 0
- **酒馆的模型只有一处** (2026-10-27 主人: "角色设置里的模型删掉, 在酒馆配置里加上模型选择, dsh 里用此模型跑"): `config.model` (`{provider, model}` 或 null = 跟随当前), 配置页那一行选; 只有 DSH 会话一条路, 经 `selectModel` 落到这一场。角色卡上的 `model` **不再读也不再写** (`readCardFile` / `cardSummary` / `PUT /cards/:id/settings` 都不碰; 旧键原样留着), 类型并进 `TavernModel`, 选择框搬到 `ui/TavernModelDialog.kt`
- **酒馆预设正文不写「旅人」** (2026-10-27 主人: "预设里旅人的字眼应改为用户（主角），有可能用户会改名"): 协议只说「用户（主角）」, 真实名字由场景消息的 `【主角】` 行给 (存档 `playerName` 优先, 没填才用资料页那一份)。判据 `check-tavern.mjs` 只看 persona 那一块正文里有没有「旅人」
- **酒馆预装一套西幻开局** (2026-10-25 主人: "酒馆预装一款经典的故事书和人物等"): 正文在 `host-plugins/luwi-tavern/seed/preset.mjs` (一本故事书 `灰港与雾林` + 三张卡 + 一场已开场一轮的存档), 落盘由 `lib/seed.mjs` 在 **请求路上**补一次 (`index.mjs` 的 `seedOnce`), 记号 `workspaces/<id>/seed.json`; **缺什么补什么** (主人改过或删掉的不会被塞回来), **一次一个版本** (`PRESET_VERSION`), 种不进去只记 warn 不拦路; **存档单独一档 `SESSION_VERSION`** (2026-10-28): 老工作区 `presetVersion` 已是 1 但当时没这场存档时补一次, `seed.json` 记 `sessionSeeded`, 补过再删不再塞回来; id 写死 (`c_marian` / `c_kael` / `c_severin` / `w_greyharbor` / `s_silverstag`), 因为宿主按 `[a-z]_[a-z0-9]{4,40}` 认 id; 判据 `test/seed.test.mjs` + `tools/check-tavern.mjs` 第八段; **头像单独一档** (`AVATAR_VERSION`, 2026-10-26): 三张卡 + 主角「旅人」共四张本地 AI 头像在 `seed/assets/*.png`, 卡只给"卡还在、来源是 preset、头像文件不在"的补, 主角只在**资料还没改过** (名字仍是缺省「旅人」、`avatar` 为空、`profile/avatar.png` 不在) 时补, **不抬 `PRESET_VERSION`** —— 抬正文版本会让"缺什么补什么"把主人删掉的卡再塞回来
- **酒馆卡片底必须不透明**: Miuix 的 `Card` 缺省取 `surfaceContainer`, 而 `tavernColors` 那一份给的是**调和过的实色** (`lerp(background, foreground, 0.10f)`), 别换回带 alpha 的 `variant` —— 换回去角色详情 / 删除确认那两个弹层会整块透底, 弹层字与背后的列表字叠在一起 (2026-10-25 修过一次)
- **酒馆账号与签到入口** (2026-10-25; 2026-10-26 官网签到恢复): 首页第一行是账号, 最后是「去签到」; 登录走官网**已有的**设备码那条路 —— 应用发一枚 `state`, 浏览器开 `/login?ls=`, 应用 15 秒一拍 `GET /api/account/poll?state=` 取 `device_token` + 账号 + 到期 (官网一个字不用改, 限流 60 次 / 10 分钟 / IP, 窗口 10 分钟, 回前台立刻补一拍)。**2026-10-26 官网登录页多了一条路**: 邮箱注册 + 密码登录 (同一枚 `ls` 照旧回填, 应用侧一个字没改), GitHub 那条留着; 两条路落到同一个账号 (按邮箱认)。账号层 `account/` 在 `luwi` 偏好里存 token / 登录名 / `expires-at` / `tavern-notice-seen`, **token 不进日志**; 头像只画登录名首字母 (不取 GitHub 那张图)。**签到只在官网, 应用里没有任何写操作** (别加 `/api/checkin`, `tools/check-tavern-account.mjs` 会红), 签到与购买只在官网 `/tavern` 页 (`AccountWire.tavernUrl()`; 旧的 `/sync` 现在只是跳转到酒馆的过渡页), 应用只用 `GET /api/account/entitlement` 读到到期; 官网签到 / 买完回到应用, 回前台那一下静默读一次, 小字跟着变。门闸只拦「进聊天页」两条路 (首页那行 + 存档页那一跳), 存档 / 主题 / 配置照常可用; **门闸 = 登录 + 有效服务时长** (`AccountWire.tavernGateOf`: 未登录弹登录窗, 登录了但到期弹「去签到」那一只窗, 落点都是官网 `/tavern`; 聊天页每分钟重算一次, 到期当场换成说明卡, 不给 7 天宽限 —— 宽限只属于离线同步); 首次那句说明点按钮 / 点空白 / 按返回都记成看过
- 虚拟屏预览进不了网页端 (合成器写进原生 surface); dsh 的浏览器插件**拿不到 Shizuku / root**
- **球上字色 = 描边色** (同一色喂 `setStroke` 与 `setTextColor`); "字没换、色换了"也要重画
- **「回应用」回到我发话那一场** (`inputSession` → `replySession` → `boxSession` → 新会话); **「返回应用」与通知走「正在想」那场** (`ReturnTarget`); 球那场对话窗口 `VOICE_SESSION_MS` = **10 分钟**; 输入框开关幂等 (`boxRoot != null` + `claimInputAfterLayout`)
- 锁屏注入解锁 (`LockSteps.injected`), 密码走 `LockSecret` (Keystore AES-GCM), 录制那条**只绕过不删**

### 别做的事

- **不要用 Miuix 重写会话界面**
- **不跑 `scrcpy-server`, 不抄 MAA-Meow 代码** (AGPL); 反射包装要从 `Genymobile/scrcpy` 取并留 NOTICE
- 不把 `SurfaceView` 塞进 WebView; 不把预览放进 `TopAppBar` 的 `bottomContent`
- 不给 Card 里的设置项再套 `padding(16.dp)`
- 不为"让模型能操作屏幕"写 MCP server, 先写 dsh 原生工具

## 特权通道

链路: 模型 → dsh 工具 → Node host → app loopback 桥 → binder → 特权进程 (uid 0 / 2000)

- `native/launcher.c` → `liblauncher.so` (可执行文件当 native lib 发), setenv `CLASSPATH` 后 fork + exec `app_process`
- 不用 Shizuku user service, 直接 AIDL `IShizukuService.newProcess()`
- 回传 binder 必须经自己的 ContentProvider + `getContentProviderExternal` (`ContentResolver.call` 走不通); provider 校验 uid + 一次性 token
- `channel/LwPrivilegedService.kt` **手写 `Binder`**: app 模块里出现 `.aidl` 会生成 Java, 把 AGP 9.4.0 那条坏资源管线拉回构建
- `channel/PrivilegedBridge.kt` 是 loopback TCP (临时端口 + 随机 token, `LW_CHANNEL_ENDPOINT` / `LW_CHANNEL_TOKEN`), **一连接一请求一行 JSON**
- **「有没有 root」查不到也弹不出框**, 只能试, 授权由用户在 root 管理器手动给一次; 通道在 `DshHostService.onCreate` 后台线程预连
- 依赖: `dev.rikka.shizuku:api:13.1.5` + `:provider`, `com.github.topjohnwu.libsu:core:6.0.0` (jitpack)

## 虚拟屏

- **同一时刻只允许一块** (2026-10-28): 建新屏会把旧屏**就地关掉再建** (旧屏上的应用一起结束), 不是拒绝也不是并排; 两层同时钉, 应用 `VirtualScreen.create()` 先 `closeLocal` 再建, 特权 `LwVirtualDisplay.create()` 建前 `releaseAll()`; 桥的答案带 `replaced` / `replacedLabel`, 插件在 `lw_screen_create` 的描述与答案里写清
- **取帧在 app 进程的 ImageReader 里** (`FrameCache`): 屏从建出来那一刻就画进这块面, 缓存最新一帧 (没有预览 250 ms; **有预览按每帧字节数自适应**, `PREVIEW_BYTES_PER_SECOND = 150 MB/s`, 夹 33~200 ms —— 1080p 约 66 ms、2K 约 122 ms、720p 顶到 33 ms, 写死 66 等于给 1080p 调好之后让 2K 每秒白搬 1.1 GB), 截图与 OCR 直接读缓存; **虚拟屏不再跑 `screencap`** (K40 上它恒 0 字节), 也不依赖特权通道。判据 `FrameCacheTest`
- **取图只有主屏走 uid** (2026-10-29 核实): 虚拟屏的截图 / OCR 取帧是 `frames[displayId].latest()` 的 app 进程内存拷贝, 建屏那一步才过 shell uid; 唯一走 `screencap` 的是 display 0 (`LwCapture.capturePrimary`), 交付包里也没有它的非 uid 方案 —— **别把取帧搬回特权进程**
- **预览是镜像不是输出面**: `SurfaceView` 的 surface 由 app 从缓存画 (`lockCanvas` + `drawBitmap`, 有新帧才画); 面没了 (切后台 / 收起预览) 屏照旧合成, 照旧能拍
- **buffer 必须等于屏尺寸**: reader 的 buffer 就是屏自己的尺寸, 预览那块 `setFixedSize` 同理; 改尺寸只能换一个新 reader (先 `resizeDisplay`, 再 `setDisplaySurface`, 最后关旧的)
- **换屏要换 SurfaceView** (`key(displayId)`), 否则留着上一块屏的最后一帧
- 主屏 (`displayId 0`) 才走 `screencap -p`; 虚拟屏那条路已从 `LwCapture` 删掉 (只剩 `capturePrimary`)
- **触摸要排队** (单线程), 否则 move 超过它所属的 down 被平台丢掉
- `lw_screen_resize` / `lw_screen_rotate` 改形状后预览要重新 `setFixedSize`; 换完要等新 reader 的第一帧 (最多 1200 ms), 等不到就明说"还没有东西画上去过", 不交旧帧
- **两道用户闸**: 顶层「暂停接受控制」(拦 tap / swipe / launch, **不拦看**) 与一级「虚拟屏触摸控制」(默认不选)

## dsh 工具

工具全在 `host-plugin/index.mjs` (一个插件, 每个一次桥调用), 现在 **66 个**: `lw_probe` / `lw_screen*` / `lw_tap` / `lw_swipe` / `lw_screenshot` / `lw_launch` / `lw_key` / `lw_type` / `lw_ui` / `lw_ocr` / `lw_wait_text` / `lw_apps` / `lw_events_*` / `lw_files` …

- **每个能力先过权限闸** (`PermissionGate` + `PermissionCatalog`): 缺什么就说什么, **不假装成功**, 写入一律写完读回
- **答案由应用侧写**: 桥回来的 `result.text` 才是给人那句话, 插件 `answerOf` 原样念
- **只有 app uid 做不到的才走特权** (卸载 / 清数据 / 停应用 / 装包 / 停用 / 飞行 / 移动数据 / 蓝牙 / 熄屏), 特权侧一张**写死白名单** `channel/LwSystemCommandTable.kt`
- **`displayId` 可以省略**: 省略就补"手里那块" (预览选中的 → 最新建的 → 没有虚拟屏才 0), 有虚拟屏时**绝不**落 display 0; 事件订阅不补 (它的省略意思是"全看")
- **`lw_wait_text` 是自绘屏的等待工具**: 350 ms 一次 OCR 等某段文字出现, 不写不点; 视频模式里与其它读屏工具一起被拒
- 双开是 `user 999` (`am start --user 999`); 列应用只能 `lw_apps` (**模型的 bash 列不出来**)
- `lw_launch` 只走特权 (`am` + 先 resolve 成组件); 按键走特权 (**传名字不传编号**); 打字优先 `ACTION_SET_TEXT`
- `tap` / `swipe` 阻塞到设备收下; `swipe` 均分 12 步、**每步至少睡一帧**; hold 是字符串 (`"1s"` / `short` / `long`, 上限 10s)
- 截图落 `<工作区>/screenshots/` 并缩到两条预算; 连拍上限 12, 答案报**量到的** `offsets`; `sheet` 只看过程
- host 树里的 `sharp` 是官方 0.35.5 **wasm** 构建 (原生那条在设备上是死的)
- 验证: `tools/lw-bridge.ps1` (应用侧) / `tools/lw-plugin-call.mjs` (插件层, 不花模型钱) / `tools/lw-device-turn.ps1`; **读图不能在 run-as 里验**
- PS 脚本里的 adb 路径用 `$env:LW_ADB` 覆盖

## 主屏 (displayId 0)

- `displayId 0` 就是手机自己那块屏, **不进 `screens`**, 尺寸现读, `release 0` 拒绝
- **2026-10-08 起触摸刹车整个删了**: 没有应用层刹车, 只剩提示词层规矩 (先说清在动主屏, 做完如实回报); 看的路从不拦
- 指代不明的一句话自动附一张主屏截图 (`SCREEN_REF_WORDS` 子串命中), 视频模式与开关关着时不附; GUI 打字那条由 `assets/modes/phone.md` 兜底

## 语音 (两档引擎)

- **两个模型都不随包发, 每次打开应用提醒一次** (2026-10-28): 唤醒词模型 (KWS, 4 个文件约 5.3 MB) 在
  `files/wake-word/kws-zipformer-wenetspeech-3.3M/`, 语音模型 (SenseVoice + silero VAD, 约 241 MB) 在
  `files/speech-models/sense-voice/` 与 `silero-vad/`; 每次冷启动 `ModelSetup.beginPrompt` 先看
  `luwi` / `model-prompt-count`: 缺模型最多提醒 3 次 (弹出来那一刻计数 +1, 同一进程只弹一次),
  **到 3 次之后连检测都不再做**; 旧版布尔 `model-prompt-seen` 迁移成 1 次; 错过弹窗去设置页「唤醒」段
  的两个下载行补。两套文件表/镜像地址与 `host-plugin/index.mjs` 必须逐项一致, 判据
  `tools/check-model-files.mjs`
- **SenseVoice** (sherpa-onnx, 234 M, app 进程内) 快、**处处缺省**; **GLM-ASR-Nano** 准但慢, 只有点名 `engine=glm` 才走
- GLM 是 fork 出来的常驻进程 (`libglmasr.so`), APK 里 3.7 MB, 常驻 1.8 GB / 权重 1.6 GB; 还回去用 `lw_speech op=release engine=glm`
- 慢的根因是 30 秒静音垫: **唯一改上游处**是 `LW_ASR_PAD_SECONDS` (缺省 4 s); **mel 长度必须按 8 帧对齐**, 那行别删
- **GLM 必须 `-O3`** (AGP 给 Debug 变体不传优化, `-O0` 慢四十倍), 补在 `native/CMakeLists.txt` 的 `CMAKE_*_FLAGS_DEBUG`
- 官方 bundle 开着时按 id 关掉它自带 provider (`VOICE_LOCAL_ROW`); 我们的 provider 报 `SpeechPreparationState`, **字段名写错不报错只显示 NaN**
- **说时关麦**: 判据是 `LwSpeak.talking(context)` (引擎标记 + 按字数预算 + `AudioManager.isMusicActive`), **不是 `VoiceState.speaking`**; 重开只在常驻那一档
- 切模式时链子已开着就转常驻 + 看门狗电平兜底 (`voiceResidency && listening && !powerSave && !voiceActive && !ttsPlaying()` → `openVoice()`)
- **视频模式里球写「正在听」顶格**, 单击走 `LwModes.switchTo(context, PHONE)` 连视频模式一起收; 视频模式里双击打断显式关掉
- **API TTS 的音色可以自己设计** (2026-10-25): 服务商给的音色标识经 `lw_speak op=voice action=add`
  登记进 `$DSH_HOME/lw/tts-voices.json` (**应用代写**: 会话自己的文件工具被沙箱关在工作区, 看不到
  `$DSH_HOME`, 与快捷指令同一个道理; 每条可带自己的 `model`), 设置页「说话 → API」列出来;
  `lw_speak voice=<id 或登记名>` 可单次点名、不改设置; 接口文档第 9 节带着当前的地址 / 完整端点 / 模型 /
  当前音色 (**密钥只报有没有设置, 明文不进文档**), 设计那一步由 agent 用这几样去调服务商自己的设计或复刻
  接口 —— **应用不绑定任何一家**, 也不代调

## 无障碍读屏

- 链路 `LwAccessibility` (app 进程) → `PrivilegedBridge` 的 `ui` / `tapText` → `lw_ui` / `lw_tap(text=…)`; **取树没有 binder**
- **开服务三条**: `-i` 重装是必要条件; 有些 ROM 应用自己写不动 secure settings (vivo 上 `settings put` 返回 0 而值不变), 正解是电脑跑 `tools/lw-install.ps1`; **"设置里写着"不等于"服务活着"** (`LwAccessibility.running`)
- **`getWindows()` 只返回默认屏**, 要 `getWindowsOnAllDisplays()`; 坐标是那块屏自己的原点; **`ACTION_CLICK` 在虚拟屏上有效**
- 匹配从窄到宽 (text 全等 → desc 全等 → text 包含 → desc 包含); 去重后仍多个就**什么都不按**, 最多回 12 条
- `ACTION_CLICK` 回 false 才退到注一次真触摸 (`via: "finger"`)
- 特权侧只能 `ProcessBuilder("/system/bin/settings", …)` 写, **读要走 `ContentResolver`** (Android 14 起非 shell uid 调那条会抛 `INTERACT_ACROSS_USERS`); 读出来改、先 `accessibility_enabled=1`、写完读回
- 组件在列表里没绑上 → **先摘、停 800 ms、再放回**; 侧载应用顺手 `cmd appops set … ACCESS_RESTRICTED_SETTINGS allow`
- **重装会踢出 `enabled_accessibility_services`**; `am start -S` 也会摘掉绑定实例 —— 装完用**不带 `-S`** 的 `am start`

## 通知栏

- 链路 `LwNotificationListener` → 同进程 `notifications` → `lw_notifications`; **既不过 binder 也不要特权 uid**
- **授权只有 `cmd notification allow_listener <组件>` 算数**, 直写 secure setting 系统不理; 先走命令, 直写只当退路, 都以读回为准
- 首次授权要系统那个确认框; 设置页两个 `ArrowPreference` 带"退到应用详情页"的回退
- 名单与别人共用, 比较用 `ComponentName`; 重装会收走, 装机脚本装完当次就给
- **没授权与"通知栏是空的"长得一样**: `active()` 回 null 表示没连上, 按三种情况说清
- `getRanking()` 不是公开 API, 用 `currentRanking` 点名取; 常驻通知如实说"留着没动", 清完再读一次
- 横幅只做渠道 + 全屏 intent (`lw-tools-high`), `canUseFullScreenIntent()` 说真话; 模拟器 `cmd notification post` 投不出通知

## 事件订阅

- 掩码只用那四个 (`typeWindowStateChanged|ContentChanged|ViewFocused|ViewScrolled`) + `notificationTimeout="100"`, **不用 `typeAllMask`**
- **订阅是游标不是拷贝**: 队列有界 200, 同类 400 ms 合并成一行, 满了丢最旧并计数; 答案里印"几条 / 上限 / 丢过几条"
- **事件上没有 displayId**, 用 `windowId` 去 `windowsOnAllDisplays()` 反查, 缓存 1 s; 查不到 -1, **不猜 0**
- `event.eventTime` 是 uptime, 基准取 `SystemClock.uptimeMillis()` 且取**念出来的第一条**
- wait 是轮询队列 (150 ms), **游标答完才前移**; `Heard` 放文件顶层; 订阅 `lifeMs` 默认十分钟

## 端侧 OCR

- **fp16 是前提**: `--float_bitwidth 16` 之后模型原样过; `rewrite_onnx.py` 只钉 shape
- NPU 走 ORT QNN EP **设备上 JIT 编译**; 预编译 context binary 输出常数图, 别走; `libQnnHtpPrepare.so` (70 MB) 必须随包
- **NPU 标签要说真话** (2026-10-29): `backend = NPU` 只说明 QNN EP 被收下, 不说明算子在 DSP 上。判据三件 —— `strict` (建 session 时 `disable_cpu_ep_fallback = 1`, 建成功 = 每个算子都在 HTP), `fastrpc` (`/dev/adsprpc-smd` 在不在; 不在的机器直接判 CPU, 省掉必然失败的建 device), 以及 `probe` 把两个字段一起报出来; 设置页显示 `NPU (SOC)` / `NPU (SOC) 混跑` / `CPU` 三种。实现是 `PERF_LADDER` (burst → high_performance → default) 里套 `STRICT_TRIES` (true → false), 全被拒才落 CPU。**旧的 `if (!jit)` 从来没合上过**, 别写回去。判据 `tools/check-ocr-npu.mjs`
- **rec 换 batch 8 (2026-10-29 主人拍板, 覆盖 10-28 的 batch 1 结论)**: 交付包在 8 Gen 2 上实测 330ms -> 53ms; 而 10-28 在 22041216C 上实测"batch 无收益" —— 两份实测相反, 现在按交付包那份出包 (`build-models.ps1` 缺省 `-RecBatch 8`), 代码照旧按 `recShape[0]` 读 batch。**换回 batch 1 = `build-models.ps1 -RecBatch 1` 重打**, 无代码改动。模型输出 batch 维必须与输入一起钉死, 只钉输入会留一个动态维 (`rewrite_onnx.py` 已补, 那条是 QNN 拒绝建 session 的原因)
- `htp_performance_mode` 跟着 session 走; burst 是最激进那一档, 被拒时按上面的阶梯退, 不要一档写死
- **det 640→960 也没采用**: 设置首页与"我的设备"两页一条字都没多, det 慢 1.8~2.6 倍; 候选留在 `build/ocr-work/models-960/` (gitignored), 换法 `build-models.ps1 -DetSize 960`
- **换更大的 det 也没用** (2026-10-28 晚): small (9.9 MB) 与 medium (62 MB) 都在 NPU 上跑通, 但两页字数不变, det 分别慢 1.7~2.2 倍与 8~10 倍 —— 连 960 一起看, 瓶颈在输入尺度与汉字识别, 不在检测容量; 换模型只解决"漏检", 而这几页是"认错"
- `lw_tap(text)` 的 auto 先问无障碍树, `ambiguous` 时不退; 读屏落点取框中间 60% 随机
- **图标按形状丢, 不抬分数线**: 近方形 (两条边差 < 长边的 0.35) + 长边 < **屏长边的 9%** + 分数 < 0.85 的框当图标 (`OcrBoxes.isIconLike`, 尺寸判据按比例不按绝对像素: 旧写死 96px 在 720p 上形同虚设、在 2K 上会误杀真字); 夜间灰字分数天然低, 抬 `MIN_TEXT_SCORE` 会先误杀真字
- **同一行被检出两遍要收掉**: 检测器的缩放与滑窗会给重叠框, 按分数从高到低扫一遍, 与已保留框的交集 / 较小框面积 ≥ `BOX_OVERLAP = 0.6` 的丢掉 (`OcrBoxes.dedupe`, 保留阅读顺序), 表现是"微信(4)"那种同一行报两条
- **`recMs` 是识别总时间, 不是每行平均**: `Outcome.recMs` 与 `recTotalMs` 同义, note 写成 `det Xms / rec Yms / N 框 → M 行`; 插件那句也按总时间 + 调用次数说 —— 33 框 x 10ms 的 330ms 曾被当成 10ms 看过
- **只有符号的框也丢**: 一个框里连一个字母 / 数字 / 汉字都没有 (`OcrBoxes.isSymbolOnly`), 专收设置页右侧那种单独的 `>`
- **长行只在挤压到 1.5 倍以上才切**: 识别输入 48x320, `resized()` 对超宽行是**横向挤压**而不是裁掉; 长宽比 6.67~10 之间不切 (切了接缝会多认一个标点), 超过 10 才 `OcrBoxes.segments` 切段 (重叠 12 px) + `joinOverlap` 拼回 (去重最多 4 字)
- **调试图只点名时才写**: `lw_ocr debug=true` 才落 `getExternalFilesDir("ocr")` 的 `overlay.png` / `overlay.txt` (绿框保留 / 红框 + × 丢弃); 350 ms 一次的 `lw_wait_text` 轮询里一次都不写, 也不进相册
- **熄屏是静默失败**: `screencap` 交旧帧、注入唤不醒屏; 答案必须带 `screen: on|dozing|off`
- **别再用"Flutter 需要 OCR"当理由** (实测 Flutter 一直暴露语义树)

## 权限

- 普通权限装完就有; 运行时权限走设置页「权限」段或 `lw-install.ps1 -Perms`; 特殊访问只能 `appops set` / 系统页
- 通讯录 / 短信 / 通话记录那批**声明了没有工具用**, `PermissionCatalog.declaredOnly` 单列
- `util/PermissionCatalog` 是唯一一份表, 设置页与 `lw_permissions` 都照它

## 破坏性操作与审批

- `forceStop` / `clearData` / `uninstall` / `install` / `disable` **调用即执行**, 应用侧确认框已撤; **唯一那道闸在提示词层**, 三处一起改: `lw_app_control` 工具描述 / `skills/android-device-control/SKILL.md` / `assets/modes/phone.md`
- 这一层**拦不住模型**; `enable` / `setHome` 不在这一档
- **审批全放行**就一行 auto-allow answerer (`approval/request` → `'allowed-once'`), **`prepend: true` 必须** (否则浏览器 `ui-approval` 面板先答); `ApprovalOutcome` 封闭 fail-closed, `danger-full-access` 是"没人答就全拒"; 放行也照走 `ctx.approval` 留审计

## dsh 工具怎么加

- **先写原生工具, 不写 MCP** (dsh 只有 mcp-client)
- 加载路径是一条 `--patch` 覆盖层: 插件源 `host-plugin/index.mjs` (纯 ESM + `defineTool`), 由 `tools/pack-host.mjs` 装进 `node_modules/luwi-channel`, app 每次启动写 overlay; **要能在设置面板改的那几行由 `host/PluginRows.kt` 写进 profile 的 `cordis.patch.yml`**
- 插件导出 `name` / `inject` / `apply`; **开发期临时插件文件放 `apps/cli/` 里** (pnpm 隔离), 用完删

## 技能与快捷指令

- 技能 `$DSH_HOME/skills/<name>/SKILL.md` (源 `skills/`), 快捷指令 `$DSH_HOME/quick-commands/<名字>.md` (源 `quick-commands/`)
- 随包靠 `copySeedAssets` + `host/LwSeed.kt`, **显式列名字而不是整目录拷**; 技能缺什么补什么, 样例只发一次 (`.lw-seed`)
- 技能从 `yuloong07-star/app-skills` 检测 (contents API + 本地索引缓存); 删走 `AppSkills.remove`, **不可逆**
- `lw_quick` 的 op 两份实现, `tools/check-quick-commands.mjs` 拦; **删除只在桥上**; 点一下 = 投一句话 (`source: quick`)

## 自动指令与探索

- 规则 `$DSH_HOME/automations/<名字>.json`; `settings.json` 九个监测器开关; `history.jsonl` 一行一次判定 (冷却 / 上限 / 手动都从它算); `places.json`
- **没有启用的规则就不注册**; 通知与前台应用事件驱动 (**不退回 UsageStats 轮询**), 时间只排一个闹钟, 轮询只剩天气与地点
- 「且」「或」: `{"kind":"all"|"any","conds":[…]}` 收 2~5 个叶子, **不许嵌套**; 判据是"各自最近一次为真落在窗口内" (time 1800 s / 瞬态 120 s / 状态 300 s) + 60 s tick; 命中后清新鲜标记 (**同一次只响一声**)
- 动作 = 投一句话 (`source: automation`, **每次新开一场**); 措辞由模型现写; `task` 多一道「允许它自己动手」总闸 (默认关)
- 防骚扰: 静默时段 23:00-07:00 + 冷却 30 分钟 + 每天 5 次; `saidLimit` 只数 task
- `lw_automation` op 两份实现, `tools/check-automations.mjs` 拦; **删除只在桥上**
- **探索没有手动开始**: 每天一个时刻由 `AlarmManager` (requestCode 42) 读 `explore-card.md` 投一句话, 卡由 `lw_explore op=finish` 的 `nextTask` 演进 (上限 8000 字); `op` 只有 status / finish
- **探索时用不用锁屏**: 设置页「探索」那段第 4 行「允许锁屏解锁」(`explore-schedule.json` 的 `unlock`, 缺省关) 开着时, 到点先 `LockReplay.wakeScreen` + `replayNow` 把屏让开再投那一行 (`ExploreSchedule.unlockForExplore`, 没录过解锁就只点亮屏并如实记 `last.why`); 同一道开关也管**探索那一场里的 `lw_lock op=unlock`** —— 关着时 `LwLock` 直接拒 (`explore-unlock-off`), 因为那一档是夜里自己开的; 与「锁屏」段里的「唤醒时自动解锁」是两个开关, 各管一条路, "有没有可放的东西"只有 `LockSetting.unlockable` 那一处
- **省电不拦探索** (2026-10-26 主人: "探索功能当前被省电模式阻止启动，看能不能忽略省电"): 应用
  `ExploreSchedule.skipReason` 与宿主 `startExplore` 两侧那道闸都拆了 —— 省电只管麦克风与轮询监测,
  到点那一场照开; 省电与 Doze 只写进 `last.why` ("省电模式里照常开了" / "设备在深度省电 (Doze) 里,
  网络可能要等维护窗口")。跳过只剩**宿主没在跑**与**上一场还在跑**两条 (探索卡 / 省电 / 锁屏那一整段
  其余行为不变)

## p 图与随包插件

- 三段: `@dickpy/dsh-imagegen` (改图, 随包) + `skills/photo-edit` (工作流) + `lw_image` (ref / album)
- `edit_image` 只认引用对象 → `lw_image op=ref` 拍屏交给附件库, **拍 `fullPath` 那份**; `op=album` 经 MediaStore (`IS_PENDING`) 进相册再 `ACTION_VIEW`
- 随包 = `npm pack` 只取包本身**不装依赖**, 裁 `docs/` / `src/` / `*.map`; registry 走 `LW_NPM_REGISTRY`; **装完当场 import 一次**
- `PluginRows` 那一行才挂进 profile patch, 且 **`name:` 必须写成 `file://` 形态** (面板写不进去的两条根因: 层序 + anchoring)
- 补上游三处写死 `~/.dsh/dsh-imagegen` 的路径, **数替换处数, 不是 3 处就让构建失败**
- 第二个随包插件是 `@modusensus/dsh-mneme` (记忆), 数据落点 `memoryDir` = `$DSH_HOME/memory`; 随包 node 必须带 `node:sqlite`
- **第三个随包插件 `dsh-our-free-model` 已于 2026-10-30 撤下** (主人: "删除 ourfreemodel 这个随包插件"): `pack-host.mjs` 取包那一段、`PluginRows` 那一行与它那句 `distribution: 'managed'` 一起删了; 老设备上那条挂载行由 `PluginRows` 的 `RETIRED` 表摘掉 (**只摘指回宿主树的那一条**, 主人自己装在 `plugins-src/` 的那份不动) —— 真机上不摘的表现是每次起 host 一句 `free-model (file://…/dsh-our-free-model/index.js): failed to import` 加 "1 entry did not activate", 2026-10-30 在 22041216C 上实测过; 判据 `tools/check-bundled-plugins.mjs` 现在钉住"它不在"与"旧行会被摘"这五条。原来那套 (npm 只停 2.1.0 所以锁 git 40 位 commit / 装完点 `vendor/channel-pack` 关键件 / 裁 `vendor/magpie` 那 65 MB) 要接回来得从头重接一遍
- **随包插件一律"先看本体, 有就不装"** (2026-10-25 主人: "对于预装的插件要先检查本体有没有才安装, 不覆盖安装"): `PluginRows` 命中任一条就让位 —— patch 里已有**别人**的挂载行 (`mountsPackage`), 或 profile 的 `node_modules` 里这个包解析到**宿主树之外** (`userInstallOf` + `isUserCopy`, 例如软链到 `plugins-src/` 主人自己那份)。让位 = 摘掉自己那行 + 记一条带路径的日志, **不删别人的行、不往别人的目录写字节**; 一条可用本体都没有时才装树里这份 (`taken` 那一段, 判据 `PluginRowsTest` 14 条)
- 右栏浏览器格在上游是 desktop 专属, `PluginOverlay.write` 每启一次写 `disabled: false` 覆盖
- **Luwi 的 CSS 覆盖层**是 `presets/ui-fix`: 只写选择器与样式, **不复制组件不 monkey-patch**; 每条 `!important`; `tools/check-ui-fix.mjs` 把每个 selector 去产物里 grep
- **挂插件要往 `PLUGINS` 与 `OWN_PLUGINS` 两张表各加一行**

## LW 插件

- 三层分工: 技能只给提示词, dsh 插件碰 host 侧, 这一层是**设备侧能力**
- **卸载只有一个键, 什么都不留** (2026-10-28 主人): 连同 `.data` / 所有版本 / `.audit/<id>.log` /
  `.leftovers.json` 条目 / `.removed.json` 旧条目 / 桌面槽 / 外观选择一起清; `.removed.json` 不再写新
  记录; 伴侣 APK 仍**不自动卸** (另一个应用, 只提示可以卸); 删不干净时先停用再如实报错。详情页改完
  通过 `PluginUi` 让列表当场重读 (否则停在返回栈里的列表还挂着已删的那一条)
- 落点 `$DSH_HOME/plugins/<id>/<version>/` + `current` (**文本文件不是 symlink**) + `.data/`; `.state.json` / `.publishers.json` / `.audit/<id>.log`
- `kind`: `companion` / `art` / `inline` (**`dex` 是 `inline` 别名**); `script` 未接通, `theme` 已并入 `art`
- **两侧都是手写 Binder**, 仓库里不许有 `.aidl`; 接口只在 `:lwplugin-api`
- 能力表 23 条接通 11 条; **检查只有一处** (`LwPluginContextBinder.call`), 逐次对声明与授权、核 uid、**被拒也进审计**
- **签名载荷两份实现必须逐字节相同** (键递归排序 / 紧凑分隔符 / 数字只许整数 / 逐文件哈希); `describe()` 与包五项对照
- 未签名只走开发者模式; 发布者指纹 = **规范化公钥身份**的 sha256 (曲线 OID + 定长未压缩点)
- 工具名 `<toolPrefix>_<动作>`; 宿主每 3 s 拉 snapshot, **revision 变了才重挂**
- 宿主槽 (`plugin/widget/`) 由主 APK 声明, **同槽互斥** (`plugins/.widgets.json`), 帧走 `content://` 且每趟组装前重放读权限
- `companion` 收窄: **不许 MAIN + LAUNCHER**; `inline` 只对白名单作者; 零能力的包装完**自动启用**
- 插件详情对话框自己封高度 + `verticalScroll` (Miuix `OverlayDialog` 不滚也没有 `maxHeight`)
- **签好的包只在 `yuloong07-star/luwi-plugins` 的 `packages/`**, Luwi 仓库 `plugins/` 只留一页指路
- **插件仓库的推法是 `lw-api-push.ps1` 加三个参数**: `-RepoRoot D:\apk\luwi-plugins -Repo yuloong07-star/luwi-plugins -RemoteRef origin/main`, 先 dry run 再 `-Apply -Tag <内容 tag>`; 2026-10-25 用 `plugins-2.8.0` 推出了 1.1.2 (索引 tag `index-9`), 同一天把 1.1.2 重签到 `minLw 2.7.10` 之后, 包与索引一起落在 `plugins-2.7.10` / `index-10` (**注解 tag 要本地先 `git tag -a` 打好再 `-Apply`**, 那个脚本是从本地 tag 对象逐字节重放的; 轻量 tag 仍然手动 `gh api ... git/refs` 打)
- **索引 tag 一变, 应用侧那条常量得跟着抬**: `PluginIndex.REF_CURRENT` / `REF_PREVIOUS` 钉的是索引 tag (不是 `main`) —— 只推索引不重出包, 插件页永远看旧的 (2026-10-25: 推完 1.1.2 忘了抬 ref, 页里还是 1.0.3)
- **鲸鱼娘浮标外观随包发** (2.7.10 起): `copySeedAssets` 从 `../luwi-plugins/packages/whalegirl-balltheme-1.1.3.lwp` 拷进 assets (源不在就构建失败; **换版本号时它先清掉 `seed-assets/lw-plugins/` 那一层**, Copy 自己不删旧文件, 不清会同时打进两版 17 MB 的素材), `host/LwPluginSeed.kt` 在 `restorePlugins` 那条线程里、`PluginManager.restore` 之前装它 —— 走的是与"从链接装入"**同一条链** (验签 + 逐文件哈希); `$DSH_HOME/lw/plugin-seed.txt` 一行一个版本号, **只补这一版一次** (主人删掉就一直删着), 只在装着的比它旧时才装; 首启没有 `.theme.json` 时替主人挑上它 (挑过内置也是选择, 不动)
- **1.1.3 换掉了东张西望 (peeked), 整段放慢一半但帧率不降** (2026-10-28 主人: "替换成这张图" -> "不来回放了, 放慢一半的速度" -> "保持上调帧率"): 素材是主人重抠的 `ball-art/动作可用/东张西望.gif` (241 帧 / 24fps / 360x360, 自带 alpha), **一帧不抽**截到 240 帧, 按 **12fps** 播 = 20 s 一圈、动作是原速的一半, 而运动采样仍是 24fps (每个姿势 83 ms, 不是 6fps 那种 167 ms 的定格感), 成品 **240 帧 / 197x224**
- **`BallTheme.MAX_FRAMES` 由 128 抬到 240** (2026-10-28): 20 s 要 240 帧, 128 装不下 (写进去会整份主题解析失败、球退回内置画法); 代价是解码内存 ~16 MB → **~42 MB**, 而进这一档是主线程把该档全部帧解一遍 (约 1 s 的顿) —— 常规动作仍按 120 帧 / 12 fps 出, 别顺手把所有档都堆到 240
- **这一档的首尾是硬切, 是定下来的, 别去"修"**: 球对单支动作是一直循环的 (`Ball.kt` 的 `advanceFace`: 只有一支时 wrapped 就回 0), 硬切 = 每 20 s 跳一下 (首尾差 26.72, 相邻帧中位 2.71); 2026-10-28 试过的几版 (淡化 2 帧 / 淡化 8 帧 / 来回放 / 6fps) 与"抬上限"都摆给主人看过, 最后定的是这一版 —— `ball-art/_tmp/check-loop-close.py` 里 `EXPECT_CUT = {"peeked"}` 把这个首尾差列为只印不判
- **`动作可用/` 的 GIF 一律用它自带的 alpha, 不再走亮度键** (2026-10-25 主人: "你只要替代那里面有的, 我已经抠图过了"): 旧管线把亮度 10~40 的**黑色线稿**当背景吃了, 判据是"旧帧里亮度 < 60 的不透明像素 = 0"; **webm 那几支沿用 1.1.0 的色键 26..86**, speaking / failed / done 三档仍原样照抄 1.1.0 的帧 —— 重做跑 `ball-art/_tmp/build-matte3.py`, 共享窗口按新 GIF 的包围盒重算

## 工作区与存储

| 用途 | 位置 |
| :-- | :-- |
| `$DSH_HOME` (配置 / 凭据 / 会话) | app 沙盒 `filesDir/dsh-home` |
| 工作区根 | `/sdcard/DSH/`, 没文件权时 `/sdcard/Android/media/<pkg>/DSH` |
| 完全权限会话 | 整个 `/sdcard` |

- **不用 SAF**: 工作区是真实路径, 而 host 是 Node 子进程拿不到 `content://`, 只有 `MANAGE_EXTERNAL_STORAGE` 一条
- `host/Workspace.kt` 三档解析, **每个候选先写探针文件**; 权限只能跳系统页或 `appops set`, 改完重启 host
- `HOME` 指向工作区, dsh 状态仍在 `DSH_HOME`; 完全权限是**会话级** (dsh 侧策略, 不是安卓隔离)
- **`/sdcard` 是 FUSE**: **没有 inotify** (降级轮询) / symlink 受限 / 小 I/O 慢 / 安卓 11+ `Android/data` 别人进不去

## Linux 沙盒

- 随包 Alpine 解到 `/data/local/tmp/lwlinux/rootfs`, 特权通道以 **shell uid** 起 proot; 动词只有 install / run / status / reset
- **不是安全沙盒**: 网络通且关不掉, 边界只有 uid 那条
- **`/work` 是 noexec**: 编译产物落进 rootfs 里再跑 (`cc -o /tmp/hello …`)
- 单条命令 +50 ms, 首装 ~1.5 s; 清理要特权或 adb `rm -rf`

## 构建与验证

- **发版前必须干净构建**, 并验 APK 无"无归属区间": `python tools/apk-bytes.py app/build/outputs/apk/debug/app-debug.apk` (最大那条只应几 KB); **体积突然变大先查旧包还在不在**
- **只发 debug 包**, 发前过 `tools/lw-release-check.ps1` (文件名 / 验签 / 证书固定那把); **换 key 等于所有人卸载重装**
- **提交跳过签名**: 本仓已 `git config commit.gpgsign false` / `tag.gpgsign false`, 新克隆再跑一次
- **装机只走 `tools/lw-install.ps1`**: 流式安装 → 失败退到"推上去 + `pm install -i`" → 回写无障碍与通知 → **拉起并等 `dsh web:` 就绪**; HyperOS 上 `pm install` 会被 `INSTALL_FAILED_USER_RESTRICTED` 挡
- **Luwi 在前台时 MIUI 会拒装** (2026-10-28 两次踩到): 报的还是 `INSTALL_FAILED_USER_RESTRICTED` 与 "Install canceled by user", 但开关是好的 —— 先 `input keyevent KEYCODE_HOME` 把它放到后台, 再 `adb install -r -t -i com.miui.packageinstaller` 就过; 还不行就**同一条命令连着重试** (MIUI 的 AdbInstallActivity 超时会先报失败, 实测第 3 次过); 装完 `am start` 拉回来 (不带 `-S`)
- **改完 Kotlin 先 `:app:compileDebugKotlin`**; 但它**不跑 manifest merger**, 改依赖或 sdk 版本要跑 `assembleDebug`
- 装完**别让设备息屏** (首启解压 3 万文件, 后台被冻住); **别用 `am start -S`** (摘掉无障碍绑定)
- 动 `svc power stayon` 前先读出原值, 收尾写回; 多个设备时每条命令 `-s` 或 `$env:ANDROID_SERIAL`
- 迭代: 改 dsh → `build\lw-dsh-patches.diff` 应用到 submodule → `node tools\pack-host.mjs --dsh third_party\deepseek-harness --out build\host-tree` → `node tools\push-host.mjs build\host-tree` → 重启 app; 改 Kotlin → `assembleDebug` + `adb install -r`
- 判据: `DshHost: dsh web: http://…` = 树起来了; `DshWebView: shell {...}` 里 `rootChildren` 非 0 = GUI 渲染 (那一行还带 `vh`, 界面塌了先看它); 回前台那一趟 `LwMain: resumed with host Running` 且没有第二条 `DshWebView: finished` = 没重载
- 静态判据: `node tools/check-host-persistence.mjs` (renderer 优先级 / 重建上限 / 回前台自愈 / 白名单只有一份实现) 与 `node tools/check-web-compat.mjs` (兼容层 + 更新指引)
- **host 树逐文件裁剪在 `pack-host.mjs` 末尾** (2026-10-29): 剔 win32/darwin 预编译、`.pdb`/`.exe`、`.map`、`.d.ts`、README 那类 `.md`、测试目录与测试文件, 保留 wasm / LICENSE / linux prebuild; 实测 36,030 → 17,526 文件、`host.zip` 64.8 MB (原 ~98.9)。判据 `node tools/check-host-slim.mjs` (源码形状 + 真树零残留), **别用事后重打 zip 的脚本** —— 那样 `host-version.txt` 的 `entries` 与树对不上
- **`packageDebug` 会在旧 APK 上原地改写**: 条目内容变了会留空洞 (实测 17 MB, 条目 sum 只 251 MB 而文件 268 MB), `apk-bytes.py` 会报几 MB 的"无归属区间"。**出包前先删 `app/build/outputs/apk/debug/app-debug.apk`**

## 推送与发布 (github.com:443 被挡)

- `git push` 不通, `api.github.com` / `uploads.github.com` 通; 走 `tools/lw-api-push.ps1`: blob → tree → commit → **最后才动 ref**, 每个对象逐个比 SHA, 先 dry run 再 `-Apply -Tag`
- SSH 443 通, 但那把 key 属另一个账号且 GitHub SSH 不许端口转发
- `-input` 的 JSON 不能带 BOM; 提交正文末尾那个换行是对象里本来就有的

## 还能做

- OCR: 换更强的 **rec** (det 的天花板已量过: tiny/small/medium 与 960 都试了, 字数不变) / 试 ORT 自己导出 ctx (可去掉 70 MB) / 若遇到真正的小字页面再拿 `models-960` 复测
- **主屏取图去 uid** (2026-10-29 讨论过, 没做): display 0 目前只有特权 `screencap -p`。无障碍 `AccessibilityService.takeScreenshot()` 不需要 uid (服务本来就开着), 换来的是系统节流 (约 1 秒一次)、只能拍默认屏、要重接状态栏裁剪与坐标口径; 主屏 OCR 属兜底场景, 先留着
- jniLibs 挂 Release 由 Gradle 下载; `node-pty` 可以删
