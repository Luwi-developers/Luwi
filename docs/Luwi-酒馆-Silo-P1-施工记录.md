# Luwi 酒馆 Silo P1 施工记录 (2026-10-24)

这份记的是**方案落到代码里的现状**: 哪几块在哪、判据是什么、验收走到哪一步。方案本身在
`docs/Luwi-酒馆-Silo-P1实现方案-20261024.md`, 两份一起看。

**一句话**: P1 是一层只依赖 `webServer + llm` 的小应用 —— 一个 host 插件 + 一个独立聊天页 + 一个原生
设置段。它不建 DSH 会话, 不注册工具, 不碰记忆, 数据只写 `$DSH_HOME/lw/tavern`。

---

## 1. 落位

| 层 | 路径 | 内容 |
| :-- | :-- | :-- |
| host 插件 | `host-plugins/luwi-tavern/` | `index.mjs` + `lib/` 十二个模块 + `web/` + `test/` |
| 原生数据面 | `app/src/main/java/…/tavern/` | `TavernModels` / `TavernApi` / `TavernStore` / `TavernImport` / `TavernImages` |
| 原生界面 | `app/src/main/java/…/ui/` | `TavernSection` (设置段) / `TavernManageScreen` (五个 tab) / `TavernChatScreen` (WebView) |
| 接线 | `PluginOverlay.kt` / `pack-host.mjs` / `AppNav.kt` / `SettingsScreen.kt` | 两张插件表、打包拷贝、两页导航、第 19 段 |
| 判据 | `tools/check-tavern.mjs` (26 条) + 插件自带 `node --test` (97 条) + 两个 Kotlin 单测 | |

host 那一半的模块分工与方案 3.1 那张表一致: `paths` (数据根唯一一处) / `config` / `store` (原子 JSON 与
JSONL) / `gate` (工作区门闸) / `cards` (PNG tEXt+iTXt+ccv3 / JSON V1-V3 / CHARX) / `worldbooks` (ST
World Info 两种形状) / `sessions` / `speaker` (一轮一人) / `prompt` (八节预算与串台保护) / `themes` /
`http` (JSON/multipart/静态文件) / `token`。

## 2. 与方案的两处偏差 (都是有理由的)

1. **多了一条 `GET /lw-tavern/api/profile/avatar`**。方案第 5 节那张表只有 `POST` 那一条, 而设置段与
   聊天页都要把用户的头像显示出来 —— 没有 GET 就只能拿到一个 URL。`check-tavern.mjs` 里那张期望表
   写的是 21 条 (方案 20 条 + 这一条), 注释也写了原因。
2. **配置那条路由带 `allowUnconfigured`**。方案说 `PUT /api/config` 过门闸, 而门闸的三档里"未绑定"与
   "关着"都会 409 —— 那正好是"绑定"与"打开"这两个动作要去的那两档, 严格照字面实现会让开关永远点不开。
   于是只有 `/config` 的 GET/PUT 在这两档放行 (不匹配仍然 403), 其余全部按方案走。

## 3. 关键判据

- **数据根**: `path.mjs` 的 `TAVERN_RELATIVE = join('lw','tavern')` 是唯一一处; `index.mjs` 只做
  `join(env.root, ...)`。`check-tavern` 数的是"`join('lw','tavern')` 在 index.mjs 里出现 0 次"。
- **token**: 32 字节十六进制, 写 0600, 只拼一次路径; 比对走 `timingSafeEqual` (长度不等直接 false)。
- **鉴权**: header 与 cookie 两条; 只收回环; `Host` 必须本机; 有 `Origin` 时必须同源; 不做 CORS。
- **门闸**: `realpath(process.cwd()) == config.workspacePath`; 未绑定 409 / 关着 409 / 不匹配 403。
- **一轮一人**: 手动 > `@名字` > 加权随机 (基础 talkativeness, 上一轮 ×0.05, 空窗 `1+min(3,gap/12)`,
  `gap>=40` 再 ×5)。
