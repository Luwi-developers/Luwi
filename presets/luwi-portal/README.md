# luwi-portal

盖在 dsh 对话界面上的一张门户: **与球共用同一场会话**, 并把判断层 (router) 与工作结构 (explore 的
nextTask + router 的 checks) 摆在同一屏上

## 这一屏的四件事 (2026-11-08)

1. **中间那张脸**: 这一场没有消息时, `#lwp-flow` 里画 `#lwp-hero` —— 96px 的品牌标记
   (`MARK_PNG`, 由 `tools/make-portal-mark.py` 从 `tools/brand/luwi-mark.png` 生成并内嵌, 透明底染
   `#01B4FF`) + `Luwi` + 一句「在的，说吧」。有消息时这一块不画 (屏幕中间归对话)。没有会话时
   多挂一颗「开一场」
2. **左上角头像 = 历史窗** (2026-11-19 改口径, 原「开新对话」):
   `#lwp-brand` 只有 28px 头像那么大 (**热区就是头像**), 点一下开 `#lwp-history`; 旁边的昵称与读数
   只是标识, 点不动 —— 于是 `#lwp-head` 是「头像 + 名字 ... 喇叭 + 终端 + `⋯`」, 那颗「历史」胶囊已撤。
   右边那三颗是 2026-11-20 定的, 并且**装进 `#lwp-tabs` 一簇、整簇靠最右**: **自动朗读 (喇叭图标钮) → 终端** (原「同步」, 从 `⋯` 抽屉搬上来的那一颗; **2026-11-22 起它是一个开关**: 不在终端时写「终端」, 点它进终端那一页, 在终端里改写成「对话」, 点它回门户那一场 —— 头栏不再有 `‹` 返回钮) →
   **`⋯` 更多**; **抽屉里因此不再画「终端」那一行**
   (球菜单下的是原生清单, 那一行还在)。
   开新对话走历史窗底部的「开始新的对话」(`startFromHistory`) 与首启的 `autoStart()`, 路径仍是
   `newConversation()`: `startSession()` → 轮询 `currentSessionId()` 每 150 ms 最多 24 次 →
   `adopt` + **`portalBind`**(不写账会被 3 s 之后的 `pollLedger` 拽回旧场) + 8 s 的「已开新对话」读数。
   旧会话不删不归档, 只是这一层不再画它。
   **那颗读数是一层浮层** (`position:absolute`, `z-index:2`, `pointer-events:none`, `top` 按头栏高度写):
   出现与收起都不改 `#lwp-flow` 的高度, 中间的图文不跟着下移再弹回来。
   **这里没有「撤销」**: 上一场在切走后会被 dsh 卸载, 回来要重新 `openSession`, 而 `sessions.retain`
   只认当前工作区里还挂着的会话 —— 真机实测一律 `unknown session`, 异步重试 3.2 s 也救不回来。
   摆一颗按下去只回一句「打不开了」的按钮比没有更糟, 所以那一格只留读数
3. **30 分钟分段**: `sectionsOf()` 在相邻两条超过 `SECTION_GAP_MS` (30 min) 或跨日时另起一段,
   段头是一枚 `.lwp-sep` 药丸 (`今天 14:32` / `昨天 21:05` / `11月7日 21:05` / 跨年才带年份)。
   时间读不到 (0 / 缺) 的那条不参与切段
4. **下次回来还在这一场**: `adopt()` 每次把 sessionId 写进 `localStorage['dsh.luwi.portal.session']`,
   `mount()` 走 `restore()` 先读它并 `follow()` —— 换一场只剩点左上角那一条路。记忆里的场已经不
   在 (binding 拿不到) 就清掉记忆、落回 dsh 当前那一场

