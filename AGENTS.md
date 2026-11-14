# Luwi

把 dsh 搬到安卓: Miuix 界面 + 自建虚拟屏, 屏幕与输入做成 dsh 原生工具

只留**决策 / 约束 / 操作**; 过程去 `docs/step2-record.md`…`step8-record.md` / `docs/ui-record.md`, 构建旧账
`docs/host-build.md`, fork 改动权威 `third_party/deepseek-harness/patch.md` —— 别往本文加过程

## 发布

- **2.7.10 冻结**: `D:\apk\archive\releases\Luwi-2.7.10-frozen-20261030-r2.apk`, 250,390,159 字节, sha256
  `F89348B9…`, 2026-11-01 周日发, 一字节都不许改
- 发布只认 `archive\releases\` 副本 (`app-release.apk` 下次构建就被重写); `versionCode` / `versionName` 由人定
- 发布包 = `:app:assembleRelease` 的 `app-release.apk` (**2.8.0 #36 起**; 以前发 debug 包), `debuggable=false`;
  **签名仍是那把旧 debug key** (`CN=Android Debug`) —— 换 key 会让 2.7.10 装不上 2.8.0, 只能卸载重装,
  `files/dsh-home` (会话 / 凭据 / 设置) 跟着丢; 换 key 归 2.9.0, 且必须走 `apksigner` 的 v3 lineage
  (`tools/lw-make-release-keystore.ps1` 已备好那把 `CN=Luwi Release` 的新 key, key 与口令都不进仓库)
- 发前过 `tools/lw-release-check.ps1` (文件名 / 验签 / 证书固定 / 不可调试) —— **换 key = 全员卸载重装**,
  并跑 `python tools/apk-bytes.py <apk>` 验无归属区间 (最大那条只应几 KB)
- 公告: 对外只叫 `Luwi`, 不写 DSH / LW; 未上真机的项不进公告
- 发版闸带「分支漂移」: tag 后新起的 agent 分支, tip 未进 main 的必须在 `tools/branch-drift-allow.json` 写 why;
  `flow tasks` 同一条 warning
- **agent 分支做完就闭环**: 开 PR 或写进落实表, 否则等于不存在 (2026-11-07 漏掉 `agent/2.8.0-ready-models` 整支)

## 仓库形态

- dsh 是可写 fork: `origin` = `yuloong07-star/deepseek-harness`, `upstream` = `Miuzarte/deepseek-harness` (**只读**);
  pin 必须是 fork 上推过的提交; 基座 rc.5 (`dsh-v0.2.1-rc.5`), 分支 `lw-sync-rc2`
- 升基座: `codeload.github.com` 下 tar.gz → 合成提交 → `git rebase --onto <新基座> <旧基座> lw-sync-rc2`;
  坑: Windows 补 14 条符号链接 / 中文名按代码页写歪 / 4 个夹具 `add -f`
- **酒馆源在仓库外** `D:\apk\Luwi-private\tavern\`, 公开仓只留 `app/src/tavern-stub/.../LuwiTavernStub.kt`;
  `tavernRoot` **必须 `kotlin.srcDir`** (`java.srcDir` 不进 Kotlin 编译, 症状满屏 `Unresolved reference`)
- 共享文件 (AppNav / SettingsScreen / HostScreen / MainActivity / CustomPresets / PluginOverlay) **只准调
  `LuwiTavern` 八个入口, 不 import `luwi.tavern.*`**; 公开推送父提交必须是 `2c61255`
  (细则 `docs/Luwi-酒馆-C-拆分方案-20261029.md`)
- 判据 `Luwi-private/tavern/tools/check-tavern.mjs` (70 条) + `check-tavern-account.mjs` (18 条)

## 架构

- 两半: **dsh host** (APK 里的 Node 跑 dsh, 监听回环, Web GUI 进 WebView) + **安卓控制端** (Miuix + Shizuku/root
  + 虚拟屏); **前台服务常驻**, 否则后台被收
- host 以"上游 pack → 平铺 `npm install`"进 APK; 改 dsh 必须重 build + pack
- **探 host 用 `127.0.0.1` 字面量** (判据 connect): `InetAddress.getLoopbackAddress()` 在安卓解成 `::1`, 拿名字探永远
  答"空着"
- **说不了话先查投屏**: scrcpy 3.1 默认 `--audio` 把音频送 Remote Submix (`dumpsys audio` 见 `remote_submix(8000)`),
  解是 `scrcpy --no-audio`
- 监听: `HostSettings.lanAccess` → `--host 0.0.0.0 --allow-lan`; `os.cpus().length` 可能回 0, 并行要容忍

## 测试设备

- **真机 A (主用)** `22041216C` / `OJZD5D6TMNSKFYHM`, HyperOS, 1080x2460; 锁屏口令走 `lw-unlock.ps1 -Pin` 或
  `$env:LW_UNLOCK_PIN` (不写进仓库)
- **真机 B** vivo `10CEB40568000ZB` (1260x2800): 触摸体感只归主人, 助手不碰
- 小米 13 `192.168.1.103:5555` (`fuxi`) 本机通常不在线; **模拟器** `Luwi_API36` (`emulator-5554`) 只兜底

## 真机测试

**默认真机, 模拟器只兜底**。**每一项都要出读数, 按阶梯走**: 真机 A 装不上 / 解不开锁 / 不在线 → 同一项改在
`Luwi_API36` 跑并标「模拟器, 待真机复验」; 只有模拟器也没该能力 (Shizuku / root 特权、快应用、MIUI 特有交互、
真机专属硬件) 才允许没读数, 但必须写清缺哪项、列为待复验。**不许只写「真机未验」交差**。

1. `adb devices` 取非 `emulator-` 序列号; adb 在 `D:\apk\Sdk\platform-tools\adb.exe`, **bash 里不在 PATH**,
   先 `. D:\apk\env.ps1` 或用全路径
2. 解锁一条命令: `pwsh -File tools\lw-unlock.ps1 [-Serial <号>] [-Pin <口令>] [-Tries 2]
   [-Only swipe|swipeLow|keypad]` (入口 `dev.ps1 unlock`); 多方式轮换 `swipe` (0.73→0.20 + 口令 + ENTER) →
   `swipeLow` (0.85→0.15) → `keypad`; 末了打「方式 / 轮次 / 结果 / 读数」表, 退出码 0 = 亮着且解开。三条规矩:
   - **密码页是黑屏** (secure 窗): 截图与 uiautomator 都看不出停在哪页, 只认 `dumpsys window` 的 `isKeyguardShowing`
   - **换方式 / 重试前先锁屏再亮屏** (`keyevent 26` → 224/26); 停在密码页再划一下会把它收掉
   - **注入 (lw_lock) 已删** (已录序列跑几步就 `the replay ran out of time`); 恢复要先重录, 再用
     `lw.ps1 -Method lock -Params '{"op":"unlock"}'`
3. 装机 `pwsh -File tools\lw-install.ps1 -Serial <号>`; MIUI 拒装先 `input keyevent KEYCODE_HOME` 放后台,
   装完 `am start` 拉回 (**不带 `-S`**)
4. 判据: logcat 落 `D:\apk\logs\device\`, 截图落 `D:\apk\shots\<日期>-<设备>-<标签>.png`; shell 里不能用
   `Select-String`, 重定向到 `.lwtmp\` 再在 PC 侧 grep
5. 装完别让设备息屏 (首启解压 3 万文件); 别对已就绪实例 force-stop 后冷启
6. 收尾: `svc power stayon` 动过要写回; 回执写设备序列号 + 每条读数, **不写「已验证」**

**不算验过**: 只跑 `compileDebugKotlin` / 只看截图 / 空着不写读数; 模拟器读数只算开发项, **发版闸 (B6) 真机项
仍必须真机**, 但开发项不许因「真机不在」就不验

## 代码风格

- 中英都行, 中英文 / 数字间留空格, **不用全角标点** (用 `, . ( ) /`), **注释里不用句号**
- UI 字符串同时进 `values/strings.xml` 与 `values-zh/strings.xml` (**设置页也例外不了**), 键与顺序一致;
  设置页键以 `settings_` 开头
- `strings.xml` 带参字符串里 `%` 必须 `%%`, 裸 `%` 抛 `UnknownFormatConversionException`
  (判据 `tools/check-bare-percent.py`)
- 小步改, 不整文件重写; 先 `import` 再用短名

## 界面

- **上原生渲染虚拟屏预览, 下 `weight(1f)` WebView 渲染 dsh Web GUI, 会话界面不重写**
- **首启顺序: 加载界面 → 新手引导**: 页面 host 一就绪就挂 (含 dsh 自己的登录弹窗), 「开始使用」等
  加载界面收尾才弹 (页面画出来 / host 起不来 / `LOADING_BACKSTOP_MS` 45 s 兜底); #39 那条"引导期间
  不挂 WebView"已推翻 (2.8.0 #44), 判据 `check-ready-card` 第十一节 + `GettingStartedTest`
- **账号在原生引导里办** (2026-11-14): 引导卡竖轨最后一行是「账号」(与「选择权限」同款), 三个动作
  (填一把 API Key / 登录 DeepSeek 账号 / 稍后在后台 dsh 完成) 走宿主那条 **`POST /lw-account`**
  (`host-plugin`: `deepseekAccount.getState/startSignIn` + `credentials.set`, 空串 = `unset`) ——
  页面那侧的 `remote.account` 是 dsh 开给自家账号页的缝, 第三方插件调它会一声不响地挂住; 页面只负责
  转发 (`__LUWI_PORTAL__.account`) 并经 `PortalBridge.lwAccountResult` 报回原生; **门户不为 dsh 那扇
  登录窗做任何让路** (那一套 2026-11-14 晚已整块撤掉), 判据 `check-luwi-portal` 第四/五节 +
  `check-ready-card` 第十二/十三节, 方案 `docs/Luwi-账号进新手引导-方案-2026-11-14.md`
- **竖轨进度按顺序卡住** (2026-11-14): 有序清单 = 四件 + 选择权限 + 账号; `firstPending` 是第一个没办的
  位置, 环与竖轨只走到这里 (上面的缺口挡住下面的已办项), 顶栏「还差 N 步」仍按真实未办件数算;
  **同一个 `reached` 也管"许不许点"** —— 路没铺到的行点不开 (不能跳过在视觉与手感上是同一件事);
  **轨道必须连到底**: 只有最后一行的 `last` 才 true, 中间行收口就会让下一颗点悬在半空 (2026-11-15 修);
  **没完成的节点画暗圈 + 红横杠** (不是只留浅圈, 缺模型要一眼看得出);
  **没铺到的行不显示它自己的状态** (2026-11-15): `ReadyState.LOCKED` 只由 `ReadyRailRow` 派生 —— 极暗空圈 +
  「还没到这一步」, 勾 / 红横杠 / 进度 / 右侧百分比一个都不预支, `LOCKED` 也不进 `flags`;
  判据 `check-ready-card` 第十二 / 十四节
- **账号模型那条收尾在宿主** (2026-11-15): 上游 `initializeDefaultModel` 挂在 client 的账号状态流上
  (`remoteAccess.whenAccess('account/watch')`), 第三方门户拿不到那条授权, 于是登录通了、默认模型还钉在
  `deepseek-official` 上 → 一发言就 `no API key`。宿主 `lwAccountAdoptModel` 补同一份语义 (没别的 provider
  有 key 才切), 三处调: 起来 / `op=status` / 每轮 `turn/start`, 60 s 节流, 结论落
  `$DSH_HOME/lw/account-model.json`; 卡片副标题「已登录 谁 · 模型名」; 判据 `check-luwi-portal` 第五节
- **下载可暂停 / 可取消** (2026-11-15): 两个下载器 (`WakeWordDownload` / `SpeechModelDownload`) 的
  `Phase` 多一档 `PAUSED` —— 暂停 = 断连接 + **保留 `.part`**, 继续时发 `Range` 从断点接 (整文件重算
  sha256, 不做增量); 取消 = 清 `.part` 回 `IDLE`。卡片上: **下载中点那一行 = 暂停, 暂停后点行 = 继续,
  右侧那一格变 × = 作废**; 底部的按钮暂停后变「继续 X」。三条坑: ① `call.cancel()` / `disconnect()`
  抛的 IOException 是**人按的**, 要转成内部 `Stopped` 而不是记成镜像失败 ② 暂停后线程已退出, × 那一趟
  没人接手, 得就地收尾 (`running` 为假) ③ 一趟只许一个在跑 (`gate` + `running`), 否则两个线程写同一个
  `.part`; 判据 `check-ready-card` 第十五节
- 缩进与段间距由 `scaffolds/LazyColumn.kt` 给; **Card 不写水平边距、不套 `padding(16.dp)`**; 按钮一律 `fillMaxWidth()`
- **转场已取消**: `AppNav` 的 `transition` = `NavTransitions.None`, `dimAmount = 0f`; 横滑返回登记仍在, 别接回去
- **主题全局、存档跟主题**: `config.defaultThemeId` 唯一一份, 首页 / 存档页 / 配置页 / 聊天页首帧都按它上色;
  `TavernStore.colorThemeOf` 读它, 本地缓存只当冷启动兜底
- **`has-bg` 必须由 JS 加**, 不能静态写进 index.html (否则第一帧全透明, 这台 vivo 只画第一下; 判据 `check-tavern`)
- 聊天页首帧就对: 宿主填好 `__THEME__` (`themedIndexPage`), 骨架 `.stSkeleton` 用中性灰, 页面自举 `/status` 一发 +
  并发, **WebView 退出只摘不 `destroy()`** (`TavernWebViewCache`); 背景层恒在 Box 里, 别写 `if (picture != null)`
- 三处图标同一份 `tools/brand/luwi-mark.png`; **`0.46` 是唯一个数别改**, 球那处 `GLYPH_INK_RATIO = 0.65`
- **门户那张脸归设置 → 外观**: 「背景」「背景透明度」落 `$DSH_HOME/lw/face.json` + `lw/face/<名字>.jpg`
  (`tool/PortalFace.kt` 唯一写者, 换图只留一张), 页面走 `PortalBridge.portalLook()` 取 data URL (键是文件名),
  改完调 `__LUWI_PORTAL__.reloadLook()`
- **输入卡照 dsh `InputBar`** (28px 圆角 / input-major 实底 / soft elevation): 底部只 **`+`** (上传图片与 docs) 与
  **模型 chip**; 命令菜单 / 权限选择 / 工作区 / 预设都不画; **默认完全权限** (`danger-full-access`, 每场拨一次 +
  首次写 `permission.defaultPreset`); 气泡与浮层**只引 dsh 玻璃 token** (`--dsw-menu-surface-fill` /
  `--dsw-menu-backdrop-filter` / `--dsw-elevation-panel`); **待发附件行在文本区上面** (图/表情 64px 缩略 + `×`,
  非图 chip), **点表情只进待发栏** (`stageSticker`); 顶条不显示会话标题
- 设置页右上 ⋮ 五条 (反馈 / 检测更新 / 账号 / 关于 / 重启 host), 同一刻只开一个; **material3 不是本项目依赖**
- **门户头栏**: 左身份 (头像 + 昵称, 整块点 = 开新对话), 右 **历史** + **`⋯` 更多** (判断 / 探索 进抽屉 `menu` 态,
  顶上一行「‹ 返回」); 状态点是**头像右下角那颗** (`#lwp-busy`) 三态 **绿 = 空场 / 蓝 = 对话中 / 黄 = 正在做**
  (`data-state`, 判据 `phaseThinking()` 与 `flowMode === 'hero'`)