- **预算**: 八节各有硬上限, 合计 8000; 超了按"对白从旧丢 → 世界书低优先级丢 → 例句 600 → 描述 800"裁,
  还超就 413 `budget_exceeded` (不静默截人设)。
- **串台**: 行首 `[别人]` / `别人：` / `（别人）说` / `别人说：` 四种形态, 截到第一个泄漏点并回
  `guard.leaked`。
- **主题**: 六套 CSS 只写 `--SmartTheme*` 变量, 布局那一份不写死颜色; 玻璃在无 `backdrop-filter` 时
  加 `.no-backdrop` 退成不透明。

## 4. 判据怎么跑

```powershell
# host 插件那一半 (真起 HTTP 服务, 模型是假的)
cd D:\apk\Luwi\host-plugins\luwi-tavern; node --test

# 静态判据 (路由表 / 隔离 / 数据根 / 静态页 / 接线 / 两语 / 依赖)
pwsh -File D:\apk\dev.ps1 gradle -Task ':app:compileDebugKotlin'  # 先能编过
node tools/check-tavern.mjs
node tools/check-settings-sections.mjs
node tools/check-strings-keys.mjs

# Kotlin 单测
pwsh -File D:\apk\dev.ps1 gradle -Task ':app:testDebugUnitTest --tests "io.github.yuloong07star.luwi.tavern.*"'
```

2026-10-24 的读数: `node --test` 97 通过 (76 逻辑 + 21 HTTP), `check-tavern` 26/26,
`check-settings-sections` 11/11, `check-strings-keys` 5/5, Kotlin 三个类 17 条 (`TavernModelsTest` 7 /
`TavernImportTest` 4 / `SettingsSectionsTest` 6)。

## 5. 验收进度

**真机 (小米 13 / `22041216C`, Android 16) 2026-10-24 21:08 装过一次** (就是这份 debug 包), 之后所有
读数都在那台机器上量的; 模拟器 (`Luwi_API36`) 20:33 那一趟留作对照。

| 方案 10.4 的条目 | 读数 |
| :-- | :-- |
| 设置里出现「酒馆」; 未绑定 / 已绑定 / 不匹配 / 关着四档 | `已绑定 DSH` (收起时也对); 四档有纯函数与单测 |
| 绑定当前工作区后管理页能打开; 换工作区后 API 403 | 绑定后 `gate.match=true`; 换工作区那一条在桌面集成测试里 (403 `workspace-mismatch`) |
| PNG `tEXt` 与 `iTXt` 卡都能导入; 故事书能导入 | 两张都进 (青鸟 / 老周), 故事书 3 条进 2 条 (空条目丢掉) |
| 3 人会话: 一轮一人, 头像/名字对; `@` 能换人 | `@老周` → `reason=mention:老周`; 手动 `speakerId` → `reason=manual` |
| 10 人会话: 首轮估算 ≤8k; 20 轮不超预算; 无串台 | 首轮 `estimated=556`; 连发 14 轮涨到 `1783`, 每轮 `guard.leaked=false`, 一次裁剪都没触发 |
| 六套主题可切, 重启后保持; 玻璃降级 | 会话级换到 `夜曲` 后 `meta.json` 是 `nocturne`, 重开聊天页就是那套; 模拟器上量过 `.no-backdrop` |
| 数据只在 `$DSH_HOME/lw/tavern/workspaces/<id>` | 真机与模拟器都是 `a07d18ee5d2bbd47` |
| 隔离三条 | 酒馆一轮前后 `memory/memory.db` sha256 不变, `$DSH_HOME/sessions` 15 → 15 |
| 静态判据 / 单测全绿 | `check-tavern` 26/26, 插件 `node --test` 98/98, Kotlin 21/21 (4 类) |

一条**真回复** (真机, 青鸟): "（偏头看了旅人一会儿，把背上的小邮包挪了挪）房间该问老周。（伸翅膀指了指门边那把空椅子）坐。"
—— `usage` 191 / 141, `elapsedMs` 2138, `turnCount` 1。

