# Luwi

把 dsh 搬到安卓: Miuix 界面 + 自建虚拟屏, 屏幕与输入做成 dsh 原生工具
本文只留**决策 / 约束 / 操作**; 过程与实测数字去 `docs/step2-record.md`…`step8-record.md` / `docs/ui-record.md`, 构建旧账去 `docs/host-build.md`, fork 相对上游改动的唯一权威是 `third_party/deepseek-harness/patch.md` —— 别往本文加过程

## 发布

- **2.7.10 已冻结**: `D:\apk\archive\releases\Luwi-2.7.10-frozen-20261030-r2.apk`, 250,390,159 字节, sha256 `F89348B9…`, **2026-11-01 周日发**; 这份包一个字节都不许改
- 发布只认 `archive\releases\` 里的存档副本; `app/build/outputs/apk/debug/app-debug.apk` 下次构建就被重写
- **`versionCode` / `versionName` 由人定**, 助手不改
- 只发 debug 包, 发前过 `tools/lw-release-check.ps1` (文件名 / 验签 / 证书固定); **换 key = 所有人卸载重装**
- 发版前干净构建 + `python tools/apk-bytes.py <apk>` 验无归属区间 (最大那条只应几 KB); 体积突变先查旧包还在不在
- 公告口径: 对外只叫 `Luwi`, 不写 DSH / LW; 未上真机的项不进公告

## 仓库形态

- dsh 是可写 fork: submodule `origin` = `yuloong07-star/deepseek-harness`, 上游 `Miuzarte/deepseek-harness` 配成 `upstream` (**只读, 别改回去**)
- **pin 必须是 fork 上推过的提交**; 当前基座 rc.5 (`dsh-v0.2.1-rc.5`), 分支 `lw-sync-rc2`
- 升基座: `codeload.github.com` 下 tar.gz → 合成提交 → `git rebase --onto <新基座> <旧基座> lw-sync-rc2`; 三个坑: Windows 补 14 条符号链接、中文文件名按代码页写歪、4 个夹具要 `add -f`
- **酒馆源在仓库外**: `D:\apk\Luwi-private\tavern\` (私有仓), 公开仓只留 `app/src/tavern-stub/.../LuwiTavernStub.kt`
- 目录在 = 完整构建: `tavernRoot` **必须用 `kotlin.srcDir`** (AGP 9 的 `java.srcDir` 不进 Kotlin 编译, 症状是满屏 `Unresolved reference`)
- 共享文件 (AppNav / SettingsScreen / HostScreen / MainActivity / CustomPresets / PluginOverlay) **只准调 `LuwiTavern` 八个入口, 不准 import `luwi.tavern.*`**
- 公开推送的父提交必须是 `2c61255`; 细则见 `docs/Luwi-酒馆-C-拆分方案-20261029.md`
- 判据 `Luwi-private/tavern/tools/check-tavern.mjs` (70 条) + `check-tavern-account.mjs` (18 条)

## 架构

- 两半: **dsh host** (APK 里的 Node 跑 dsh, 监听回环, 界面是它的 Web GUI 进 WebView) + **安卓控制端** (Miuix + Shizuku/root 通道 + 虚拟屏)
- **前台服务常驻** (Node / host / WebView 都在里面), 否则后台全被系统收掉
- host 以"上游 pack → 平铺 `npm install`"进 APK; 改 dsh 必须重新 build + pack
- **探 host 用 `127.0.0.1` 字面量**, 判据是 connect: `InetAddress.getLoopbackAddress()` 在安卓解成 `::1`, 而 host 绑 `127.0.0.1` —— 拿名字探永远答"空着"
- **「说不了话」先查投屏**: scrcpy 3.1 默认 `--audio` 把音频路由到 Remote Submix (`dumpsys audio` 报 `remote_submix(8000)`), 真解是 `scrcpy --no-audio`
- 监听地址: `HostSettings.lanAccess` → `--host 0.0.0.0 --allow-lan`; 安卓侧 `os.cpus().length` 可能回 0, 并行要容忍 0

## 测试设备

- **真机 A (主用)** `22041216C` / `OJZD5D6TMNSKFYHM`, HyperOS, 1080x2460, **锁屏口令走 `lw-unlock.ps1 -Pin` 或 `$env:LW_UNLOCK_PIN`** (不写进仓库)
- **真机 B** vivo `10CEB40568000ZB` (1260x2800): 触摸体感只归主人, 助手不碰
- 小米 13 `192.168.1.103:5555` (`fuxi`) 本机通常不在线
- **模拟器** `Luwi_API36` (`emulator-5554`) 只当兜底

## 真机测试

**默认真机, 模拟器只兜底**, 顺序固定

**每一项都要出读数, 按阶梯走**: 真机 A 装不上 / 解不开锁 / 不在线 → 同一项改在模拟器 `Luwi_API36` 上跑, 读数标注「模拟器, 待真机复验」; 只有模拟器也没有这项能力 (Shizuku / root 特权通道、快应用、MIUI 特有交互、真机专属硬件) 才允许没有读数 —— 但必须写清缺的是哪项能力, 并列为待真机复验。**不允许只写「真机未验」就交差**。

1. `adb devices` 取非 `emulator-` 的序列号; adb 在 `D:\apk\Sdk\platform-tools\adb.exe`, **bash 里不在 PATH**, 先 `. D:\apk\env.ps1` 或用全路径
2. 解锁**一条命令**: `pwsh -File tools\lw-unlock.ps1 [-Serial <序列号>] [-Pin <口令>] [-Tries 2] [-Only swipe|swipeLow|keypad]` (工作区入口 `dev.ps1 unlock`; 口令也可设 `$env:LW_UNLOCK_PIN`, 见「测试设备」那条)。它是**多方式轮换**的, 一种不行就换下一种: `swipe` (上滑 0.73→0.20 + 口令 + ENTER) → `swipeLow` (0.85→0.15) → `keypad` (按键盘坐标点 + ENTER)。最后打一张「方式 / 轮次 / 结果 / 读数」表, 退出码 0 = 亮着且解开了。三条规矩写死在脚本里 (2026-11-01 主人定的):
   - **密码输入页是黑屏** (secure 窗): 截图与 uiautomator 都看不出停在哪一页, 判断只认 `dumpsys window` 的 `isKeyguardShowing`
   - **换方式 / 重试之前先锁屏再亮屏** (`keyevent 26` → 224/26), 不留在"可能正停在密码页"的界面上 —— 在密码页上再划一下等于把它收掉, 后面每步都打在空气上
   - **注入 (lw_lock) 已从脚本里删掉** (2026-11-01 00:3x 主人: "把这个删了"): 这台已录的序列是坏的 (跑几步就 `the replay ran out of time`), 留着只会白等两轮。要恢复注入, 先在 Luwi → 设置 → 锁屏 里重录, 再单独用 `lw.ps1 -Method lock -Params '{"op":"unlock"}'` 调
3. 装机 `pwsh -File tools\lw-install.ps1 -Serial <序列号>`; MIUI 拒装先 `input keyevent KEYCODE_HOME` 放后台, 装完 `am start` 拉回 (**不带 `-S`**)
4. 判据: logcat 落 `D:\apk\logs\device\`, 截图落 `D:\apk\shots\<日期>-<设备>-<标签>.png`; shell 里不能用 `Select-String`, 重定向到 `.lwtmp\` 再在 PC 侧 grep
5. 进程纪律: 装完别让设备息屏 (首启解压 3 万文件); 别对已就绪实例 force-stop 后冷启
6. 收尾: `svc power stayon` 动过要写回; 回执写设备序列号 + 每条判据读数, **不写「已验证」**

**不算验过**: 只跑 `compileDebugKotlin`、只看截图、空着不写读数; 模拟器读数只算「开发项读数」, **发版闸 (B6) 的真机项仍必须真机** (不许拿模拟器代替), 但开发项不许因为「真机不在」而干脆不验

## 代码风格

- 中英都行, 中英文/数字之间留空格, **不用全角标点**, 用 `, . ( ) /`; **注释里不用句号**
- UI 字符串同时进 `values/strings.xml` 与 `values-zh/strings.xml` (**设置页也例外不了**), 键与顺序两边一致; 设置页键以 `settings_` 开头
- `strings.xml` 带参字符串里 `%` 必须写 `%%`, 裸 `%` 抛 `UnknownFormatConversionException` (判据 `tools/check-bare-percent.py`)
- 优先小步改, 不整文件重写; 先 `import` 再用短名

## 界面

- **上原生渲染虚拟屏预览, 下 `weight(1f)` WebView 渲染 dsh Web GUI, 会话界面不重写**
- **画面在 `TopAppBar` 下面**; 看画面时整条顶栏不画 (`CollapsedHeight = 52.dp`), 菜单浮右上角, 静 3 秒淡出
- 缩进与段间距由 `scaffolds/LazyColumn.kt` 给; **Card 不写水平边距, 不套 `padding(16.dp)`**; 按钮一律 `fillMaxWidth()`
- **转场已取消** (主人 2026-10-27 "取消左右跳转, 直接跳转"): `AppNav` 的 `transition` = `NavTransitions.None`, `dimAmount = 0f`; 横滑返回登记仍在, 别把开关接回去
- **主题是全局的: 存档跟着主题**: `config.defaultThemeId` 唯一一份, 首页/存档页/配置页/聊天页首帧都按它上色; `TavernStore.colorThemeOf` 读它, 本地缓存只当冷启动兜底
- **`has-bg` 必须由 JS 加, 不能静态写进 index.html** —— 第一帧就全透明的页面在这台 vivo 上只画第一下 (判据 `check-tavern`)
- 聊天页"首帧就对": 宿主把 `__THEME__` 填好 (`themedIndexPage`), 骨架 `.stSkeleton` 用中性灰, 页面自举 `/status` 一发 + 并发, **WebView 退出只摘不 `destroy()`** (`TavernWebViewCache`); 背景层始终在 Box 里, 别写成 `if (picture != null)` (会插节点重排)
- 三处图标同一份 `tools/brand/luwi-mark.png`; **`0.46` 是唯一个数别改**, 球那处 `GLYPH_INK_RATIO = 0.65`
- 设置页右上 ⋮ 五条 (反馈 / 检测更新 / 账号 / 关于 / 重启 host), 同一刻只开一个; **material3 不是本项目依赖**
- 设置页两层分组 (`GroupTitle` / `SectionTitle`), 缺省只展开省电与常用六段, **新加一段天然收起** (判据 `SettingsSectionsTest` + `check-settings-sections.mjs`)
- **返回键**: 后登记先赢, 由 `AppNav` 弹一层; 网页面板先问 `ui/PageBack.kt` (500 ms 没答就还给"再按一次退出"); **别在 `HostScreen` 再登记 BackHandler**
- **「正在想」由文件说了算**: `$DSH_HOME/lw/ball-phase.json` + `FileObserver`, 事件驱动零轮询; **会话钩子必须带 `{ global: true }`**
- **余额两条触发** (2026-11-01 深夜改口径): ①**每轮对话结束**覆盖缓存 (`seq: 0`, 只动 `balance.json` 不进框, 5 s 内不连刷 —— 那时扣费刚结算, 数最准); ②**主人点「看余额」**: 先把上次那份立刻上屏, 同时写一个新请求记号 (同一 seq 只刷一次, 成功/失败共用 30 s 闸)。应用按 **`seq` 对得上**才上屏 (不再按"点下去 30 s 之内"), 框已经被关掉也会张回来; 9 s 没回音就把「正在取…」换成「再点一次」。金额上屏只留两位小数 (`BalanceFile.moneyText` + 宿主 `money2`)
- **手势**: 单击开麦等 `BallFeel.thinkingTapMs()` (430 ms); 三击只对"真要开麦"几支排队; **半隐与半藏都关时没有"召出", 单击当场开语音**; **手势只有防误触一档** (`BallFeel.GUARD` 220/450/1500 ms), 灵敏度下拉已撤
- **球休闲两档 (半隐 / 半藏)**, 共用 `PEEK_IDLE_MS` 5 s; `TRANSLUCENT_ALPHA = 0.5` (半隐=一半透明度), 半藏不参与; 该收边时一定要收, **回弹判据是 `idleDueNow`, 不能拿 `wait.peek` 反推**
- **一个状态可有多支动作** (`ball.json` 写数组), 进档随机起头、演完换下一支、下一支后台预解, 过 `MAX_DECODED_FRAMES` 就不预解
- **立绘按高贴满**: 素材同一高度出, 宽度按比例居中; **别改回 `Gravity.FILL`**
- **老 WebView 要垫 polyfill**: `assets/web/lw-compat.js` 经 `addDocumentStartJavaScript` 注入, `MIN_MAJOR` = **116** (`Promise.withResolvers` / `AbortSignal.any`); 兜底是 12 秒没画出 `root` 就弹真 `Dialog`
- **补 polyfill 要扫 `host-tree` 里所有 client bundle**, 不能只看 `dsh-web-frontend/dist`
- **切后台回来不重载**: renderer 钉 `RENDERER_PRIORITY_BOUND`, `onRenderProcessGone` 返回 true 换新 (最多 3 次, `MAX_PAGE_REBUILDS`); **同一地址只 load 一次**; 判据 `tools/check-host-persistence.mjs`
- **两块 WebView 键盘避让**用 `ui/KeyboardInsets.kt` 的 `rememberImeLift` (只认贴底键盘); `adjustResize` 在 targetSdk 37 下不管用
- **`AndroidView` 里 WebView 必须显式 `layoutParams` MATCH_PARENT**, 否则 viewport unit 解析成 0

## 别做的事

- 不用 Miuix 重写会话界面
- **不跑 `scrcpy-server`, 不抄 MAA-Meow 代码** (AGPL); 反射包装从 `Genymobile/scrcpy` 取并留 NOTICE
- 不把 `SurfaceView` 塞进 WebView; 不给 Card 里的设置项再套 `padding(16.dp)`
- 不为"让模型能操作屏幕"写 MCP server, 先写 dsh 原生工具

## 特权通道

- 链路: 模型 → dsh 工具 → Node host → app loopback 桥 → binder → 特权进程 (uid 0/2000)
- `native/launcher.c` → `liblauncher.so` (可执行当 native lib), setenv `CLASSPATH` 后 fork + exec `app_process`; 不用 Shizuku user service, 直接 `IShizukuService.newProcess()`
- 回传 binder 必须经自己的 ContentProvider + `getContentProviderExternal`; provider 校验 uid + 一次性 token
- `channel/LwPrivilegedService.kt` **手写 Binder**: 出现 `.aidl` 会生成 Java, 把 AGP 9.4 的坏资源管线拉回构建
- 桥是 loopback TCP (临时端口 + 随机 token, `LW_CHANNEL_ENDPOINT` / `LW_CHANNEL_TOKEN`), **一连接一请求一行 JSON**
- **「有没有 root」查不到也弹不出**, 只能试; 授权由用户在 root 管理器给一次

## 虚拟屏

- **同一时刻只允许一块**: 建新屏把旧屏就地关掉再建; 应用 `create()` 先 `closeLocal`, 特权 `create()` 建前 `releaseAll()`
- **取帧在 app 进程 `FrameCache` (ImageReader)**: 有预览按 150 MB/s 自适应 (夹 33~200 ms), 截图与 OCR 读缓存; **虚拟屏不跑 `screencap`** (K40 上恒 0 字节)
- **取图只有主屏走 uid**: display 0 才 `screencap -p`, 虚拟屏是内存拷贝, 别搬回特权进程
- **预览是镜像不是输出面**; **buffer 必须等于屏尺寸**; **换屏要换 SurfaceView** (`key(displayId)`)
- **触摸要排队** (单线程), 否则 move 超过 down 会被丢
- 两道用户闸: 顶层「暂停接受控制」(拦 tap/swipe/launch, 不拦看) 与「虚拟屏触摸控制」(默认不选)

## dsh 工具

- 全在 `host-plugin/index.mjs`, 现 66 个 (`lw_probe` / `lw_screen*` / `lw_tap` / `lw_ocr` / `lw_wait_text` …), 每个一次桥调用
- **每个能力先过权限闸** (`PermissionGate` + `PermissionCatalog`): 缺什么说什么, **不假装成功**, 写入一律写完读回
- **答案由应用侧写**: 桥回来的 `result.text` 才是给人那句
- **只有 app uid 做不到的才走特权** (卸载/清数据/停应用/装包/停用/飞行/移动数据/蓝牙/熄屏), 特权侧写死白名单 `LwSystemCommandTable.kt`
- `displayId` 可省略 = "手里那块" (预览选中 → 最新建 → 无虚拟屏才 0); 事件订阅不补
- `lw_launch` 只走特权; 按键传名字不传编号; 打字优先 `ACTION_SET_TEXT`; `swipe` 均分 12 步、每步至少睡一帧
- 验证: `tools/lw-bridge.ps1` / `tools/lw-plugin-call.mjs` / `tools/lw-device-turn.ps1`; **读图不能在 run-as 里验**

## 主屏 / 语音 / 无障碍

- `displayId 0` 不进 `screens`, 尺寸现读, `release 0` 拒绝; **2026-10-08 起触摸刹车全删**, 只剩提示词层规矩
- **语音两档**: SenseVoice 快且缺省 (app 进程内), GLM 准但慢 (常驻进程, 点名 `engine=glm`); 两个模型都不随包发, 缺模型最多提醒 3 次
- **说时关麦**判据是 `LwSpeak.talking(context)`, **不是 `VoiceState.speaking`**
- 慢的根因是 30 秒静音垫: 唯一改上游处是 `LW_ASR_PAD_SECONDS` (缺省 4 s); **mel 长度必须按 8 帧对齐**; **GLM 必须 `-O3`** (Debug 变体不传优化, `-O0` 慢四十倍), 补在 `native/CMakeLists.txt`
- 无障碍: 链路 `LwAccessibility` → `ui`/`tapText`, **取树没有 binder**; `getWindowsOnAllDisplays()`; 匹配从窄到宽, 去重后多个就**什么都不按**; `ACTION_CLICK` 回 false 才注真触摸
- **开服务三条**: `-i` 重装是必要条件; 有些 ROM 应用写不动 secure settings, 正解跑 `tools/lw-install.ps1`; **"设置里写着"不等于"服务活着"**
- **重装会踢出 `enabled_accessibility_services`**; **别用 `am start -S`** (摘掉绑定)
- 通知: 授权只有 **`cmd notification allow_listener`** 算数, 直写 secure setting 系统不理; 没授权与"通知栏空"长得一样, `active()` 回 null 要按三种情况说清
- 事件订阅: 掩码只用四个 + `notificationTimeout="100"`, **不用 `typeAllMask`**; 队列有界 200、同类 400 ms 合并; **事件上没有 displayId**, 用 `windowId` 反查, 查不到 -1 **不猜 0**

## 端侧 OCR

- **fp16 是前提**; NPU 走 ORT QNN EP **设备上 JIT 编译**, 预编译 context binary 输出常数图别走; `libQnnHtpPrepare.so` (70 MB) 必须随包
- **NPU 标签说真话**: `backend = NPU` 只说明 QNN EP 被收下; 判据三件 `strict` / `fastrpc` / `probe`, 设置页显示 `NPU (SOC)` / `NPU (SOC) 混跑` / `CPU`
- **rec 用 batch 8** (`build-models.ps1` 缺省), 换回 1 只改参数; 模型 batch 维必须与输入一起钉死
- **det 640→960 与更大 det 都没采用** (字数不变、更慢)
- **图标按形状丢, 不抬分数线**: 近方形 (两边差 < 长边 0.35) + 长边 < 屏长边 9% + 分数 < 0.85; **同一行重复框要收掉** (`BOX_OVERLAP = 0.6`); 只有符号的框丢; 长行只在宽高比 > 10 才切段 (重叠 12 px)
- **`recMs` 是识别总时间**, 不是每行平均; **熄屏是静默失败**, 答案必须带 `screen: on|dozing|off`
- 调试图只在 `debug=true` 时写, 350 ms 一次的 `lw_wait_text` 轮询里一次都不写

## 权限与审批

- 普通权限装完就有; 运行时权限走设置页「权限」段或 `lw-install.ps1 -Perms`; 特殊访问只能 `appops set` / 系统页; `util/PermissionCatalog` 是唯一一份表, 设置页与 `lw_permissions` 都照它
- **`forceStop` / `clearData` / `uninstall` / `install` / `disable` 调用即执行**, 唯一那道闸在提示词层 (工具描述 + `skills/android-device-control/SKILL.md` + `assets/modes/phone.md`); 这层**拦不住模型**
- **审批全放行**就一行 auto-allow answerer, **`prepend: true` 必须**; `ApprovalOutcome` 封闭 fail-closed

## 技能 / 自动指令 / 探索

- 技能 `$DSH_HOME/skills/<name>/SKILL.md`, 快捷指令 `$DSH_HOME/quick-commands/<名字>.md`; 随包**显式列名字**不整目录拷; 技能缺什么补什么, 样例只发一次 (`.lw-seed`)
- `lw_quick` / `lw_automation` 的 op 两份实现, 判据 `check-quick-commands.mjs` / `check-automations.mjs`; **删除只在桥上**
- 自动指令: 规则 `$DSH_HOME/automations/<名字>.json`; **没有启用的规则就不注册**; 事件驱动不回退 UsageStats 轮询; 「且/或」收 2~5 个叶子**不许嵌套**; 命中后清新鲜标记 (**同一次只响一声**); 防骚扰: 静默 23:00-07:00 + 冷却 30 分钟 + 每天 5 次
- **探索没有手动开始**: 每天一个时刻由 `AlarmManager` (requestCode 42) 投一句话, 卡由 `lw_explore op=finish` 的 `nextTask` 演进 (上限 8000 字); **省电不拦探索**, 跳过只剩"上一场还在跑"; **宿主没在跑就先拉起来再投** (2.8.0 #9: 到点那一下 `startForegroundService` + 等就绪, 不再只记 skipped)
- 探索解锁: 开关是 `explore-schedule.json` 的 `unlock` (缺省关), 与「唤醒时自动解锁」是两个开关

## 随包插件

- 三段: `@dickpy/dsh-imagegen` (改图) + `skills/photo-edit` + `lw_image`; `edit_image` 只认引用对象, 走 `lw_image op=ref` 拍 `fullPath` 那份
- 随包 = `npm pack` **只取包本身不装依赖**; `PluginRows` 那行 **`name:` 必须写成 `file://` 形态**; 补上游写死 `~/.dsh/dsh-imagegen` 的路径要**数替换处数**
- **随包插件一律"先看本体, 有就不装"**: 别人已挂载 (`mountsPackage`) 或解析到宿主树之外 (`isUserCopy`) 就让位, **不删别人的行、不写别人目录**
- 第三个随包插件 `dsh-our-free-model` **已撤下**, 老设备挂载行由 `PluginRows` 的 `RETIRED` 表摘掉 (只摘指回宿主树那条)
- `PluginOverlay` 每启一次写 `disabled: false`; CSS 覆盖层是 `presets/ui-fix` (**只写选择器, 不复制组件**); 挂插件要往 `PLUGINS` 与 `OWN_PLUGINS` 两张表各加一行