**`follow()` 是"先轻后重"** (2026-11-08 真机踩出来的): `adopt` 只读 binding, 会话在列表里时门户自己
就画得出来; `openSession` 是让 dsh 的 mainView 也跟过去, 它要先 `sessions.retain()` 得住那个 id,
**不在当前会话列表里的会话会抛 `sessions.retain: unknown session`** (归档 / 已删 / 属于别的工作区)。
所以依次: `adopt` → 画不出来才 `openSession` → 还不行就 `workspaceOf(id)` 找到它挂在哪个工作区、
`openWorkspace()` 切过去 (下一轮 `pollLedger` 再 open 一次) → 三条都不行才**退回原来那一场**并在输入
卡上说一句 (`那一场打不开了`), 不把界面空在那里; 账本那边同时静 15 s, 别每 3 s 撞同一条错误

## 它是什么, 不是什么

- **是**一层覆盖: `shell.overlay` 之外的一层固定定位 DOM (`#lwp-root`), 把 dsh 的对话界面整块盖住
- **是**同一场会话: 认 `$DSH_HOME/voice/session.json` 那本账 (球说话时宿主 `voiceCurrentSession()`
  认的也是这一本), 所以"在应用里说"与"在外面用球说"落在同一个 sessionId, 两边看到同一个消息流
- **不是**另一套会话引擎: 消息从 dsh 的 `ChatSnapshot` 取, 提交走 `beginSubmission` + `prompt`
  (与输入框同一条路), 不自己实现队列 / steering / 草稿
- **不是**过程视图: 思考块、工具调用、步骤过程、消息图标一律不画, 只画 user / assistant / 失败

## 挂载

| 位置 | 内容 |
| :-- | :-- |
| `PluginOverlay.kt` | `PLUGINS` 与 `OWN_PLUGINS` 各一行 `Row("luwi-portal", "node_modules/luwi-portal/index.mjs")` |
| `tools/pack-host.mjs` | 把本目录拷进 host 树的 `node_modules/luwi-portal` |
| `app/src/main/.../ui/HostScreen.kt` | `addJavascriptInterface(PortalBridge(...), "LuwiPortal")` |

宿主那一半 (`index.mjs`) 是空壳: 只为了让 Loader 认这一行 (dsh 的 client-modules 只扫**已挂载的行**
里声明了 `dsh.client` 的包), 界面与数据全在 `lib/client.js`

## 桥 (`window.LuwiPortal`, Kotlin 侧 `ui/PortalBridge.kt`)

| 方法 | 做什么 |
| :-- | :-- |
| `portalStatus()` | 读 `lw/router.json` + `lw/sim.json` + `lw/explore.json`, 原样回给页面 (不做判断); 探索那几行读的是**真的落点**: 任务卡 `lw/explore-card.md` (`ExploreTask`)、摘要目录 `lw/explore/*.md` 最新那份、排期 `explore-schedule.json` (`ExploreSchedule.plan`), 外加 `enabled` / `nextAt` / `running` |
| `portalSession()` | 读 `voice/session.json`, 回 `{id, at, usable, remainMs, workspacePath}` |
| `portalLook(wantWall)` | 读 `lw/face.json` + `lw/face/<图>` (设置 → 外观), 回 `{alpha, wall, ver}`; `wantWall=true` 才把图编成 data URL (几万字), 平时只问 `alpha`/`ver`; `ver` 是文件名, 页面拿它当缓存键 |
| `portalBind(id)` | 把这一场写进账本 (`origin:"ball"`, `cwd` = `dsh-ball`), 球接下来 10 分钟接的就是它 |
| `portalTick()` | 往收件箱投一行 `source:"router"` + `RouterTick.ensure` (与定时唤醒同一个入口) |
| `portalTickEnabled(on)` | `RouterTick.setEnabled` |
| `portalCheckDone(id)` | `RouterChecks.drop` |
| `portalExplore()` | 往收件箱投一行 `source:"explore"`, 正文是那张任务卡 (`lw/explore-card.md`); 已经有一场在跑时回 `running:true` 且不投 |

## 那张脸 (输入卡 / 权限 / 模型 / 命令 / 背景 / 玻璃)