### 5.1 修掉的三条 (都是真机/模拟器上量出来的)

1. **`hidden` 属性被自己的 CSS 盖掉**: 空态 / 锁定态 / 正在想三块写的是 `display: flex`, 而作者样式
   盖得过浏览器默认的 `[hidden] { display: none }` —— 现象是聊天页上同时叠着"当前工作区不是绑定的
   酒馆工作区"与"还没有会话, 去 Luwi 设置里建一个"。修法是 `app.css` 顶上一条
   `[hidden] { display: none !important; }` (修完那张截图是 `shots/2026-10-24-205115-emulator-5554-tavern-chat2.png`)
2. **会话级主题没有入口**: 方案 9.2 说"会话级主题在会话编辑里", 而 P1 没有会话编辑页 —— 于是那六套
   主题只能改默认那一套。现在主题 tab 里分两段: 「默认主题」与「这场会话的主题」 (后者只在
   `config.activeSessionId` 有值时才列)。会话删除也有了入口 (列表行右边那个「删除」)
3. **`messages[].content` 是内容块数组, 不是一个字符串** (最贵的一条): dsh 的 `MessageBase.content`
   是 `ContentBlock[]`, 而酒馆第一版直接把一句话当字符串塞进去 —— 适配器把它当可迭代对象逐字走,
   抛成一句 `DeepSeek Messages transport failed`, 在真机上表现为"每一轮都 502", 而**本地假模型不看
   这个字段, 于是 98 条单测全绿也发现不了**。改成 `[{ type: 'text', text }]` 之后真机第一轮就通了;
   判据也补进了单测 (那一条现在断言 `content[0].type === 'text'`), 摘要那一处同样的写法一起改了

## 6. 一个构建上的坑 (与酒馆无关, 但会认错账)

2026-10-24 这一轮 `assembleDebug` 出的是 **332.1 MB**, 而 2.7.9 的干净构建是 233.5 MB。差的不是
酒馆: host 树只从 341.4 MB 长到 341.6 MB (+0.2 MB, 35814 → 35840 个文件), 而 APK 的条目压缩总量从
233.5 MB 只涨到 233.9 MB。多出来的 ~98 MB 是**本地区里两段没人认领的空洞** (zip 中央目录之外的数据):
`lib/arm64-v8a/libQnnHtp.so` 前面 13.1 MB, `assets/lwlinux/base.tgz` 前面 85.0 MB —— 增量打包把改过的
大条目重写了一遍, 旧的那一份留在文件里没被回收。判据是 `cdOff` (332.1 MB) 减去中央目录里那些条目的
压缩总量 (233.9 MB); 干净构建出来的包这两者相等 (233.5 / 233.5)。**要发版就照旧走 `:app:clean` +
全量构建**, 别拿增量包去量体积。

## 6.1 两页顶栏改成"返回那一行最右边" (2026-10-24 主人: "酒馆那两个大字移到返回那一栏最右边")

`TopAppBar` 的大标题会单占一行 (字号跟着 `title1`), 于是"酒馆"两个字压在返回键下面一行, 顶掉了一整条
高度。两页都换成 `SmallTopAppBar`: `title = ""`, 标题由 `actions` 画 (`textStyles.title3`, 行尾 4dp
内边距) —— 整条只有一行, 返回在最左、酒馆在最右, 与设置页顶栏同一个高度。聊天页那一条 WebView 因此
多出约 60dp 的可用高度。

## 6.2 首页与分页 (2026-10-24 主人四条)

1. **会话界面右上角多了「酒馆」**: 那个浮标菜单里 (设置上面一行), 点进去落在**首页**; 设置页那一段的
   "打开酒馆"仍然直奔聊天页 —— 两条路进同一套数据, 只是落点不同