## LW 插件

- 三层: 技能只给提示词, dsh 插件碰 host 侧, LW 插件是**设备侧能力**
- **卸载只有一个键, 什么都不留** (`.data` / 所有版本 / 审计 / 桌面槽 / 外观选择), 但伴侣 APK 不自动卸; 删不干净先停用再如实报错
- 落点 `$DSH_HOME/plugins/<id>/<version>/` + `current` (**文本文件不是 symlink**); `kind`: companion / art / inline (`dex` 是 inline 别名)
- **两侧都是手写 Binder, 仓库里不许有 `.aidl`**; 接口只在 `:lwplugin-api`
- **签名载荷两份实现必须逐字节相同** (键递归排序 / 紧凑分隔符 / 整数 / 逐文件哈希); 未签名只走开发者模式
- 宿主每 3 s 拉 snapshot, **revision 变了才重挂**
- **签好的包只在 `yuloong07-star/luwi-plugins` 的 `packages/`**; 推法 `lw-api-push.ps1` 加 `-RepoRoot/-Repo/-RemoteRef`, 先 dry run; **注解 tag 要本地先 `git tag -a` 打好**
- **索引 tag 一变, `PluginIndex.REF_CURRENT` / `REF_PREVIOUS` 必须跟着抬** —— 只推索引不重出包, 插件页永远看旧的
- 鲸鱼娘外观随包发 (2.7.10): 换版本号时**先清 `seed-assets/lw-plugins/`**, 否则两版 17 MB 一起打进; `plugin-seed.txt` 只补这一版一次
- `BallTheme.MAX_FRAMES` = **240** (20 s × 12 fps), 代价约 42 MB 解码内存; **东张西望档首尾硬切是定下来的, 别去修**; `动作可用/` 的 GIF 用它自带 alpha, 不走亮度键