- **输入卡照 dsh 的 `InputBar`**: 28px 圆角 (`--dsw-radius-panel`)、`--dsw-specific-input-major`
  的实底、`--dsw-elevation-soft` 的投影; 卡里的行序与 dsh 一致 —— **待发附件行 → 文本区 → 底部
  一行** (2026-11-10 主人: "附件发图片和发表情包, 应该要在输入框上方显示, 像 dsh 原生那样")。
  底部一行左边 `+` 与表情钮、右边模型 chip 与 34px 圆钮。**输入卡上不画工作区选择**, 预设那一档也
  **已取消** (2026-11-08 主人); 工作区只在空态那颗「选工作区」(见下节)
- **输入框灰字是「发消息或长按说话」** (2026-11-20 主人): 全靠这一句告诉人「长按就能说话」。
  **空草稿长按 450 ms 就当场开录** (`contextmenu` 一并吃掉, 免得系统的选中菜单盖在面板上);
  有字时长按仍归浏览器的选中 / 粘贴
- **长按说话那条录音条** (`#lwp-rec`, 照官方截图 + wavesurfer 那套读法): 压住输入卡那一块再高出半截 ——
  左右/底各 12px, **高度 = 输入卡实测高 × 1.5** (`REC_PANEL_MAX 210` 封顶), 圆角 28。
  第一行左「红点呼吸 + **「松手转写，上滑取消」**」右「计时胶囊 `0:03 / 1:00`」, 第二行是走带波形。
  **边缘是渐变**: 条子的上沿 `-webkit-mask-image` 22px 淡出 (与页面之间没有硬接缝), 波形左右两端各 9% 淡出;
  mask 会裁掉外投影, 所以材质只留上沿 1 px 内高光 + 顶部径向柔光 + 3.5% 噪点。
  波形是**真波形**, 不是一排等高柱子: 每 40 ms 折一列 (`REC_SAMPLE_MS`, 窗口 80 列), 峰值 → 保持 (0.995 衰减)
  → 归一化 (`ratio ** 0.6`, 低于 0.02 当静音) → 快起 0.6 / 慢落 0.12; 几何在 `recWaveRects` (走带右对齐 /
  条宽 2 + 缝 1 + 圆角帽 1 + 最小高 2, 镜像于中线), 旧的往左淡出 + 右端柔光点。
  **帧循环起在 `voiceState = 'recording'` 之后** (`startRecPump`): 早一帧时麦克风还没到手, pump 会立刻退出 ——
  那就是上一版"条不动"的真因。
  **上滑过 56 px** 进「松开取消」态 (条下沉 + 退成中性灰 + 出现向下箭头 + 提示换字), 松手丢弃并说一句
  「已取消」; 松手默认转写 (条上换「正在转写…」+ 三个跳动点), 文字接进草稿 (有字时前留一个空格, 光标到末尾)。
  条 `pointer-events:none`, 抬手/上滑挂在 `window` 上
  —— 手指还压在输入框上, 换 DOM 会把抬手事件吞掉。录音在页面
  (`getUserMedia` + `AudioContext` + `ScriptProcessor`, `wavOf()` 封 16 kHz 单声道 PCM16), **上限 60 s**、
  短于 0.5 s 当误触; 转写在应用 (`ui/PortalVoice.kt` → `LwSpeech.dispatch`, 引擎跟 `lw/voice-source.json`),
  桥是 `portalVoice` (status / ask / transcribe / cancel), 结果经 `__LUWI_PORTAL__.voice` 回推。没权限 /
  缺模型 / 没登录 / 太短各有一句人话, 不许静默
- **顶栏那颗喇叭 = 语音输出（自动朗读）开关**: 翻的是 设置 → 说话 → 「朗读回答」那一格
  (`SpeakSettings.readAloud`, 一处状态两处界面, 桥是 `portalSpeak`), 两副图标——**关 = 喇叭 + 斜杠 /
  开 = 喇叭 + 两道声波**, Toast 照官方那两张图写 **「已开启自动朗读」/「已关闭自动朗读」**