2. **首页** `TavernHomeScreen`, 标题 `Luwi-酒馆` (行尾), 四处入口:
   `进入酒馆` (当前存档那一场) / `选择存档` / `选择主题` / `打开配置`; 它读的是 `TavernStore.status`
   那一份共享状态 —— 从主题页换一套再退回来, 首页跟着变 (进来时的快照会停在旧值, vivo 上量到过)
3. **主题单独一页**, 每套用**它自己的聊天背景**画一张预览 (底色 `bg`, 两句气泡用 `fg` / `accent`,
   亮底黑字暗底白字), 名字与说明在下面, 当前那一套打勾; 会话级那一档仍在同一页的第二段
4. **设置段拆成五条**: 资料 / 角色卡 / 故事书 / 会话(存档) / 主题, 原来那一行「角色卡、故事书与会话」
   没有了。设置里那五条与首页那四件事指向同一批页面 (`TavernProfile/Cards/Worldbooks/Sessions/Themes`)

`TavernManageScreen` 那个五 tab 的页面因此下线 (改成上面五页 + 首页); 导航里 `TavernManage` 这一个
路由名也一并删掉, `tools/check-tavern.mjs` 加了"七页导航都在""菜单有酒馆且指向首页""设置段拆成五页"
三条判据 (现在 28 条)。

## 6.3 又一轮 (2026-10-24 晚, 主人五条)

1. **设置段「打开酒馆」改成进首页** (`Screen.TavernHome`), 摘要跟着改成"先进首页 (进入酒馆 / 选择存档 /
   选择主题 / 打开配置)" —— 6.2 第 1 条那句"设置仍直奔聊天页"作废
2. **配置页 `TavernConfigScreen`**: 资料 / 角色卡 / 故事书 三件收进同一页; 首页「打开配置」与设置段
   那条「配置」都落这儿。设置段因此收敛成 **配置 / 会话 / 主题** 三条 (6.2 第 4 条那五条作废)
3. **选中的主题用蓝框圈起来**: `ThemePreview` 在 `current` 时加 `border(2.dp, colorScheme.primary)` 并
   去掉那个 ✓
4. **顶栏换成自己画的一行 `Row`** (`TavernTopBar`): 左右滑返回与打开页面时标题不再闪 —— 原来用的
   `SmallTopAppBar` 会跟着 `ScrollBehavior` 重算标题那一格, 转场那一帧就闪一下
5. **首页整页跟聊天主题同色**: 底色 `bg`、字色 `fg` 都从"正在聊的那一场"的 `themeId` 取 (取不到退回
   应用配色), 顶栏同一色; 首页那四行从 `ArrowPreference` 换成自绘的 `TavernHomeRow` (不带自己的
   surface 底色, 否则深色卡片压在主题底色上就不一致了)

**Web 页那一头还有两条** (同一轮): 聊天页顶栏去掉页内返回键与右侧主题名, 角色条挪进标题那一行
(标题固定 5em, 超了省略号; 角色名横向滚动); 静态文件加上 `?v=` 与 `no-store` —— 装新包之后 WebView
缓存住旧 `app.js` 会让页面整块白掉 (2026-10-24 在 vivo 上量到过一次)。

## 6.4 又一轮 (2026-10-25 主人三条)

1. **聊天页与这一次的主题对齐**: `TavernChatScreen` 以前只把 **WebView 的垫底色**取成这一场的
   `bg`, 顶栏与页面容器还是应用那一套 (深色) —— 真机上是"黑顶栏 + 主题色正文"。现在整页从
   `GET /sessions/<id>` 取 `themeId`, 用 `TavernStore.paletteOf` 算 (bg, fg, accent), 顶栏、
   `Scaffold.containerColor`、状态栏图标深浅、WebView 底色四处统一。导入的背景图上面再压一层
   30% 的 `--SmartThemeBlurTintColor`: 同一张蓝色插图在羊皮纸上偏暖、在樱上偏粉、在夜曲上压暗,
   于是图与主题色控件是同一套观感 (2026-10-25 主人: "背景没有与聊天界面使用的主题一致")