## 工作区与存储

- `$DSH_HOME` = app 沙盒 `filesDir/dsh-home` (配置 / 凭据 / 会话); 工作区根 `/sdcard/DSH/`, 没文件权时 `/sdcard/Android/media/<pkg>/DSH`; 完全权限会话给整个 `/sdcard`; **不用 SAF**: host 是 Node 子进程拿不到 `content://`, 只有 `MANAGE_EXTERNAL_STORAGE` 一条
- `host/Workspace.kt` 三档解析, **每个候选先写探针文件**; 改完重启 host
- **`/sdcard` 是 FUSE**: 没有 inotify (降级轮询) / symlink 受限 / 小 I/O 慢 / 安卓 11+ `Android/data` 别人进不去

## Linux 沙盒

- 随包 Alpine 解到 `/data/local/tmp/lwlinux/rootfs`, 特权通道以 **shell uid** 起 proot; 动词只有 install / run / status / reset; **不是安全沙盒**: 网络通且关不掉, 边界只有 uid; **`/work` 是 noexec**, 编译产物落进 rootfs 再跑

## 构建与验证

- 改 Kotlin 先 `:app:compileDebugKotlin`; 它**不跑 manifest merger**, 改依赖或 sdk 版本要 `assembleDebug`
- **装机只走 `tools/lw-install.ps1`**: 流式安装 → 失败退"推上去 + `pm install -i`" → 回写无障碍与通知 → 等 `dsh web:` 就绪
- **Luwi 在前台时 MIUI 会拒装**: 先 `KEYCODE_HOME` 放后台再 `adb install -r -t -i com.miui.packageinstaller`, 不行就连着重试 (第 3 次过)
- 迭代: 改 dsh → `build\lw-dsh-patches.diff` 进 submodule → `pack-host.mjs` → `push-host.mjs` → 重启 app
- 判据: `DshHost: dsh web:` = 树起来了; `DshWebView: shell` 的 `rootChildren` 非 0 = 渲染; `LwMain: resumed with host Running` = 没重载
- **`packageDebug` 会在旧 APK 上原地改写**留空洞: **出包前先删 `app/build/outputs/apk/debug/app-debug.apk`**
- host 树逐文件裁剪在 `pack-host.mjs` 末尾 (剔 win32/darwin、`.map`、`.d.ts`、测试), 判据 `tools/check-host-slim.mjs`, **别用事后重打 zip 的脚本**
- **推送**: `git push` 不通; 走 `tools/lw-api-push.ps1`: blob → tree → commit → **最后才动 ref**, 每个对象比 SHA, 先 dry run 再 `-Apply -Tag`; `-input` 的 JSON 不能带 BOM; 提交正文末尾那个换行是对象里本来就有的