- **历史窗** (`#lwp-history`) 画 dsh 自己的会话表 (`ctx.sessions.list`): 搜索 + 新到旧 + 当前置顶 + 点行走
  `follow()` + 底部「开始新的对话」, **不另建历史文件**; `historyRows(snapshot, query, currentId)` 由
  `check-luwi-portal` 真跑; 头像与昵称同落 `lw/face.json` (`name` / `avatar`), 页面侧 `applyIdentity()` 一处改头栏与空态
- **首启直接默认使用 `<工作区根>/Luwi`, 门户里没有任何选工作区入口** (2026-11-13 改口径, 原 #37 的按钮作废):
  ① 宿主一起来 (客户端开屏前) 就 `ensureExploreWorkspace` —— 目录不在就建 (`/sdcard/DSH/Luwi`), 建完注册,
  dsh 那一侧于是不会去问系统 Documents (安卓上必失败, 日志 `system Documents directory is unavailable`);
  ② 客户端空着时走 `landInDefaultWorkspace`: 列表里没有就 `portalWorkspace(true)` 备目录 + `workspaces.create({path})`
  (**不走 `initializeDefault`**) → 250 ms × 12 补拍 → `openWorkspace` + 150 ms × 24 等场 + `portalBind`;
  ③ 挑默认工作区按路径认 (尾部 `/` 归一), 认不到退第一条; 没成只留一句提示 + 一次 15 s 补试, 不弹窗
  (判据 `check-luwi-portal` 第十三节 + `check-explore` 第十四节)
- 设置页两层分组 (`GroupTitle` / `SectionTitle`), 缺省只展开省电与常用六段, **新加一段天然收起**
  (判据 `SettingsSectionsTest` + `check-settings-sections.mjs`)
- **返回键**: 后登记先赢, 由 `AppNav` 弹一层; 网页面板先问 `ui/PageBack.kt` (500 ms 没答就还给"再按一次退出");
  **别在 `HostScreen` 再登记 BackHandler**
- **「正在想」由文件说了算**: `$DSH_HOME/lw/ball-phase.json` + `FileObserver`, 零轮询; **会话钩子必须带 `{ global: true }`**
- **她说的话也由文件说了算** (方案 `docs/Luwi-对话层-最终方案-2026-11-08.md`): `lw_say` 唯一发言工具, 只写
  `$DSH_HOME/lw/out/<sessionId>.jsonl` (宿主单写者: `seq` 起时 tail 取 max / `at` 单调 / `gapMs` 按 `sim.json` 的
  `send` 段抽); 门户走 `PortalBridge.portalOut(id, next)` 两段水位, 浮球走 `tool/OutFile.kt` 读同一份 ——
  **解析器只一处**, `OutWatch` 一个 `FileObserver` 两个听众; 节奏 (含 `dueAt`)、条数、`seq` 两边必须一致; `luwi`
  档在 `BALL_SILENT_PRESETS` 里 (正文不进框不念), 图走只读 `/lw-out` (`kind:'prefix'` + effect + **只认回环两头**);
  判据 `tools/check-lw-out.mjs` (146 条) + `OutFileTest` / `BallOutboxTest`
- **没写过 `lw_say` 的轮次, 宿主在 turn end 补一行进同一份 jsonl** (有行就不再推 `op=reply`), 球与门户逐字同源;
  球换场先 `clearReplies`; **`BoxView.replies` 的 `inputType=TYPE_NULL` 会把换行压成空格, 必须 `setSingleLine(false)`**;
  回复之间**单换行**合并 (`kept.joinToString("\n")`)
- **时间线按轮排**: `orderTimeline` 把 user → 她的话 (按 seq) → error → 兜底 放同轮, 行按 `at` 归轮 (同毫秒算上一轮),
  缺时间的 user 沉底; 补句的 `at` 取 `event.time` (`lwOutAppend` 的 `atHint`); 判据 `tools/check-portal-order.mjs`
- **余额两条触发**: ① 每轮结束覆盖缓存 (`seq: 0`, 只动 `balance.json` 不进框, 5 s 内不连刷); ② 点「看余额」: 上次那份
  立即上屏 + 写新记号 (同一 seq 只刷一次, 成败共用 30 s 闸); 按 **`seq` 对得上**才上屏, 框已关也张回来; 9 s 没回音
  才把「正在取…」换「再点一次」; 金额两位小数 (`BalanceFile.moneyText` + 宿主 `money2`)
- **余额那行只有「余额 + 时间」**: 不挂 `ball_balance_stale` / `_refreshing` / `_retry` (键已删), 5 分钟窗口只决定要不要
  再发后台那一问; 连点 `showBalanceInfo` 就地改写
- **手势**: 单击开麦等 `BallFeel.thinkingTapMs()` (430 ms); 三击只对"真要开麦"排队; **两档都关时没有"召出", 单击
  当场开语音**; 防误触只一档 (`BallFeel.GUARD` 220/450/1500 ms)
- **球休闲两档 (半隐 / 半藏)** 共用 `PEEK_IDLE_MS` 5 s; `TRANSLUCENT_ALPHA = 0.5`, 半藏不参与; 该收边一定要收,
  **回弹判据 `idleDueNow`, 不能拿 `wait.peek` 反推**
- **一个状态可多支动作** (`ball.json` 写数组): 随机起头、演完换下一支、后台预解, 过 `MAX_DECODED_FRAMES` 不预解
- **立绘按高贴满**: 素材同高, 宽度按比例居中; **别改回 `Gravity.FILL`**
- **老 WebView 垫 polyfill**: `assets/web/lw-compat.js` 经 `addDocumentStartJavaScript` 注入, `MIN_MAJOR` = **116**
  (`Promise.withResolvers` / `AbortSignal.any`); 12 秒没出 `root` 弹 `Dialog` 的兜底已撤, 卡住只留
  `Log.w(page never rendered)`; **补 polyfill 要扫 `host-tree` 里所有 client bundle**, 不只看 `dsh-web-frontend/dist`
- **切后台回来不重载**: renderer 钉 `RENDERER_PRIORITY_BOUND`, `onRenderProcessGone` 回 true 换新
  (**退避 1/3/8 s + 60 s 窗口内 3 次 + 30 s 慢档**, 账在 `ui/PageRebuild.kt`); `halted` 不是终态 ——
  慢档时开屏那块给「重新加载界面」, 回前台那一趟也会再试一次; **同一地址只 load 一次**;
  清单 `MainActivity` **必须 `singleTop`** (否则同一 task 堆两个实例, 两份 renderer 把机器推进 lmkd 连环杀);
  判据 `tools/check-host-persistence.mjs`
- **键盘避让**用 `ui/KeyboardInsets.kt` 的 `rememberImeLift` (只认贴底键盘); `adjustResize` 在 targetSdk 37 不管用
- **门户盖着时只抬输入卡与对话区**: WebView 尺寸不动, 宿主推 `ime - nav` (`__LUWI_PORTAL__.setKeyboard` →
  `--lwp-ime`), 只改 `#lwp-root` 的 padding-bottom (`#lwp-wall` 是 absolute inset:0, 包含块是 padding box, 背景图不动);
  宿主另把 IME inset 从 WebView 吃掉, 否则 Chromium 再缩可视视口就整页平移; **门户收起时仍缩 WebView** (dsh 不认
  `--lwp-ime`); 刷新那档靠 `LuwiPortal.portalIme()` 握手
- **门户预览窗的 Office 走 `renderOffice`**: docx / pptx / xlsx 由 `lw-docx-preview` 解 (与右栏同一函数), 进 shadow root;
  `/lw-out` 认三个 openxmlformats MIME, 超 12 MB 回 413; 老格式 doc / ppt / xls 与 zip 交系统应用
- **球那侧的图 / 文件 / 预览窗**: 图上限与宿主同数 (**20 MB**, `BallMedia.MAX_BYTES`, 原借表情包 2 MB 档必挂),
  那格高由 `BallMedia.imageBox` **先算好写进 LayoutParams** (不靠 `adjustViewBounds`), 贴完再 `requestLayout()` +
  排一帧 `layoutChannel()`; 读不动**必须留一句** `⚠ 图没取到`; 文件那行不压成「（文件）」, `BallSay.file/fileRel/fileBytes`
  带名字画蓝字 chip; 点图或文件名 → `overlay/BallPreview.kt` (`TYPE_APPLICATION_OVERLAY`, 与球同一授权, 不跳 Activity)
- **预览窗与门户同一套**: 外壳照门户 (78% 屏高 / 圆角 28 / 左右 20dp / 浅色卡 / 标题行 + `×`); 图 / 文本 / **office**
  三档走窗里 WebView, office 核心 `app/src/main/assets/web/lw-office.js` —— 由 `tools/build-office-lite.mjs` 从
  **同一个** `presets/docx-preview/src/index.js` 打的 lite bundle (IIFE + react 空影子); 文件**不塞 base64**, 页面
  `fetch('/file')` 由 `shouldInterceptRequest` 开流 (只认 `https://lw.local/file`, 其余 403); PDF 走原生 `PdfRenderer`
  首页; **显示上限**: 球那格宽 50% (`BallMedia.MAX_WIDTH_PERCENT`) + 高 18% (`MAX_HEIGHT_PERCENT`), 按比例
  `FIT_CENTER` 不裁;
  门户 `.lwp-image` 宽 43% + 高 30vh; 看全走预览窗 (78vh, **预览窗不缩**)
- **球的 `+` 与门户同一套**: 多选 → `tool/LwIn.put` 落 `<工作区>/lw-in/` (basename / 白名单 / 12 MB / 同名顺延 /
  写完读回, **只此一处**, `PortalBridge.portalStash` 也调它) → `overlay/BallPicks.kt` → chip 一排 → 正文末尾带
  `BallAttach.block(...)` (与门户逐字相同), 桌面对话用 `BallAttach.strip(...)` 剥掉; 一次最多 6 个 (`BallMedia.MAX_ATTACH`)
- **`AndroidView` 里 WebView 必须显式 `layoutParams` MATCH_PARENT**, 否则 viewport unit 解析成 0

## 别做的事

- 不用 Miuix 重写会话界面; 不把 `SurfaceView` 塞进 WebView; 不给 Card 里设置项再套 `padding(16.dp)`
- **不跑 `scrcpy-server`, 不抄 MAA-Meow 代码** (AGPL); 反射包装取 `Genymobile/scrcpy` 并留 NOTICE
- 不为"让模型操作屏幕"写 MCP server, 先写 dsh 原生工具
- **新加的"会动设备"工具必须同时补进主动场三张表** (`host-plugin` 的 `PROACTIVE_ACT_TABLE` /
  `PROACTIVE_COMMAND_DENIED`, 屏幕类补
  `PROACTIVE_SCREEN_DENIED`), 漏一个就是一条绕过去的路 (方案 `docs/Luwi-主动场硬闸与解闸开关-方案-2026-11-10.md`,
  判据 `tools/check-proactive.mjs`); 只有 read 面三档全放, 故 `lw_sticker` 写 `['lw_sticker', new Set(['list', 'say'])]`,
  `lw_persona` 读三档全放、`write` / `reset` 归写动 (act 以上)

## 特权通道

- 链路: 模型 → dsh 工具 → Node host → app loopback 桥 → binder → 特权进程 (uid 0/2000)
- `native/launcher.c` → `liblauncher.so` (当 native lib 跑), setenv `CLASSPATH` 后 fork + exec `app_process`;
  不用 Shizuku user service, 直接 `IShizukuService.newProcess()`
- 回传走自己的 ContentProvider + `getContentProviderExternal`, 校验 uid + 一次性 token
- `channel/LwPrivilegedService.kt` **手写 Binder**: 出现 `.aidl` 会生成 Java, 把 AGP 9.4 坏资源管线拉回构建
- 桥是 loopback TCP (临时端口 + 随机 token, `LW_CHANNEL_ENDPOINT` / `LW_CHANNEL_TOKEN`), **一连接一请求一行 JSON**
- **「有没有 root」查不到也弹不出**, 只能试; 授权在 root 管理器给一次

## 虚拟屏

- **同一时刻只一块**: 建新屏就地关旧屏; 应用 `create()` 先 `closeLocal`, 特权 `create()` 建前 `releaseAll()`
- **取帧在 app 进程 `FrameCache` (ImageReader)**: 有预览按 150 MB/s 自适应 (夹 33~200 ms), 截图与 OCR 读缓存;
  **虚拟屏不跑 `screencap`** (K40 上恒 0 字节)
- **只有主屏走 uid**: display 0 才 `screencap -p`, 虚拟屏是内存拷贝
- **预览是镜像不是输出面**; **buffer 必须等于屏尺寸**; **换屏要换 SurfaceView** (`key(displayId)`)
- **触摸要排队** (单线程), 否则 move 超过 down 会被丢
- 两道用户闸: 「暂停接受控制」(拦 tap/swipe/launch, 不拦看) 与「虚拟屏触摸控制」(默认不选)

## dsh 工具

- 全在 `host-plugin/index.mjs`, 现 74 个 (`lw_probe` / `lw_screen*` / `lw_tap` / `lw_ocr` / `lw_wait_text` /
  `lw_capabilities` / `lw_quickapp` / `lw_persona` …), 每个一次桥调用 (人格卡这类纯宿主读写不走桥)
- **每个能力先过权限闸** (`PermissionGate` + `PermissionCatalog`): 缺什么说什么, **不假装成功**, 写入写完读回
- **答案由应用侧写**: 桥回来的 `result.text` 才是给人那句
- **只有 app uid 做不到的才走特权** (卸载/清数据/停应用/装包/停用/飞行/移动数据/蓝牙/熄屏), 白名单
  `LwSystemCommandTable.kt`
- `displayId` 可省 = "手里那块" (预览选中 → 最新建 → 无虚拟屏才 0); 事件订阅不补
- `lw_launch` 只走特权; 按键传名字; 打字优先 `ACTION_SET_TEXT`; `swipe` 均分 12 步、每步睡一帧
- 验证: `tools/lw-bridge.ps1` / `tools/lw-plugin-call.mjs` / `tools/lw-device-turn.ps1`; **读图不能在 run-as 里验**

## 主屏 / 语音 / 无障碍

- `displayId 0` 不进 `screens`, 尺寸现读, `release 0` 拒绝; **触摸刹车全删**, 只剩提示词层规矩
- **语音两档**: SenseVoice 快 (缺省, app 进程内), GLM 准但慢 (常驻, 点名 `engine=glm`); 模型都不随包发, 缺模型最多
  提醒 3 次
- **说时关麦**判据 `LwSpeak.talking(context)`, 不是 `VoiceState.speaking`
- 慢的根因是 30 秒静音垫: 改上游处只有 `LW_ASR_PAD_SECONDS` (缺省 4 s); **mel 长度按 8 帧对齐**; **GLM 必须 `-O3`**
  (`-O0` 慢四十倍), 补在 `native/CMakeLists.txt`
- 无障碍: `LwAccessibility` → `ui`/`tapText`, **取树没有 binder**; `getWindowsOnAllDisplays()`; 匹配从窄到宽, 去重后
  多个就**什么都不按**; `ACTION_CLICK` 回 false 才注真触摸
- **开服务三条**: `-i` 重装是必要条件; 写不动 secure settings 的 ROM 跑 `tools/lw-install.ps1`; **"设置里写着"不等于
  "服务活着"**
- **重装会踢出 `enabled_accessibility_services`**; **别用 `am start -S`** (摘绑定)
- 通知: 只 **`cmd notification allow_listener`** 算数, 直写 secure setting 系统不理; 没授权与"通知栏空"一样,
  `active()` 回 null 要按三种情况说清
- 事件订阅: 掩码只用四个 + `notificationTimeout="100"`, **不用 `typeAllMask`**; 队列 200、同类 400 ms 合并;
  **事件上没有 displayId**, 用 `windowId` 反查, 查不到 -1 **不猜 0**

## 端侧 OCR

- **fp16 是前提**; NPU 走 ORT QNN EP **设备上 JIT 编译**, 预编译 context binary 输出常数图别走;
  `libQnnHtpPrepare.so` (70 MB) 必须随包
- **NPU 标签说真话**: `backend = NPU` 只说明 EP 被收下; 判据三件 `strict` / `fastrpc` / `probe`, 显示 `NPU (SOC)` /
  `NPU (SOC) 混跑` / `CPU`
- **rec 用 batch 8** (`build-models.ps1` 缺省); 模型 batch 维与输入一起钉死
- **det 640→960 与更大都没采用** (字数不变、更慢)
- **图标按形状丢, 不抬分数线**: 近方形 (两边差 < 长边 0.35) + 长边 < 屏长边 9% + 分数 < 0.85; **同行重复框收掉**
  (`BOX_OVERLAP = 0.6`); 只有符号的框丢; 长行只在宽高比 > 10 才切段 (重叠 12 px)
- **`recMs` 是总时间**不是每行平均; **熄屏是静默失败**, 答案必带 `screen: on|dozing|off`
- 调试图只在 `debug=true` 时写, `lw_wait_text` 350 ms 轮询里一次都不写

## 权限与审批

- 普通权限装完就有; 运行时走设置页「权限」或 `lw-install.ps1 -Perms`; 特殊访问只能 `appops set` / 系统页;
  `util/PermissionCatalog` 是唯一表, 设置页与 `lw_permissions` 都照它
- **`forceStop` / `clearData` / `uninstall` / `install` / `disable` 调用即执行**, 唯一闸在提示词层 (工具描述 +
  `skills/android-device-control/SKILL.md` + `assets/modes/phone.md`), 这层**拦不住模型**
- **审批全放行**一行 auto-allow answerer, **`prepend: true` 必须**; `ApprovalOutcome` 封闭 fail-closed

## 技能 / 自动指令 / 探索

- 技能 `$DSH_HOME/skills/<name>/SKILL.md`, 快捷指令 `$DSH_HOME/quick-commands/<名字>.md`; 随包**显式列名**不整目录拷;
  样例只发一次 (`.lw-seed`)
- `lw_quick` / `lw_automation` 的 op 两份实现, 判据 `check-quick-commands.mjs` / `check-automations.mjs`; **删除只在桥上**
- 自动指令: 规则 `$DSH_HOME/automations/<名字>.json`; **没启用就不注册**; 事件驱动不回退 UsageStats 轮询; 「且/或」
  收 2~5 个叶子**不许嵌套**; 命中清新鲜标记 (**同一次只响一声**); 防骚扰: 静默 23:00-07:00 + 冷却 30 分钟 + 每天 5 次
- **`task` 类直接执行** (总闸 `AutomationStore.Settings.allowActing` 与设置页那行已删, 旧 `settings.json` 里的键被忽略)
- **探索没有手动开始**: 每天一个时刻 `AlarmManager` (requestCode 42) 投一句话, 卡由 `lw_explore op=finish` 的
  `nextTask` 演进 (上限 8000 字); **省电不拦探索**; **宿主没跑就先 `startForegroundService` 拉起来再投**
- **收尾写三样**: 摘要 / `nextTask` / `checks` —— `checks` 是"接下来盯什么", 最多 3 条 (**判法** `usage` / `time` /
  `event`), 宿主写进 `$DSH_HOME/lw/router.json`, 判断层当第三档候选 (分数 3); **默认要交**: 没有就在摘要
  `仍不确定的点` 写明为什么; 任务卡覆盖带尾注 `EXPLORE_CARD_TAIL`
- **空手也留痕**: `explore.json` 的 `lastFinish {at, ended, written, total, session}` 与 `checksStreak` (同场重交不 +1)
- **事件型判法要日历, 准点那拍应用自己算**: 宿主每拍问桥 `calendarWindow` (1.5 s 超时 / 60 s 缓存 / 读不到就
  `available:false`), 数据由 `LwCalendar.window` 给 (**不进 `LwCalendar.OPERATIONS`**); 提前量由 `RouterTick.leadAtOf`
  读 `router.json` 的 `checks` + `AutomationCalendar` 算 (`arm()` 跑得太早, 宿主那时还没判断完); 去重键
  `routerCheckHit` 回 `{fact, key}`, event 键是 `日期@startMs`
- **检测内容由探索加, 节奏由设置页给**: `$DSH_HOME/lw/sim.json` (见 `tool/SimSetting.kt`, 缺省照 `socialV2`) 管
  潜水/活跃、唤醒间隔、分条节奏、判断层阈值; 设置 → 活动 → 更多设置 是它的界面, **没有手写检测项的入口**;
  判据 `tools/check-sim.mjs` / `check-router.mjs`
- **表情单张上限同在那页**: `sim.json` 的 `sticker.maxMb` (1~20, 缺省 2), 三处同读 —— 宿主 `lw_sticker op=fetch`、
  `BallStickers.capBytes`、`PortalBridge`; 只改一处就"存得下但画不出"
- **判断层那两把尺子归她**: 「游戏多久算久」「提前几天提」不在设置也不在 `sim.json`, 由探索 `rules` 或
  `lw_router op=rules` 写 `router.json.rules` (5~1440 分钟 / 1~365 天, 缺省 100/60); **`simRouterRules` 不许再读这两键**
- 探索解锁: `explore-schedule.json` 的 `unlock` (缺省关), 与「唤醒时自动解锁」两个开关

## 随包插件

- 三段: `@dickpy/dsh-imagegen` + `skills/photo-edit` + `lw_image`; `edit_image` 只认引用对象, 走 `lw_image op=ref`
  拍 `fullPath` 那份
- 随包 = `npm pack` **只取包不装依赖**; `PluginRows` 那行 **`name:` 必须 `file://` 形态**; 补上游写死的
  `~/.dsh/dsh-imagegen` 要**数替换处数**
- **"先看本体, 有就不装"**: 别人已挂载 (`mountsPackage`) 或解析到宿主树外 (`isUserCopy`) 就让位, **不删别人行、不写别人目录**
- `dsh-our-free-model` **已撤下**, 老设备挂载行由 `PluginRows` 的 `RETIRED` 表摘 (只摘指回宿主树那条)
- **mneme 补丁四条, 表在 `tools/pack-mneme-patches.mjs`**: 前三处按 preset 排除酒馆, 第四处管热记忆 (mneme 把未回答的
  当前轮算进 `[短期上下文]` 的 `A:` 空, dsh 每 step 重算上下文 → 快照变 → 再跑一步 → 重复回答; `luwi` 档正文不发言
  必踩); 第四处**替换** `hot-memory.js` 末行, 锚点带行首换行 (不带会命中两次、构建当场红); **四条各自判断是否已应用,
  不许「首个文件命中就整段跳过」**; 升级前跑 `node tools/check-mneme-patches.mjs --from npm --version <v>`
  (打上四处 + 真跑 `roundsFromEvents` 验行为) PASS 再改 `pack-host.mjs` 版本号; 判据 `tools/check-bundled-plugins.mjs`
  (产物级是行为断言); 当前 0.15.0 (热记忆那条上游已自修, 旧补丁按 `retiredWhen` 自动退役)
- `PluginOverlay` 每启一次写 `disabled: false`; CSS 覆盖层 `presets/ui-fix` (**只写选择器**); 挂插件要往 `PLUGINS` 与
  `OWN_PLUGINS` 各加一行

## LW 插件

- 三层: 技能给提示词, dsh 插件碰 host 侧, LW 插件是**设备侧能力**
- **卸载只一个键, 什么都不留** (`.data` / 所有版本 / 审计 / 桌面槽 / 外观选择), 伴侣 APK 不自动卸; 删不干净先停用再报错
- 落点 `$DSH_HOME/plugins/<id>/<version>/` + `current` (**文本文件不是 symlink**); `kind`: companion / art / inline
  (`dex` 是 inline 别名)
- **两侧都手写 Binder, 仓库不许有 `.aidl`**; 接口只在 `:lwplugin-api`
- **签名载荷两份实现逐字节相同** (键递归排序 / 紧凑分隔符 / 整数 / 逐文件哈希); 未签名只走开发者模式
- 宿主每 3 s 拉 snapshot, **revision 变了才重挂**
- **签好的包只在 `yuloong07-star/luwi-plugins` 的 `packages/`**; 推法 `lw-api-push.ps1` 加 `-RepoRoot/-Repo/-RemoteRef`,
  先 dry run; **注解 tag 先本地 `git tag -a`**
- **索引 tag 一变, `PluginIndex.REF_CURRENT` / `REF_PREVIOUS` 必须跟着抬** —— 只推索引不重出包, 插件页永远看旧的
- 鲸鱼娘外观随包发 (2.7.10): 换版本号**先清 `seed-assets/lw-plugins/`**, 否则两版 17 MB 一起打进;
  `plugin-seed.txt` 只补这一版一次
- `BallTheme.MAX_FRAMES` = **240** (20 s × 12 fps), 约 42 MB 解码内存; **东张西望档首尾硬切别去修**; `动作可用/` 的
  GIF 用自带 alpha, 不走亮度键

## 工作区与存储

- `$DSH_HOME` = 沙盒 `filesDir/dsh-home` (配置 / 凭据 / 会话); 工作区根 `/sdcard/DSH/`, 没文件权时
  `/sdcard/Android/media/<pkg>/DSH`; 完全权限会话给整个 `/sdcard`; **不用 SAF** (host 是 Node 子进程拿不到
  `content://`, 只有 `MANAGE_EXTERNAL_STORAGE`)
- `host/Workspace.kt` 三档解析, **每个候选先写探针文件**; 改完重启 host
- **`/sdcard` 是 FUSE**: 没 inotify (降级轮询) / symlink 受限 / 小 I/O 慢 / 安卓 11+ `Android/data` 别人进不去

## Linux 沙盒

- 随包 Alpine 解到 `/data/local/tmp/lwlinux/rootfs`, 特权通道以 **shell uid** 起 proot; 动词只有 install / run /
  status / reset; **不是安全沙盒** (网络通且关不掉, 边界只有 uid); **`/work` 是 noexec**, 编译产物落 rootfs 再跑

## 构建与验证

- 改 Kotlin 先 `:app:compileDebugKotlin`; 它**不跑 manifest merger**, 改依赖或 sdk 版本要 `assembleDebug`
- **装机只走 `tools/lw-install.ps1`**: 流式 → 失败退"推上去 + `pm install -i`" → 回写无障碍与通知 → 等 `dsh web:` 就绪
- **Luwi 在前台时 MIUI 拒装**: 先 `KEYCODE_HOME` 放后台再 `adb install -r -t -i com.miui.packageinstaller`, 不行连着重试
  (第 3 次过)
- 迭代: submodule 里提交 (同一步改 `third_party/deepseek-harness/patch.md`) → `pack-host.mjs` → `push-host.mjs` → 重启 app
- 判据: `DshHost: dsh web:` = 树起来; `DshWebView: shell` 的 `rootChildren` 非 0 = 渲染; `LwMain: resumed with host Running`
  = 没重载
- **出包前先删旧 APK**: `app/build/outputs/apk/<变体>/app-<变体>.apk` (发布包是 `release/app-release.apk`) ——
  打包任务会在旧包上原地改写留空洞
- **`packHostTree` 偶发原生崩溃**: `Client bundle` 那一步整个进程退 `3221226505` (`0xC0000409`), 那是原生
  bundler 一次从零打三百多个包时的偶发事 —— 同一棵树重跑就绿 (`run-gates` 10/10, 第二趟只补剩下的);
  `tools/pack-host.mjs` 只在原生崩溃码 / 信号上自动补跑一次, 脚本自己退的 1 不重试 (真红不许盖)
- host 树裁剪在 `pack-host.mjs` 末尾 (剔 win32/darwin、`.map`、`.d.ts`、测试), 判据 `tools/check-host-slim.mjs`,
  **别用事后重打 zip 的脚本**
- **换基座后先跑 `node tools/check-host-patches.mjs`**: 钉 `patch.md` 第 5/6/7/8 组 (bash/rg 指定、硬链接退路、附件
  祖先 fsync、`--allow-lan`); 0.2.2 换基座就悄悄丢了这四组, 症状 `spawn bash EACCES`
- **推送**: `git push` 不通; 走 `tools/lw-api-push.ps1`: blob → tree → commit → **最后才动 ref**, 每对象比 SHA,
  先 dry run 再 `-Apply -Tag`; `-input` 的 JSON 不能带 BOM
- **后台 job 回执为什么慢**: harness 判完成等**整棵进程树清空**, gradle 守护进程是子孙; `dev.ps1` 因此 ① DSH 会话里
  (`$env:DSH_SHELL`) 加 `--no-daemon` 并**跳过** assemble 前 `--stop`, ② 用 `Start-Process -RedirectStandardOutput` 跑
  (不再 `& gradlew | Tee-Object`), **不能加 `-Wait`**, 只 `$proc.WaitForExit()`; 代价: 输出不流式 (全文在
  `logs\build\<时间>-<标签>.log`), 慢 10~20 s