2. **存档措辞与新建存档页**: 存档页 / 空态 / 删除确认 / 主题页第二段里的"会话"字样一律改成"存档";
   「新建存档」从对话框改成一整页 `Screen.TavernNewSave` (导航里第九页), 列表页靠
   `TavernStore.savesRevision` 在退回时重读, 不再用 `LaunchedEffect(Unit)` 的旧快照
3. **新建存档四块与四个二级界面**: 主角（我）(名字 + 头像) / 角色 (导入人物卡 + 选人) /
   故事书 (导入 + 选书) / 背景 (导入 + 预览 + 清掉)。四块各是一层 `NewSavePage`, 全部包在
   `TavernPage` 里, 颜色走当前主题那一套 Miuix 配色。头像与背景先落 `cacheDir/tavern-draft`
   (单次导入的暂存清理碰不到), 点「创建存档」时先建会话、再按新 id 上传头像与背景

**数据面两处欠账一起补了**:

- `sessions.mjs` 的 `normalizeMeta` 原来把 `playerName` / `worldbookIds` 丢掉了 —— 建的时候写进去,
  读回来就没了, 而任何一次 `updateSession` (换主题就算) 会把它们从 meta 里正式抹掉。现在这两样
  与 `playerAvatar` 一起归一化, 主角头像落在 `sessions/<id>/player/avatar.img`
- 新路由 **GET/POST/DELETE `/api/sessions/<id>/player/avatar`** (上限 2 MB), `GET /sessions/<id>`
  多回一条 `playerAvatarUrl`; 聊天页"我"那一侧的头像与名字优先用这一场自己的, 空串才退回资料页

判据: 插件 `node --test` 100/100, `check-tavern` 33/33, `check-strings-keys` 5/5, Kotlin 酒馆单测
全过, `:app:compileDebugKotlin` 通过。

**真机 (vivo `10CEB40568000ZB`) 2026-10-25 00:28 装的那一份**逐项看过:

| 项 | 读数 |
| :-- | :-- |
| 聊天页顶栏与主题 | 羊皮纸那一场的顶栏/状态栏/发送键全是同一套暖色, 之前那条深色顶栏没了 |
| 存档页 | 标题「存档」, 新建行「新建存档 / 选主角、角色、故事书与背景」, 列表 2 条都能开 |
| 新建存档页 | 存档名字 / 主角（我）/ 角色 / 故事书 / 背景 五行 + 创建存档, 整页走「樱」的粉白底 |
| 主角（我） | 选头像后预览当场变, 「用回资料页头像」同时出现; 名字默认取资料页那个 |
| 角色 / 故事书 | 导入行在、选中打勾、计数「已选 2 位 (最多 10 位)」; 故事书空态一句话 |
| 背景 | 选图后 220dp 预览当场出图, 「用回主题底色」出现; 退出整页后 `cache/tavern-draft` 清空 |
| 创建存档 | 建完回列表当场多一条 (「未命名存档 · 2 个角色 · 主题 樱」); `meta.json` 里 `playerName=旅人` / `playerAvatar=""` / `worldbookIds=[]` 都在; 删掉之后 `activeSessionId` 也清空 |
| 二级界面的返回 | 在「主角（我）」按系统返回回到「新建存档」那一页, 不是直接退到存档列表 (`TavernSubPageBack` 让 AppNav 先问这一句) |

截图在 `shots/2026-10-25-0033…10CEB40568000ZB-tavern-*.png`。

## 6.5 聊天页滚动卡顿 (2026-10-25 主人: "上下滚动对话会卡顿")

**量到的东西**: 用 CDP 在页面里跑同一段 `scrollTop` 动画 (120 帧) 量 rAF 间隔, 再用
`dumpsys gfxinfo` 量真实滑动。修之前:

| 场景 | p50 | p90 | gfxinfo |
| :-- | :-- | :-- | :-- |
| 有背景图 | 16.8 ms | **165 ms** | 238 帧里 116 帧 janky (48.74%), p50 300 ms |
| 去掉背景图 | 16.8 ms | 56 ms | —— |