- **待发附件行** (`#lwp-attach-row`): 图与表情是 64px 缩略图 + 右上角 `×` (照 dsh 的
  `ComposerAttachments`: 圆角 16 / `object-fit:cover` / `pointer:coarse` 时常显), 非图片文件是一颗
  「名字 · 大小 · 状态」chip; 顺序就是挑选 / 点的顺序, `reading` 有扫光、`error` 红描边, 全部 ready
  才允许发 (上限 6 个不变)
- **点表情 = 进待发栏** (2026-11-10 主人确认): `stageSticker` 先 push 占位再取字节 (连点几张顺序
  不翻), 落 `lw-in/` 后变成一颗 ready 的缩略图, 面板随即收起; **不再点一下就发**, 发不发由那颗发送钮
  说了算。发送时仍走 `attachLines()` 那一段 (`read_image` 打开), 与图片同一条路
- **`+`** = dsh 那个加号: 开命令菜单 (`remote.commands.list(sessionId)`), 选一条把 `/名字 ` 插进草稿
- **权限 chip**: 名字走 dsh 的字典 (`permission.access` 的 `preset.fullAccess` → 「完全权限」),
  名单走 `remote.permissionPresets.catalog()`, 切换走宿主那条 `/permission <preset>` 命令。
  **默认完全权限**: 这一层落到一场上时若还不是 `danger-full-access` 就拨一次 (每场只拨一次),
  并且**首次**把宿主 settings 的 `permission.defaultPreset` 也写成它 (以后新开会话天生完全权限;
  只写一次, 主人之后改的档不会被改回来)
- **模型 chip**: 与 dsh 那颗共用 `ctx.modelDirectories` 的同一份目录 (`directoryFor(sessionId)`),
  显示当前模型的名字, 换模型走 `directory.select({provider, model})`; 目录的 store 挂了订阅, 别处
  换了模型 chip 当场跟着改
- **门户里换的模型 = 新会话的模型** (2026-11-20): dsh 那条 `selectModel` 会把这次选择同时落成宿主
  默认, 而**新对话复用的是工作区里那张空白场** —— 它早先记过的 `model/selection` 会把新会话按老模型
  发出去。所以落到一张**空白场**上时, 门户自己问一次 `remote.session.modelCatalog()`, 与
  `modelState.current` 比 (`blankModelNeedsDefault`, 纯函数): 不一致就 `select(默认)` 拨回去, 一致或
  拿不到就什么都不做。**非空白场永远不拨** (那一场自己选过的模型归它自己); 同一档只问一次
- **后台 dsh 发的图也画真图** (2026-11-20 主人: "这个在后台dsh内发送的图要求也要在门户上显示"):
  浮球 / 原生会话界面发出去的图不经门户 `lw-in` stash, 落盘只剩
  `{type:'image', attachment:{attachmentId, mediaType, width, height, bytes, name}}` ——
  门户走 `ctx.uiConversation.peekImageUrl / imageUrl(sessionId, attachment)` 取那张 (blob URL, 按会话
  缓存), 先钉 `width/height` 再解码, 取不到就写「图没取到」; 点一下仍进预览窗 (给 `src` 那一档)。
  单条最多画 4 张, 多出来的写「+N 张图」; 一条引用都没有的旧消息才回落到「（图）」
- **背景与浓淡**: 设置 → 外观 落 `$DSH_HOME/lw/face.json` (`{alpha, wall}`) 与一张
  `$DSH_HOME/lw/face/<名字>.jpg` (`tool/PortalFace.kt` 是唯一写者, 换图只留一张)。页面拿
  `--lwp-wall-alpha` 与 `#lwp-wall` 的 `background-image` 上屏, 图按 `ver` 缓存在 localStorage