**根因两处**, 叠在一起:

1. `TavernChatScreen` 为了绕开"两块 WebView 把 tile 内存吃满", 把这一页钉在
   `LAYER_TYPE_SOFTWARE` —— 每滚一帧都在 CPU 上重画整个 1260x2520 的视口
2. 导入的背景图由网页 `body` 的 `background` 铺, 等于每帧连那张 1728x2368 的图一起重画

**改法**:

- 背景图搬到 Compose 那一层: `TavernImages.loadBackground` 按长边 1600 采样解码, Compose 画
  `Image(Crop)` + 一层 30% 主题色; WebView 底色改透明, 页面里的 `has-bg` 只负责"底色透明、顶栏
  与输入区半透明", 不再铺图, 也去掉了 `backdrop-filter` (它模糊不到 WebView 后面的原生图)
- 拿掉 `LAYER_TYPE_SOFTWARE`, 回到默认的硬件渲染。页面不再有整屏大图, tile 压力小了一个数量级;
  实测没有出现 "tile memory limits exceeded", 也没整块白
- 顺手修掉页面加载就抛的 `Uncaught ReferenceError: applyTheme is not defined`: 那一行
  `window.__lwTavernSetTheme = applyTheme` 写在 IIFE 外面, 够不着里面的局部函数 —— 于是
  "主题切换实时" 一直没真生效。现在在 IIFE 里挂一个闭包

**修之后的读数**: CDP p90 **17.3 ms** (四组场景 17.2~17.8, 有图/没图/去阴影都一样);
`gfxinfo` 456 帧 **janky 0 (0.00%)**, p50 9 ms / p90 11 ms / 95th 13 ms, Missed Vsync 0。
判据里加了一条静态检查 (不出现 `LAYER_TYPE_SOFTWARE` / 透明 WebView / 原生 `loadBackground` /
CSS 不再有 `--lw-bg` / 主题钩子是闭包), `check-tavern` 现在 34/34。

## 6.6 转场压暗与角色复选 (2026-10-25 第二轮)

1. **转场不再压暗上一页**: `AppNav` 的 `NavDisplayEffects(dimAmount = 0.5f)` 收成 `0f`, 转场本身仍是
   `NavTransitions.MiuixDefault` (只动那一层 scrim, 没有换转场)。录屏 (首页→存档, 60 fps) 逐帧算
   全屏 YAVG: **33.6 → 33.1 (1.5%)**, 没有主人录到的那种 45.6→35.1 (约 23%) 的暗坑; 若 0.5 的 dim
   还在, 暗色主题下背景那 30 会掉到 15
2. **角色可复选**: 聊天页角色条从 `pendingSpeakerId` (单) 改成 `pendingSpeakerIds` (组), 点头像
   加/减; 选中只挂一个小勾, **不再加边框**, 亮框 (EmColor 边 + 光晕) 只留给 `is-speaking`, 也就是
   这一轮最后开口的人。发出去时 `body.speakerIds = [...]`; **勾了几个就按勾选顺序回几条**, 每一位
   单独拼提示词、单独过串台与预算, 后面的那位在对白里看得见前面的回复。返回体多了 `replies` 数组
   (老字段 `reply` 仍指向最后一条), 页面按顺序追加多条消息; 发完保留勾选, 下一句还是这几位依次接
3. **挑人口径**: 勾了人就由勾选的人全部回答 (顺序即点的顺序); 没有勾选时退回原来的一轮一人
   (单个 `manualId` > `@名字` > 加权随机), 于是"不选也能聊"照旧。勾了 2 位以上时一次 turn 会有
   多次模型调用; 第一位预算在落盘前判, 后面某位超预算或模型失败就停在那一句, 把已经说出来的几条
   照常交回 (`budgetStopped` / `failed`), 不假装整轮失败

判据: 插件 `node --test` **103/103** (复选顺序、第二条提示词里看得见第一条、只勾一人仍一条),
`check-tavern` **36/36**。真机部分: vivo 在 01:27 装过 01:25 那份 (复选/亮框); 01:38 的多回复
构建在模拟器 `Luwi_API36` 上用假 turn 回包验过 —— 请求体 `speakerIds` 是勾选顺序, 两条回复按顺序
渲染, 勾选保留, 只有最后一位 `is-speaking` (截图 `shots/2026-10-25-0147…-emulator-5554-tavern-multireply.png`)。

**没验到的**: 模拟器没有模型 key, 真机 vivo 已下线、小米 13 的 USB 安装被 `INSTALL_FAILED_USER_RESTRICTED`
挡住, 所以"真的调两次模型"这条只过了本地假模型与路由单测; 等设备回来再补一次真模型双回。

## 7. 真机验收怎么做 (方案 10.4 的落地)

1. `pwsh -File D:\apk\Luwi\tools\lw-install.ps1 -Build` 装到设备, 等 host 起
2. `adb forward tcp:3080 tcp:3080`; 从设备取 token:
   `adb shell run-as io.github.yuloong07star.luwi cat files/dsh-home/lw/tavern/tavern-token`
3. `curl -H "Authorization: Bearer <token>" http://127.0.0.1:3080/lw-tavern/api/status` —— 看
   `gate.currentPath` 与 `dataRoot`
4. 设置里绑一次工作区, 再 `PUT /api/config` 量一次 `enabled`
5. 导入一张 PNG 卡 (`curl -F file=@card.png .../cards/import`), 建会话, 发一句
6. 换工作区: `status` 里 `match` 变 false, `GET /api/cards` 回到 403

## 7. 已知边界

- 聊天页不分页 (P1 只看最后 50 条), 更早的消息要等 P2
- 摘要每 12 轮写一次, 失败不影响本轮 (下一轮再试)
- 用户头像"清掉"只清显示, 文件留着等下一张覆盖
- 主题切换从主题页进来是实时的 (`themeRevision` + `window.__lwTavernSetTheme`, 2026-10-25 修好那个
  ReferenceError 之后才真生效); 绕过主题页直接改 `meta.json` 仍要重开聊天页

## 8. 主题画、纹理与预设头像 (2026-10-26)

**这一轮做了什么**:

1. **本地 AI 出图**: ComfyUI + Qwen-Image-2.1 Turbo (8 步), 六张 864x1536 背景画 / 六张 512
   带 alpha 的灰阶纹理 / 四张 480 PNG 头像 (三张卡 + 主角)。竖版走"主题色 blockout + 图像编辑" ——
   Qwen 的文生图 latent 是方的, 竖版只能由参考图定形状。提示词、种子、尺寸在
   `tools/tavern-art/spec.json`, 出图与后处理脚本同目录 (`gen.py` / `postprocess.py`)
2. **主题重做**: 六套 CSS 换成"变量 + 组件"两层, 纹理走 `body::before` 固定层 (alpha 灰阶, 明暗底
   都能看见, 不用 `mix-blend-mode`); 气泡尾角、连续同一人合并、跨天分隔、新消息入场、角色条渐隐、
   输入框聚焦、空态/锁定态都改了; 关键色不再依赖 `color-mix` (老 WebView 不支持)
3. **原生**: 主题页每套用**它自己的画**做预览; 首页顶部换成可点击的封面卡 (默认主题画 + 「进入酒馆」
   门闸); 聊天页背景按 `导入 > 主题画 > 纯色` 选, scrim 读主题元数据; `TavernImages` 加独立预览缓存
   (360/640 长边, 10 MB)
4. **头像**: 三张预设卡 + 主角「旅人」的默认头像随 seed 补; **单独 `AVATAR_VERSION`, 不抬
   `PRESET_VERSION`** —— 抬正文版本会让"缺什么补什么"把主人删掉的卡再塞回来。卡只给"卡还在、
   来源是 preset、`avatar.png` 不在"的补, 主人换过的不盖, 删掉的卡不复活; 主角只在**资料还没改过**
   (名字仍是缺省「旅人」、`avatar` 为空、`profile/avatar.png` 不在) 时补, 换了名字或传过头像就不动