- **玻璃**: 气泡 / 抽屉 / 菜单都用 PC 上 dsh 那一组 token —— `--dsw-menu-surface-fill`
  (`#fcfdfeb3`) + `--dsw-menu-backdrop-filter` (`blur(40px) saturate(150%)`) + `--dsw-elevation-panel`,
  只写变量、后面跟同值字面量兜底。输入卡不玻璃 (dsh 的输入卡本来就不是)
- **顶条不显示会话标题** (2026-11-08 主人): 只剩 `Luwi` + 账本那一句 (`球的场 剩 N 分`)



**判断只在宿主那一处**: 门户显示的是 `router.json` 的 `last` (宿主 `judgeRouter` 判完写的), 它自己
不重算, 所以抽屉里那句 `why` 与宿主真的判过的那一次逐字一致

**探索面板 (`⋯ → 探索`) 的四行照盘上那份写** (2.8.1 #12): 下一趟 = 任务卡摘要 + 字数, 上次摘要 =
`lw/explore/` 最新那份的修改时刻, 探索时刻 = `explore-schedule.json` 的 `at` (关着就写明), 这一趟 =
`ExploreTask.running` 的判据。抽屉开着时每一拍 (`pollLedger`, 3 s) 比一次 `workKey`, 盘上变了才重画;
**「开始这一趟」「刷新」各留一句 toast** (`#lwp-toast`, 2.4 s 自己收) —— 抽屉盖着时输入卡那行
`#lwp-note` 在后面, 写了也看不见, 按下去于是与"没接上"同形

## 首启自动落进 `<工作区根>/Luwi` (2026-11-13 改口径, 原「选工作区」作废)

`pm clear` 之后 dsh 那一边可能一个工作区都没有, 而这一层把 dsh 的界面整块盖住: 落不下去就等于
一句话都发不出去。主人 2026-11-13 定了口径 —— **直接默认使用 `<工作区根>/Luwi`, 界面不给任何要人
点的选择入口**: 原来那颗 `#lwp-pick-workspace` 按钮与 `#lwp-pick` 那一窗已整段删除, 改成静默落位。

- **宿主那一半先备好**: 宿主一起来 (客户端开屏之前) 就走 `ensureExploreWorkspace` —— 目录不在就建
  (`/sdcard/DSH/Luwi`), 建完 `registry.create` 注册; dsh 那一侧于是不会去问系统 Documents (那条在
  安卓上必失败, 日志 `system Documents directory is unavailable`)。探索投递那条路用的是同一个函数
- **客户端这一半兜底**: `landInDefaultWorkspace(from)` 先看列表, 一条都没有就请应用备目录
  (`window.LuwiPortal.portalWorkspace(true)`, 目录由 `Workspace.resolve` 三档解析) → `workspaces.create({path})`
  (幂等) → 250 ms × 12 拍等列表 → `openWorkspace(id)`; **不走 dsh 的 `initializeDefault`** (那条缺省工作区在
  `<系统 Documents>/deepseek-harness/default-workspace`)。全程不弹窗, 没成只留一句提示 + 一次 15 s 补试
- **挑哪一条**: `defaultWorkspaceId(items, wantPath)` 按路径认 (尾部 `/` 归一), 认不到退列表第一条 ——
  这条是纯函数, 判据真跑
- 落到那一场与「开新对话」同一套: 等 `currentSessionId()` (150 ms × 24) → `switchTo(id, 'new')` +
  `portalBind` + 15 s 不跟账本, 于是下一句发得出去、也不会被 3 s 的账本拽走

判据: `node tools/check-luwi-portal.mjs` 第十三节 (⑨ 那一套名字一个都不许留 / 落位链接着 / `defaultWorkspaceId`
真跑), `node tools/check-explore.mjs` 第十四节 (启动走 `ensureExploreWorkspace`, `adopt*` 不许回来)

## 预览窗 (2026-11-09)

点气泡里那行蓝字文件名就张一张居中的窗: 左右各留 20dp、**高度固定 78vh**、遮罩 40% 黑。**窗口大小只由
屏幕决定, 不跟着内容缩** (2026-11-09 主人: "预览窗口应当固定大小") —— 短文件也张这么大, 长的那一份在
卡片里自己滚。内容分四路:

| 这一份是 | 怎么显示 |
| :-- | :-- |
| 图 | `<img>` 直接给 (`/lw-out/...`) |
| 文本 (txt / md / csv / log / json) | `<pre>`, 取前 256 KB, 截断就多说一句 |
| **Office (docx / pptx / xlsx)** | 宿主给字节 → `lw-docx-preview` 的 `renderOffice` → 进 shadow root |
| 其它 (zip / pdf / doc / ppt / xls …) | 照实说一句 + 一颗「用其它应用打开」(`luwi-open://`) |

- **渲染器只此一份**: `renderOffice` 就是 dsh 右栏那个 tab 用的同一个函数 (docx-preview 转 docx,
  自己解 OOXML 抽 pptx 每页文字与图、xlsx 每页格子)。门户按包名 `require('lw-docx-preview')`, 取不到
  退 `window.__LW_OFFICE__`, 再取不到就说「预览模块没挂上」并给系统那条路 —— 不摆假预览
- 上限: 宿主那条路由 12 MB 直接 413, 渲染那一侧 10 MB (`MAX_BYTES`); xlsx 只出前 4 页 × 200 行 ×
  26 列, pptx 只出文字与图
- 失败三档分开说: 取不到 / 太大 / 解不开

## 键盘那一格 (2026-11-09 主人: "呼出键盘时不应整个界面上移, 只要输入框和聊天记录向上移")

- **门户盖着时 WebView 尺寸一点都不动** (`HostScreen.kt`: `if (portalOpen) modifier else
  modifier.padding(bottom = imeLift)`)。宿主把 `ime - nav` 推给页面 (`__LUWI_PORTAL__.setKeyboard`),
  页面只写一个变量 `--lwp-ime` (`#lwp-root` 的 `padding-bottom`) —— 于是抬起来的只有对话区与输入卡
- **推过来的数必须是 dp, 不是设备像素**: WebView 里 1 CSS px 就是 1 dp (393 宽的屏报 393 CSS px,
  屏本身 1080 设备像素)。拿 `roundToPx()` 那笔 (922) 当 CSS px 写下去就是整屏高 —— 2026-11-09 真机
  踩到, 输入卡被顶到顶栏下面; 页面那侧另有一道 75% 视口的夹子兜底
- `portalVisible(true)` **必须在挂载时报**: 只报 `false` 的那一版让宿主一直以为门户没开, 菜单方向与
  键盘让位都跟着错 (2026-11-09 一并修好)
- `#lwp-wall` 是 `position:absolute; inset:0`, 包含块是那一层的 **padding box**, 所以 padding 变了
  背景图盒子不变: 那一整张照片不重绘 (整页被顶上去的观感主要就是它)
- 宿主同时把 IME inset 从 WebView 里吃掉 (`setOnApplyWindowInsetsListener` 把 `Type.ime()` 置空):
  app 已经自己让过了, Chromium 若再缩一次可视视口就会顺手平移整页 (定位在 `position:fixed` 的那层
  也跟着走)
- **页面刷新 / 收起再张**那一档由挂载握手补上: `LuwiPortal.portalIme()` 回最近一次那个数
- 收起门户之后仍是旧做法 (缩 WebView): dsh 不认识 `--lwp-ime`, 它的输入框靠缩视口贴到键盘上沿

## 开关与回退

- `localStorage['dsh.luwi.portal']`: `on` (默认) / `off`
- `localStorage['dsh.luwi.portal.session']`: 这一层上次画的那一场 (挂载时先回到它)
- `localStorage['dsh.luwi.portal.preset']`: 还没开场时选的那一档 (下一场生效)
- `localStorage['dsh.luwi.portal.wall']`: 背景图的缓存 (`{ver, url}`), 换一张才重搬
- **进出只有 Luwi 菜单一个入口** (右上那颗 Tune): 门户开着时那一条是「回到后台」(dsh 那一屏), 收起之后
  变成「回到前台」(这一层)。界面上不放这两颗按钮 (2026-11-07 主人: "和返回 dsh 这些都加到 luwi 菜单里,
  不放界面上")
- 菜单那一条走的是 `window.__LUWI_PORTAL__` 的 `show()` / `hide()` (`HostScreen.kt` 的
  `PortalState` 握着 `evaluateJavascript` 那条入口); 门户每次挂载/收起报 `portalVisible`, 菜单靠它
  决定方向
- **收起门户时先开一张新对话** (2026-11-08 主人: "返回 dsh 时改成进入 dsh 的新对话界面"): `hide()`
  在撤掉覆盖层之前调一次 `ctx.uiWorkspace.startSession()`, 于是落进 dsh 的空白对话而不是落回门户
  刚映射过的那一场。不带参数时由 dsh 自己挑工作区并复用已有草稿, 不会每收一次就多一场空会话;
  开不出来就照旧落回原来那一场
- 彻底撤: `PluginOverlay` 摘掉那一行, 或把键置 `off` —— dsh 一个字节没动
- 脸回到出厂: 删 `$DSH_HOME/lw/face.json` 与 `$DSH_HOME/lw/face/` (或设置 → 外观里清掉背景)

## 时间线: 按「轮」排 (2026-11-10)

两路流 (dsh 的 user 节点 / 她的话那份 jsonl) **不再只按墙上时钟排** (方案
`docs/Luwi-门户附件条与时间线-方案-2026-11-10.md`)。`nodesOf()` 把它们收成
`users` / `rows` / `extras` 三份, 交给纯函数 `orderTimeline()`:

| 口径 | 做法 |
| :-- | :-- |
| 轮内 | `user` → 她的行 (按 jsonl `seq`) → `turn-error` → 兜底正文 |
| 轮边界 | 行按 `at` 归到最后一个 `turnTime < at` 的轮 (同一毫秒算**上一轮**: 宿主 turn end 补句贴在轮尾) |
| 缺时间 | user 缺时间 → `maxKnown + 序号` 沉到最后 (dsh 追加, 它就是最新那条); 行缺 `at` → 最后一轮、按 `seq` 沉后 |
| 时钟回卷 | `turnTime` 单调不减; 早于第一轮的行落「前奏桶」, user 相对顺序不翻 |
| 兜底正文 | `luwi` 档**不兜** (宿主 turn end 已补一行, 两边同源); 非 luwi 档才兜, 且钉在 `assistantOwner` 那一轮 |

配套的宿主改动: `lwOutAppend(..., atHint)` —— turn/end 补的那一句把 `at` 钉在**轮尾** (`event.time`),
不取写盘那一刻 (异步补得慢会"比下一条用户消息还新", 门户拼轴就排到新消息后面)。`seq` 仍是唯一顺序,
`at` 只做显示与拼轴 (`OutFile.kt` 那条口径不变)。

## 判据

```powershell
node D:\apk\Luwi\tools\check-luwi-portal.mjs
node D:\apk\Luwi\tools\check-portal-order.mjs
node D:\apk\Luwi\tools\check-portal-sections.mjs
```

`check-luwi-portal` 查: 包里该有的都在 (含依赖的 dsh 内部名字) / 挂得上 (两张表 + pack-host + 桥) /
两处写死的量对得上 (工作区名 `dsh-ball`、账本窗口 `10 * 60 * 1000`) / 附件条在文本区之前 /
表情只进待发栏。`check-portal-order` 把 `orderTimeline` 从源码原样截出来真跑 16 条 (12 条用例 +
4 条源码结构: 缺时间 / 同毫秒 / 时钟回卷 / 兜底不改嫁)。