**踩到的坑**:

- **暗色主题的画被整块盖住**: `color-scheme: dark` 会让 WebView 把 iframe 底衬按黑画, 页面明明
  `has-bg` 透明, 底下 Compose 的画却看不见 (亮色主题正常); 修法是 `html.has-bg { color-scheme: normal !important }`
- **头像异步解码后聊天不再贴底**: 只钉一次 rAF 会让最后一条被输入区切住; `scrollToBottom` 现在补
  90/260 ms 两拍, 消息头像 `onload` 再钉一次
- **首版羊皮纸出成了"烛光书桌 + 满纸字"**, 和浅色主题冲突; 改成"日光 + 边缘静物 + 中间留白"重出,
  纸上的字也没了
- **封面/预览裁在画面中部**: 背景画是为聊天留白设计的, 中部本来就空; 封面与预览改成裁底部,
  于是看到书桌 / 屋顶 / 桌面而不是一面墙; 玻璃那套的看点在中段的灯晕, 单独按居中裁
- **气泡尾角方向与描边** (2026-10-26 主人: "尖头应该在左上角指向头像的角度" / "那个尖能跟随边框的搭边吗" / "角度开的太大了, 缩小一点"): 第一版是贴在侧边的旋转方块, 第二版挪到底角仍不对; 最终改成**侧尾 + 双三角描边** —— `::before` 画边框色外三角 (7x12), `::after` 内缩 1px 画气泡色内三角 (5x8), 尾巴的上/下斜边都跟着气泡的 1px 边框走; 机器人挂在左上角朝头像, 用户镜像到右上角; 尖端张角约 81°。验证图 `shots/2026-10-26-tail-small.png`

**判据**: 插件 `node --test` **125/125**; `check-tavern` **50/50** (画 / 纹理 / 头像 / Kotlin
`PALETTE` 与 `themes.mjs` 颜色同步 / 静态白名单 / 聊天页纹理与 `has-bg`); Kotlin 酒馆单测
**18/18** (TavernModels 10 / Import 4 / Store 4); `:app:compileDebugKotlin` BUILD SUCCESSFUL;
`assembleDebug` BUILD SUCCESSFUL, APK **371,331,361 字节** (较上一份 368,399,389, +2.93 MB)。

**桌面视觉回归**: 临时同源 iframe 预览器 (`.lwtmp/tavern-ui/preview.mjs`, 不随包) 起真 HTTP 服务,
按 412x915 用 headless Edge 截六套: `shots/2026-10-26-desktop-tavern-*.png`。头像、用户气泡、
连续发言合并、跨天分隔、旁白、输入区都在; 暗色三套的画也已正常透出。

**模拟器验收**: `Luwi_API36` 装 2.7.10 新包; 绑定 `/storage/emulated/0/DSH` 后 seed 落出 1 场存档 /
3 张卡 + 主角默认头像 (头像 URL 都有, `seed.json` 的 `avatarsVersion` 到 2)。截图
`shots/2026-10-26-emulator-tavern-home-final.png` (封面卡, 羊皮纸)、
`-tavern-themes-final.png` (六套预览, 已裁底)、`-tavern-cards.png` (三张 AI 头像)、
`-tavern-profile.png` (资料页的主角头像); 另切到玻璃主题看了一次实时换色与深色状态栏
(`-tavern-home-glass.png` / `-tavern-theme-glass.png`), 首页底与主题页底色当场变深。**聊天页没进**:
模拟器没有登录态, 门闸停在"未登录", **没有绕过门闸**; 聊天页视觉以桌面六套截图为据, 原生画那一条
以主题页预览 + 首页封面 + 资料页头像为据, 等有登录态的设备再补一次真机聊天页。
