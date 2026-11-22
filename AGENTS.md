# Luwi

把 dsh 搬到安卓: Miuix 界面 + 自建虚拟屏, 屏幕与输入做成 dsh 原生工具

只留**决策 / 约束 / 操作**; 过程去 `docs/step2-record.md`…`step8-record.md` / `docs/ui-record.md`, 构建旧账
`docs/host-build.md`, fork 改动权威 `third_party/deepseek-harness/patch.md` —— 别往本文加过程

## 发布

- **2.7.10 冻结**: `D:\apk\archive\releases\Luwi-2.7.10-frozen-20261030-r2.apk`, 250,390,159 字节, sha256
  `F89348B9…`, 2026-11-01 周日发, 一字节都不许改
- **2.8.0 发版包 = r4** (2026-11-15 主人: "用这个包作为 2.8.0 发版包"):
  `archive\releases\Luwi-2.8.0-frozen-20261115-r4.apk`, **241,340,796 字节**, sha256
  `be411842a45bb4810839407f710ed7654976597874068bef4eec564b42bbb8a3`, **versionCode 20 / versionName 2.8.0**,
  `debuggable=false`, 签名 `CN=Android Debug 652084a9…` —— 与 2.7.10 / r3 **逐字节同一个证书**, 所以两者都能
  直接覆盖安装, 会话 / 凭据 / 设置一个都不丢 (真机实测: 覆盖后 4 场历史、模型选择、`lw/sim.json` 都在);
  这一版的内容 = 门户「判断」抽屉两颗按钮真的能点 + 问答工具不挂 + 取消选图不报错 + 头像与背景都过裁剪窗
  (双指放大缩小, 没有固定像素档)。r1 / r2 / r3 原地留着; 这一版走 **PR #90** 进 main (`agent/2.8.0-r4-portal-crop`),
  merge commit `2069c82` —— **main 有分支保护, 直接推 heads/main 会被 422 挡**, 要 `lw-api-push.ps1 -Branch …` 推分支
  再 `gh pr merge`
- 发布只认 `archive\releases\` 副本 (`app-release.apk` 下次构建就被重写); `versionCode` / `versionName` 由人定
- 发布包 = `:app:assembleRelease` 的 `app-release.apk` (**2.8.0 #36 起**; 以前发 debug 包), `debuggable=false`;
  **签名仍是那把旧 debug key** (`CN=Android Debug`) —— 换 key 会让 2.7.10 装不上 2.8.0, 只能卸载重装,
  `files/dsh-home` (会话 / 凭据 / 设置) 跟着丢; **彻底换签名留到 2.8.1** (2026-11-15 主人定, 原记的 2.9.0 作废),
  且必须走 `apksigner` 的 v3 lineage
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
- **语音输入两档可选, 登录排在下载模型之前** (2026-11-15, 2.8.1 #4): 竖轨顺序改成 **特权通道 → 无障碍 →
  账号 → 唤醒模型 → 语音模型 → 选择权限**; 「下载 语音模型」那颗按钮下面多一颗 **「使用 DeepSeek 语音输入」**,
  点了就不下那 240 MB, 语音那一件直接算办过 (再按一次翻成「改用本地语音模型」); 没登录时点它开的是账号窗。
  选择落 `$DSH_HOME/lw/voice-source.json` (**`VoiceSource`**: 应用单写, 宿主只读), `ModelSetup` 的冷启动
  提醒也认它 —— 选了账号那条的机器不再被催下模型; 本地模型不在时宿主那句提示按选择分岔 (`voiceSourceChoice`);
  判据 `check-ready-card` 第十六节 + `VoiceSourceTest`
- **竖轨进度按顺序卡住** (2026-11-14): 有序清单 = 通道 → 无障碍 → 账号 → 唤醒模型 → 语音模型 → 选择权限
  (2026-11-15 起登录排在两个模型之前, 见上一条); `firstPending` 是第一个没办的
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
- 三处图标同一份 `tools/brand/luwi-mark.png`; **`0.46` 是唯一个数别改**, 球那处 `GLYPH_INK_RATIO = 0.65`;
  第二套 (女仆, `tools/brand/luwi-maid.png`) 由 `tools/make-icon-sets.py` 生成, 见下面「图标可切」那一条
- **图标可切** (2026-11-22 主人: "在设置的外观里加上切换 luwi 图标的选项…默认使用这张…所有用到图标的
  情况都要切换"): 设置 → 外观 → 「Luwi 图标」两套 (`IconSet.MAID` 是缺省, `IconSet.BUILTIN` 是原鲸尾),
  一次换**五类位置** —— 桌面入口 / 球 / 开屏 / 桌面组件 / 门户缺省头像 (含终端页) + 五处通知 small icon。
  三条硬约束: ① **桌面只能靠 `activity-alias`**: 每套一个 alias (`icon` + `roundIcon`), **`MainActivity`
  本体不再带 LAUNCHER** (留着就是两个桌面入口), 切序由 `IconSet.switchPlan` 定死 —— **先启用目标再停旧的**,
  反过来的那一瞬间零入口, 部分 ROM 会就此把图标清掉; ② 落 `$DSH_HOME/lw/icon.json` (应用单写, 认不出回
  `MAID`), 冷启动 `IconTheme.sync` 对一次账 (JSON 是权威, PackageManager 可能被桌面改过), 切换失败回滚;
  ③ 每套的素材是 `IconSet` 的四个字段 (`markRes` / `markInkRatio` / `markTintWhite` / `notifyRes`) ——
  球与开屏的尺寸按 `boxDpForInk` 换算, 内置 0.46 那一档与旧算式逐字节相同。通知图标是单色白模 (系统模板
  染色, 彩色图会糊成一团), `splash.json` 的 `icon` 仍是显式覆写 (优先于图标套)。判据
  `tools/check-icon-sets.mjs` + `IconSetTest`; 方案 `docs/Luwi-图标切换-方案-2026-11-22.md`
- **门户那张脸归设置 → 外观**: 「背景」「背景透明度」落 `$DSH_HOME/lw/face.json` + `lw/face/<名字>.jpg`
  (`tool/PortalFace.kt` 唯一写者, 换图只留一张), 页面走 `PortalBridge.portalLook()` 取 data URL (键是文件名),
  改完调 `__LUWI_PORTAL__.reloadLook()`
- **头像与背景都必须先过裁剪窗** (2026-11-15): 选图只到 `PortalFace.decodeBounded` (inSampleSize 预缩到 2048),
  裁与手势在 `ui/PortalCropDialog` (头像圆框 1:1 / 背景按屏比例, 因为页面是 `cover`), 算术全在 `tool/PortalCrop`
  (纯函数, `PortalCropTest`); 切图与压缩在 IO 上 (`PortalFace.cut`), **`setWall` / `setAvatar` 收的是裁好的
  Bitmap**, 不再是 uri。**没有"保存尺寸"档** (主人 2026-11-15: "要求双指放大缩小, 不加那个固定像素"),
  落盘尺寸由 `setWall` / `setAvatar` 各自的上限收 (1600 / 512); **框用 `pointerInput(Unit)` + 单一
  `mutableStateOf` State**: `remember(box)` 会把 State 换掉, 而手势 lambda 捕获的是旧的 —— 症状是"日志有
  pan, 画面纹丝不动" (真机踩过); 方图进 1:1 框时正好铺满, 拖不动是**对**的 (没有余量), 换横图才动
- **输入卡照 dsh `InputBar`** (28px 圆角 / input-major 实底 / soft elevation): 底部只 **`+`** (上传图片与 docs) 与
  **模型 chip**; 命令菜单 / 权限选择 / 工作区 / 预设都不画; **默认完全权限** (`danger-full-access`, 每场拨一次 +
  首次写 `permission.defaultPreset`); 气泡与浮层**只引 dsh 玻璃 token** (`--dsw-menu-surface-fill` /
  `--dsw-menu-backdrop-filter` / `--dsw-elevation-panel`); **待发附件行在文本区上面** (图/表情 64px 缩略 + `×`,
  非图 chip), **点表情只进待发栏** (`stageSticker`); 顶条不显示会话标题
- **门户里换的模型 = 新会话的模型, 后台 dsh 发的图也画真图** (2026-11-20): 前者靠 dsh 那条
  `selectModel` 把选择同时落成宿主默认 (`commands.ts` 改成 `await`, 2 s 上限) + 客户端 `select()` 成功后
  `catalog.refresh()`; 门户自己再补一手 —— 落到**空白场**上时问一次 `remote.session.modelCatalog()`,
  与 `modelState.current` 比过不一致就 `select(默认)` (纯函数 `blankModelNeedsDefault`), **非空白场永远
  不拨**。后者: 浮球 / 原生界面发的图不过门户 `lw-in` stash, 落盘只剩 `attachment.attachmentId`,
  门户走 `ctx.uiConversation.peekImageUrl / imageUrl` 取 blob URL 画, 取不到写「图没取到」, 单条最多
  4 张 + 「+N 张图」; 判据 `check-luwi-portal` 第二十五 / 二十六节
- **点发送必须看得见结果** (2.8.1 #33): 投出去先在本机占一行 (半透明 `pendingEcho`, 落盘那条 user 节点一到就让位,
  15 s 不认就撤); `prompt()` 回 `{ok:false}` / 抛错改成时间线上一行红字 (`sendFails`, 与图片失败同一档) +
  输入卡一句提示, **草稿只在这一刻还回去**; 发送钮三个监听器走 `sendGesture` (轻点 queue / 按住 550 ms steer,
  一次按下只投一次); 判据 `check-luwi-portal` 第二十八节
- 设置页右上 ⋮ 五条 (反馈 / 检测更新 / 账号 / 关于 / 重启 host), 同一刻只开一个; **material3 不是本项目依赖**
- **门户语音输入** (2026-11-20, 主人给的三张官方手机端截图): 输入框灰字是 **「发消息或长按说话」**;
  **空草稿长按 450 ms 就当场开录**, 没有"进语音态"那个中间步: 手指按住那一刻起音频就在往 `voiceChunks` 走,
  屏上升起那条 **录音条** (`#lwp-rec`) —— **不是盖住半屏的大面板**: 它压住输入卡那一块再高出半截
  (`left/right/bottom: 12px`, 高度 = `#lwp-card` 实测高 × **1.5**, `REC_PANEL_MAX 210` 封顶), 圆角 28;
  第一行左「红点呼吸 + 松手转写，上滑取消」右「计时胶囊」, 第二行是走带波形;
  **边缘是渐变不是硬边**: 面板上沿 `-webkit-mask-image` 22px 淡出, 波形左右两端各 9% 淡出
  (mask 会裁掉外投影, 所以只留上沿 1px 内高光 + 顶部径向柔光 + 3.5% 噪点);
  **帧循环必须起在 `voiceState = 'recording'` 之后** (`startRecPump()`, 2026-11-20 踩到的真因:
  早起一帧时状态还是 `press`, pump 第一行就 `return` 且不再排帧 —— 症状正是"条不动");
  **波形是走带式的, 不是一排等高柱子** (2026-11-20 重做, 读法照 wavesurfer 的 `scrollingWaveform`):
  每 **40 ms** 折一列 `REC_SAMPLE_MS`, 窗口 **80 列**; 峰值 → `recNextHold` (保持 + 0.995 衰减) →
  `recNormalise` (`ratio ** 0.6`, 低于 **0.02** 当静音) → **快起 0.6 / 慢落 0.12** → 入历史; 几何全在
  `recWaveRects` (走带右对齐 / 条宽 **2** + 缝 **1** + 圆角帽 **1** + 最小高 **2**, 上下镜像于中线);
  上色是缓存的一条竖直渐变 + 旧的往左淡出 + 右端柔光点, `roundRect` 没有就退 `fillRect`;
  **上滑过 56 px 进"松开取消"态** (条下沉 8px + 退成中性灰 + 出现向下箭头 + 提示换「松开取消」),
  松手丢弃并说一句「已取消」; 松手默认走转写 (条上换 **「正在转写…」+ 三个跳动点**), 文字接进草稿
  (有字时前留一个空格, 光标到末尾)。条 `pointer-events:none`, 抬手/上滑挂在 `window` 上
  —— 手指还压在原来的输入框上, 换 DOM 会把抬手事件吞掉。**上滑要挡两次手**: ① 长按那 450 ms 里给输入框
  写 `touch-action:none` (收手还原); ② 面板升起时挂 `touchmove` (`passive:false`) 现场 `preventDefault()`
  —— 只做①不够: Chromium 在 `touchstart` 那一刻就定了这一趟是不是 pan, 后写的 `touch-action` 对当前手势无效,
  症状是"按住再往上划 → 丢一发 `pointercancel` → 录音当场结束", 上滑取消那一路永远走不到。录音在**页面**
  (`getUserMedia` + `ScriptProcessor`,
  封 16 kHz 单声道 PCM16 wav, 上限 **60 s**), 转写在**应用** (`ui/PortalVoice.kt` → `LwSpeech.dispatch`,
  引擎跟 `lw/voice-source.json`), 结果走 `PortalState.run` 回推 `__LUWI_PORTAL__.voice`; 桥是
  `portalVoice` (status / ask / transcribe / cancel), **只答应不干活** (JavaBridge 线程上同步等一句话就是整页卡住);
  麦克风授权那一问经 `PortalAsk.Target.MIC` 由 `HostScreen` 弹; 判据 `check-luwi-portal` 第二十四节 + `PortalVoiceTest`
- **门户头栏**: 左 **头像 (28px, 热区就是头像, 点 = 历史窗)** + 昵称 (只是标识, 点不动), 右三颗装进
  **`#lwp-tabs` 一簇、整簇 `margin-left:auto` 贴最右**: **自动朗读 (喇叭, 30x28 圆钮) → 终端 → `⋯`**
  (2026-11-20: 原来「历史」的位置先给过麦克风, 按主人给的官方截图改成 **语音输出** —— 两颗图标两副形状:
  **关 = 喇叭 + 斜杠**, **开 = 喇叭 + 两道声波**; 点一下翻的就是 设置 → 说话 → 「朗读回答」那一格
  (`SpeakSettings.readAloud`, 一处状态两处界面), Toast 与图上逐字相同 **「已开启自动朗读」/「已关闭自动朗读」**,
  宿主每轮念之前自己问 `speak op=status`, 所以**不必重启 host**; 桥是 `portalSpeak` (status / toggle)。
  「同步」从抽屉搬上来并改名「终端」, **2026-11-21 起点它打开终端那一页** (不再翻开关, 开关只在设置页那一段),
   文案与亮灯仍从原生清单来;
  三颗从"跟着昵称走"改成"靠 ⋯"是对齐口径那次改的);
  **`⋯` 抽屉里不再画「终端」那一行** (球菜单那一份仍是原生下拉, 那一行还在 —— 两份菜单从这一天起差一行,
  是有意的) (判断 / 探索 进抽屉 `menu` 态, 顶上一行「‹ 返回」); 那颗「历史」胶囊 2026-11-19 已撤
  (入口并进头像), 新对话走历史窗底部「开始新的对话」与首启自动那一场; **「已开新对话」是浮层**
  (`#lwp-undo` = `position:absolute` + `z-index:2` + `pointer-events:none`, `top` 按头栏高度写) ——
  出现与收起都不占排版, 中间的图文不往下移再弹回来; 状态点是**头像右下角那颗** (`#lwp-busy`)
  三态 **绿 = 空场 / 蓝 = 对话中 / 黄 = 正在做** (`data-state`, 判据 `phaseThinking()` 与 `flowMode === 'hero'`)
- **终端那一页 = 手机管电脑** (2026-11-21, 2.8.1 #48): 门户头栏那颗「终端」/ 球菜单那一行都不再翻开关, 只打开这一页
  (`ui/PortalTerminal.kt`: `open` 铺黑底 + 收起虚拟屏小窗, `status` 交一份不含口令的读数); 页面侧 `#lwp-root[data-mode="terminal"]`
  **整页变黑**, 没连上电脑时只有「扫码配对 / 返回」两颗钮 (`terminalGateState` 六档); 终端里头像与名字**强制** `luwi` /
  `luwi终端` (`applyIdentity` 那一段覆盖, 外观里的昵称与自拍都不进终端); 历史窗在终端里只列**电脑那几场**、普通历史里把那些
  **排除掉** (`underShadow(cwd, shadowRoot)` + `historyRows(..., {mode})`), 两扇门互不串; 「新建」只在影子工作区
  里开一场 (**只复用插件同步出来的影子工作区, 不自建** —— 页面拿不到对端 deviceId, 自建的目录会让归属方闸认不出工作区), 第一句话由插件的归属方闸按 `target:{kind:new}` 转给电脑
  **进终端落哪一场 / 退出回哪一场** (2026-11-21 主人: "进入终端时打开1h内最近终端对话，没有要新建终端对话，返回时恢复门户对话"): `terminalEnter` 先看
  是不是已经在电脑那几场里 (是就不动 —— 人可能刚从终端历史挑了更早的一场), 否则 `terminalRecentRow(rows, now, TERMINAL_RECENT_MS)` 取 **1 小时内 `updatedAt`
  最大**那一场, **一场都没有才 `terminalNew({quiet:true})`** 新建 (静默那趟出的事走 `terminalNoteOnce`: 一分钟最多一句; 自动那趟 20 秒冷却, 人再点一次「终端」由 `setTerminal` 清 0);
  窗口只决定自动落哪一场, 更早的仍在终端历史里; 退出走 `terminalRestore`: 返回点由 `terminalReturnFor` 定 (**屏上就是电脑那一场时绝不把那一场记成返回点**), 同时写进 `TERMINAL_KEY.back`,
  页面重载 / 配对重启 host 之后由 `terminalReturnOf` 认回来 (**记成电脑那一场的老记录不认**); 落地判据是 `terminalLanded` ("画上了 且 mainView 不在电脑那一场", `switchTo` 的返回值只是"画得上"),
  **补拍 250 ms × 20 (5 秒)**, 真换了场才 15 秒不跟账本; 进终端前门户还没落场时回 `landInDefaultWorkspace('back')`, 那 10 秒等不到的影子工作区在退出终端之后一律作废 (`terminalNew` 里两道 `!terminalMode` 的闸)。
  **会话表那条跟随也两扇门互不串** (`listUnsub` 的 `sameKind`): 普通门户不跟电脑那几场, 终端里也不跟回手机那一场;
  **`adopt` 不再把电脑那几场写进 `SESSION_KEY`** —— 记了之后重载 / 退出门户再进来门户会停在电脑那一场 (在终端里退出门户时, 只有 mainView 真在电脑那一场才切一次工作区: 影子场 `openSession` 留不住, 只切门)
  **插件侧只有一个方向**: 手机 (扫码那台, `role:"phone"`) 写 `peer.listen=false` / `peer.acceptSend=false` / `workspace.enabled=false`; 电脑由面板写 `role:"pc"` — **别拿 `pairing` 判角色**, 电脑生成码时也写它
  电脑不能再读也不能下发指令 (队列那条路同闸: `receive()` 也看 `acceptSend`); 手机的控制面 (`panel/op` · `/luwi-sync/send` · `/peer-live`) 只认**回环 + 回环 Host 头** (`lib/loopback.mjs` 的 `isLocalRequest`, 挡 DNS rebinding 与同机反代)
  **2026-11-21 修整 (主人四条)**: ① 插件在 DSH 侧边栏那一行显示名改成 **`luwi终端`** (原「同步」), 同一插件里那枚**沙盒终端面板**
  (在手机的 Linux 沙盒里跑命令: `luwi-term` 入口 + `POST /luwi-sync/term` + `lib/term-channel.mjs`) 与同步无关, 整条下线;
  ② 「正在找电脑」那张卡**只许首探说一次** (`terminalGateState` 的 `firstProbe = busy && !(at > 0)`, 后续每一拍重探按上一次结论画 ——
  探针 5/15 秒一拍, 之前每拍都翻面, 症状就是"弹窗反复闪"); ③ **进终端不显示门户对话**: `renderFlow` 在
  `terminalMode && !isTerminalSession(sessionId)` 时清空并记 `TERMINAL_HIDDEN_SIG`, 样式那条
  `#lwp-root[data-mode="terminal"]:not([data-term-session="on"]) #lwp-flow{visibility:hidden}` 兜第一帧 (`markTerminalSession` 由
  `renderMeta` / `applyTerminalMode` 各对一次, 退出终端时 `closeTerminal` 作废签名再画回来); ④ 插件的**登录 Luwi 账号 / 权益**
  (`lib/luwi-license.mjs`、`sync-license.json`、`login-*` / `logout` / `license-refresh` 四个 op、P2P 到期闸) 整条删除 —— 它只给
  P2P 供读数而 P2P 缺省关、手机侧从不启用 (`p2p-service` 的 `requirePlan` 注入点留着, 缺省恒放行)
  **2026-11-21 晚 (插件 0.4.1)**: ① **账本写不进去的真因在 storage 的 schema**: `lib/domain.mjs` 的
  `lastPushHead` 钉着 sha 正则, 而 2026-10-21 真机把它写成一整段 git 输出 → 整条 `state` 记录每次
  `open/get/put` 都抛 `invalid-record`, 插件的账 (投影游标 / 基线) 从此静默停写; 现在这一格只校验 `string ≤ 4000`
  (它只作诊断); ② **投影账本必须落盘**: `persistProxyState()` 整段包 try, storage 写 4 s 超时,
  **无论成败都写** `<DSH_HOME>/lw/peer-ledger.json` (原子 rename), 失败走 `logger.error` + `peer.ledger` (面板 / `/sync doctor` /
  `peerRefresh()` 都读得到); 同一 `localId` 的 `lastSeq/snapshotV/turnCounter` 只许前进 (重做投影那一路两条异步收尾的先后
  不保证, 曾把 `snapshotV` 写回 1 → 下一轮再重做一次 → 一场变两场); ③ **重挂接管旧的那一场**: `reconcileProjections` 在
  建投影之前跑 —— 账上的 `localId` 归档了先 `unarchiveSession`, 不见了就按「标题 + 影子目录」挑本机现存那份 (**人正开着的
  优先**), 接管后游标对齐到它已有的 `peer-<seq>`, 同名副本归档; 账上那一条还活着时也顺手归档同名**投影**副本
  (`peer-<seq>` 事件 > 0 的才收, 人自己开的会话不动), 历史窗里不再两行同名; `applyTranscript` **先确认会话存在再折**
  (接管不成一个字节都不折、游标不动); ④ **没文本的轮也要有东西**: `lib/luwi-live.mjs` 数 `tool/call` 次数,
  `exit_plan_mode` 的 `plan` 正文当这一轮的回答, 否则落一行「这一轮在电脑上跑了 N 次工具，没有文字回复」;
  工具名与参数一个字都不进, `LIVE_SNAPSHOT_VERSION` **仍是 2** (升版本会再触发一轮"重做投影")
  **2026-11-21 深夜 (0.4.2)**: ① **单向**: 方向由角色定死 —— 电脑 (`role:pc`) 仍听 (手机要读它的快照) 仍收指令
  (手机管电脑), 但 **`proxy` 恒 false** (不再为手机会话建影子/投影); 面板那条「发给对端」与
  `POST /luwi-sync/send` 整条下线 (手机那一侧不动); ② **P2P 缺省开** (`P2P_DEFAULTS.enabled = true`, 显式
  `p2p.enabled:false` 才关), 面板 P2P 卡那颗开关走 `configure` 写回 JSON, 电脑 `native/win32-x64/lwiroh.exe`
  与手机 APK 里的 `lib/arm64-v8a/liblwiroh.so` 各自解析, 缺 sidecar 退 git 并在卡/doctor 说明;
  ③ **侧边栏不许无声消失**: 左座位先装、先摘旧注册 (HMR 重复 apply 会 `duplicate id`)、身体失败回滚图标,
  失败 `console.warn`; 宿主写 `$DSH_HOME/lw/plugin-mount.json` (`mounted/disabledReason/routes/seats/peer/p2p`),
  `withWebServer()` 拿不到服务时 `logger.error`, `/sync doctor` 打路由条数
  判据 `check-luwi-portal` 第二十七节 + `check-terminal` (回环 / 角色 / 沙盒终端已下线 / 侧边栏显示名与左座位) + `check-sync-setting` 第六节,
  方案 `docs/Luwi-终端-手机管电脑-方案-2026-11-21.md`
- **终端里的图与文件: 双向传, 走「附件段」不走附件块** (2026-11-22, 2.8.1 #50; 插件 0.4.6):
  手机侧 dsh 的附件在安卓上落不下, 手机 `lw-in/` 那一份才是门户画的东西 (`.lwp-image` / `.lwp-file` 读
  `/lw-out/in/<名字>`)。所以跨设备只做两件事 —— **搬字节 + 换路径**, 形状照 `[附件 N 个, 图片用 read_image 打开]`
  那一段 (`lib/luwi-attach.mjs` 是唯一解析器, 与 `tool/LwIn.kt` 的 `BallAttach` 逐字同一串, **前导空行不许 trim**)。
  手机→电脑: `agent/pre-step` 的 `carryAttachments` 把 `<HOME>/lw-in/` 那几份 POST 到 `/luwi-sync/peer/blob` (电脑暂存区,
  20 MB 上限), 收话时 `adoptStaged` 搬进**那一场工作区**的 `lw-in/` 再换路径 —— 电脑那边的模型 `read_image` 打得开;
  一份没过去就整条按原样发 + 落一句人话。电脑→手机: 快照 v3 的条目多一格 `media`, `materializeEntryMedia` 取回写
  `<HOME>/lw-in/peer-<设备8>-<名字>` (账在 `lw/peer-media.json`), 再把名单换成本机路径。**回声去重只比人话**
  (`pendingKeyOf`) —— 本地那句带本机路径、折回来的带对端路径, 整串比会把一句画两遍。快照升 v3 会让老投影
  重做一次 (`reopenProjection`, 旧场归档), 只为把媒体补进来
- **未配对时的「去给 PC 装 luwi终端」与设置里的「取消配对」** (2026-11-22): 前者在终端卡片 (只在 `unpaired` 那一档出现,
  `terminalGateState` 多一格 `install`) 与设置 → 终端两处, 都开同一个地址 (`PortalTerminal.PC_INSTALL_URL`, 门户经
  `PortalAsk.Target.PC_INSTALL` 交给 `HostScreen` 去 `openPage`); 后者 `SyncSetting.unpairIn` 只断牵连 —— 删 `pairing`
  与 `role`、清 `peer.url`/`peer.token`、四档闸全关、同步停掉 (远端挪进 `lw.savedRemote`), **对话 / 收下的附件 / 影子目录一个都不删**
- **PC 面板只剩三条身子** (2026-11-22 主人: "将仓库以下的面板全部删除"): 状态条 (含同步总开关) → 配对卡 → 仓库卡
  (含两次点击的确认条) → 自动刷新底栏。镜像读数 / 操作 / 对端 / P2P / 运行结果五块**整块撤掉** (`renderOverview` /
  `renderOpsCard` / `renderPeerCard` / `renderP2pCard` / `renderAnswer` 连函数一起删), 那些读数仍在 `/sync doctor`、
  `sync_*` 工具与 `/sync` 命令里; 动作失败原因落在状态条下面那一行 (`key: 'action-error'`), 别再加回"最底下那块回执"。
  手机侧那块只读面板 (`runner: 'luwi-bridge'`) 不动; 判据 `check-terminal` 第四节三条
- **P2P 那三件只剩 `/sync p2p`** (2026-11-22 主人: "挪到命令里"; 当晚又定 "那些命令你都改成中文"):
  **中文是正写, 英文留作别名** —— `/sync p2p 状态` / `开` / `关` / `确认 <设备 id>` / `吊销 <设备 id>`
  (`state` / `on` / `off` / `confirm` / `revoke` 照旧可用, 另认 `读数` / `打开` / `关闭` / `确认换机` / `撤销`);
  词表在 `lib/command-words.mjs` (`normalizeP2pAction` / `P2P_ACTIONS`, 零依赖, 单测直接跑, `index.mjs` 只 import 再转出);
  读数 `renderP2pState` 全中文 (`p2p: 开 · 传输 直连 9 ms` / `信任: 换机待确认 · SAS 123 456` / `计数: 发出 5` /
  `等确认换机: …` / `冷却中` / `最近错误`), 信任五档映射成中文, **机器可读的错误码原样保留** (`P2P_TIMEOUT`)。
  写面 `/sync p2p 开|关` 走 `applyConfigure(syncConfigFile, { p2p: { enabled } })` (写完要重启 host),
  `确认` / `吊销` 走 `p2pConfirmPeer` / `p2pRevokePeer` —— **与面板原来那两下确认写的是同一个文件、同一张信任表**,
  别另开一路。判据 `check-terminal` 第五/六/七条 + `test/render-p2p.test.mjs`




- **历史窗** (`#lwp-history`) 画 dsh 自己的会话表 (`ctx.sessions.list`): 搜索 + 新到旧 + 当前置顶 + 点行走
  `follow()` + 底部「开始新的对话」, **不另建历史文件**; `historyRows(snapshot, query, currentId)` 由
  `check-luwi-portal` 真跑; 头像与昵称同落 `lw/face.json` (`name` / `avatar`), 页面侧 `applyIdentity()` 一处改头栏与空态
- **前台不画浮球** (2026-11-14): 门户盖着时 `FloatingBall` 整个不画, 球菜单那几件 (虚拟屏 / 开发 / 触摸控制 / 终端 /
  酒馆 / 回到后台 / 反馈 / 设置) 由宿主 `ui/PortalMenu.kt` 出清单 (`portalMenu` / `portalMenuPick` 两条桥),
  门户 `⋯` 抽屉只负责画 (`renderMenuDrawer` / `renderScreenDrawer`) —— **唯一的例外是「终端」**: 它 2026-11-20
  从抽屉上移到头栏, `PortalMenu.json` 里那一行照旧留着给球菜单, 抽屉跳过它; **回到 dsh 后台浮球自己回来**
  (`PortalState.open` 为假时画) —— 后台没有门户头栏, 那时球是唯一的门; **球菜单没有撤**, 两份语义逐条对齐
  (判据 `check-luwi-portal` 第十一节); 跨到界面的三件 (设置 / 酒馆 / 反馈) 走 `PortalAsk.pending` 由 `HostScreen` 消费;
  **`__LUWI_PORTAL__.show()` 里不再问 `portal.isOpen()`** —— 那个方法从没暴露在对象上, 一按就是 TypeError,
  「回到前台」因此一直是死的 (2026-11-14 真机 logcat 抓到; `mount()` 自己幂等, 直接调它)
- **「开发」那一行在 探索 下面** (2026-11-17): 前台点进去是**页内抽屉** (`drawer === 'dev'` → `renderDevDrawer`), 与判断 / 探索 / 虚拟屏同一套排法, 读数走 `portalDev`, 动作走 `portalDevPick`; 后台球菜单那一份仍是**原生**下拉, 点「开发」弹 `DevPanelDialog`
  **虚拟屏子项 = 触摸控制 / 释放 / 显隐小窗**: 屏名那几行与「接受控制」那行刹车撤掉 (两个菜单同口径), 屏名连 `summary`
  都不再写 —— 同一时刻只一块屏, 那些行只是占位置
- **首启直接默认使用 `<工作区根>/Luwi`, 门户里没有任何选工作区入口** (2026-11-13 改口径, 原 #37 的按钮作废):
  ① 宿主一起来 (客户端开屏前) 就 `ensureExploreWorkspace` —— 目录不在就建 (`/sdcard/DSH/Luwi`), 建完注册,
  dsh 那一侧于是不会去问系统 Documents (安卓上必失败, 日志 `system Documents directory is unavailable`);
  ② 客户端空着时走 `landInDefaultWorkspace`: 列表里没有就 `portalWorkspace(true)` 备目录 + `workspaces.create({path})`
  (**不走 `initializeDefault`**) → 250 ms × 12 补拍 → `openWorkspace` + 150 ms × 24 等场 + `portalBind`;
  ③ 挑默认工作区按路径认 (尾部 `/` 归一), 认不到退第一条; 没成只留一句提示 + 一次 15 s 补试, 不弹窗
  (判据 `check-luwi-portal` 第十三节 + `check-explore` 第十四节)
- 设置页两层分组 (`GroupTitle` / `SectionTitle`), 缺省只展开省电与常用六段, **新加一段天然收起**
  (判据 `SettingsSectionsTest` + `check-settings-sections.mjs`)
- **设置页顶部一条段名索引条** (2026-11-14): 二十个段名排在顶栏下面一行, 左右滑着看全, 点一下**展开并滚到**
  那一段, 高亮跟着纵向滚动走; 段下标 = `SettingsListLeadingItems` + `SettingsSectionKeys` 的顺序 +
  `SettingsGroupTitleBefore` 那两处组标题 (页面上只有「常用」「能力」两处), **新加一段必须同时进
  `SettingsSectionKeys` 与 `SettingsSectionTitleRes`** (判据 `check-settings-sections.mjs` 第三节)
- **「开发」段只剩一个应用** (2.8.1 #16; 2026-11-17 第三次改口径): 开发台搬进主 APK —— `ui/DevConsoleActivity` 由 `lw_forge op=screen` 用 `am start` 拉到虚拟屏 (没有桌面图标), 读 `app-projects/.current` 与项目目录里的 `.lwforge/*`; **伴侣 APK 与手写 Binder 那套已删** (`lwdev-api` / `devconsole` / `DevBridge` / `IDevConsole`)。工具链仍是一份数据包: `ToolchainPack` 下 `luwi-toolchain.zip`、验 sha256、解包, 再交特权进程 `forge.stage`。设置段四行: 新建应用 / 开发工具链 / 从文件导入 / 打开开发台 (+ 下载页)
- **跨门户记录那一段按时间合并** (2026-11-14): `mergeTimeline(carried, orderTimeline(…))` —— 记录那一段**不再**
  盲接在头上 (盲拼接会把"冷启 / 换场那一拍只有她的行"的半截线冻进记录, 之后她的话整组压在自己的消息上面);
  同一身份留 live 那份、按 `time` 稳定排、缺时间沉底、尾部 240 截; `carryRecord()` 在 `lastUsers === 0`
  (节点还没加载) 时不抄; 方案 `docs/Luwi-门户时间线按时间合并-方案-2026-11-14.md`
- **返回键**: 后登记先赢, 由 `AppNav` 弹一层; 网页面板先问 `ui/PageBack.kt` (500 ms 没答就还给"再按一次退出");
  **别在 `HostScreen` 再登记 BackHandler**
- **「正在想」由文件说了算**: `$DSH_HOME/lw/ball-phase.json` + `FileObserver`, 零轮询; **会话钩子必须带 `{ global: true }`**
- **浮标那一场按"接着上一场"选, 换场是例外** (2026-11-20, 2.8.1 #35): **浮标那些话落在 `Luwi` 工作区** (`BALL_WORKSPACE_NAME` 从 `dsh-ball` 改成 `Luwi`, 与探索 / 主动场同一个目录; 老的 `dsh-ball` 目录留着不删, 只是不再往里投; 老账写着 `dsh-ball` 一律当没有)。窗口 `VOICE_SESSION_MS` **30 分钟**
  (原 10 分钟), 而且窗口只有普通一句话受它管 —— **含 `这个` / `刚才` / `改成` 那类指代的话, 过了窗口也接着
  上一场**, 上限 `VOICE_REFER_BACK_MS` 一天 (词表 `REFER_BACK_WORDS`; `refersBack` 子串命中)。账本
  (`voice/session.json`) 的写法也改了: 不再只看"谁发的", 而是 **`origin === 'ball'` 一定写; `replyBox` 只在
  "投的就是账本指的那一场"或"落点在浮标工作区 (`Luwi`) 底下"时写** —— 回复框里接着回的那一句要续期, 而框里挂着别
  的 GUI 场时一个字节都不许动 (2.7.8 根因二仍在)。**门户每一句都 `portalBind`** (`client.js` 的 `send`,
  `bound` 那道闸已拆): 只在第一句写的话, 门户里聊久了回浮标就换场。判据 `check-voice-inbox` 第 10/11/11c/15
  节 + `check-luwi-portal` (窗口两边一致、`send` 里没有 `bound` 闸) + `check-auto-shot` 第五节;
  方案 `docs/Luwi-浮标接着上一场-方案-2026-11-20.md`
- **她说的话也由文件说了算** (方案 `docs/Luwi-对话层-最终方案-2026-11-08.md`): `lw_say` 唯一发言工具, 只写
  `$DSH_HOME/lw/out/<sessionId>.jsonl` (宿主单写者: `seq` 起时 tail 取 max / `at` 单调 / `gapMs` 按 `sim.json` 的
  `send` 段抽); 门户走 `PortalBridge.portalOut(id, next)` 两段水位, 浮球走 `tool/OutFile.kt` 读同一份 ——
  **解析器只一处**, `OutWatch` 一个 `FileObserver` 三个听众 (门户 / 浮球 / 通知); 节奏 (含 `dueAt`)、条数、`seq` 两边必须一致; `luwi`
  档在 `BALL_SILENT_PRESETS` 里 (正文不进框不念), 图走只读 `/lw-out` (`kind:'prefix'` + effect + **只认回环两头**);
  判据 `tools/check-lw-out.mjs` (169 条) + `OutFileTest` / `BallOutboxTest`
- **她的话还要在手机上弹一条通知** (2.8.1 #7): 第三个听众 `tool/OutNotify.kt`, 挂在 `DshHostService.onCreate`;
  **应用不在前台才弹** (`getMyMemoryState` 的 importance `> IMPORTANCE_FOREGROUND`), 一句一条 (`lw-say` 渠道 /
  id = 会话与 `seq` 合成 / 点它经 `EXTRA_OPEN_SESSION` 回到那一场), **冷启动只记水位不补历史**, 表情取名字不写占位符
  `[…]`; 通知许可没给时只留一行 `LwNotify` 日志; 判据 `check-lw-out` 第十五节 + `OutNotifyTest`
- **没写过 `lw_say` 的轮次, 宿主在 turn end 补一行进同一份 jsonl** (有行就不再推 `op=reply`), 球与门户逐字同源;
  球换场先 `clearReplies`; **`BoxView.replies` 的 `inputType=TYPE_NULL` 会把换行压成空格, 必须 `setSingleLine(false)`**;
  回复之间**单换行**合并 (`kept.joinToString("\n")`)
- **判断层的「唤醒一下」一点就说话** (2026-11-16, 2.8.1 #8): 那颗按钮投 `source:"wake"` (与闹钟那一拍 `router` 分开),
  宿主那一支**一道判断闸都不看** (`routerWakeNow`); 先轮转落一句进那一场的 `lw/out`
  (3 s 内必见气泡, 连点不是同一句), 再开一场主动对话; 门户点完自己补 8 拍, 并照 `proactive.json` 的 `recent`
  把连点之间被 `run` 覆盖掉的那一场也补进来 (换场不清屏上已有的气泡); 判据 `check-luwi-portal` 第十七节
- **那一句必须主动找话题, 不能是被动应声** (2026-11-18, 2.8.1 #31): 被动池 (`我在, 怎么啦?` / `嗯? 叫我?`)
  整池撤掉, 换成 `wakeTopicFor` 从判断层里挑 —— `router.json` 的 `checks` (跳过 `enabled:false`, 今天说过的
  `checksSaid` 沉底) 与 `wishes.json` 的未了的事依次排, 每件带 `source` (`usage` / `schedule` / `check` / `wish`),
  挑中那件的原话带进 `「」` (`你之前提到的「开会前提醒」, 我还记着呢~`); 一件都没有才回 `ROUTER_WAKE_TOPICS`
  那一池闲话 (`今天过得怎么样呀`, 不带问号); 轮转跨"话题 x 句式"两维; **台词闸** `isPassiveOpener` 拦下被动应答语
  与光秃秃的短问句, 重选 3 次仍不合格才 `opener:"fallback"`; 开场正文 (`wakeStartLine`) 再把整张话题单子交给她并
  点名不许回 `怎么了` / `嗯?`; 那一行落 `lw/out` 时带 `topicSource`, 门户透成气泡的 `meta.topicSource` /
  `data-topic`; `router.json.wake` 记 `from` / `source` / `opener` / `what`; 判据 `check-luwi-portal` 第二十节
  真跑那几段纯函数, `check-router` / `check-ball-reply` 各补一节
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
- **键盘让位两层都不缩 WebView** (2026-11-22 定; 门户 2026-11-09 起就是这样): 宿主把 `ime - nav` (dp) 推给页面,
  门户写 `--lwp-ime` (只改 `#lwp-root` 的 padding-bottom, 背景图不动), **dsh 后台写 `--lw-dsh-ime`**
  (`ui-fix` 第三节: `[data-mobile-nav="frame"]` 的 `height` 减掉它, 没有那一层壳时退到 `#root` 的 padding),
  两处都经 `HostScreen` 的 `ImeLiftPusher` 推; 宿主另把 IME inset 从 WebView 吃掉, 否则 Chromium 再缩可视视口就整页平移。
  **以前"门户收起时缩 WebView"那条已作废** —— 逐帧 resize 一次呼键盘二十来次换 surface, 就是卡顿的现场;
  只有页面明说接不了 (`__LUWI_IME__` 不在, 见 `imeTakesLift`) 才退回缩边, 且**只用停稳的终值**。
  门户刷新那档靠 `LuwiPortal.portalIme()` 握手; 判据 `check-ui-fix.mjs` 一之二/二 + `check-luwi-portal.mjs` 第六节
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
- **她自己的记忆是 `lw_memory`** (2026-11-20, 方案 `docs/Luwi-活动板块情感化-主动对话方案-2026-11-20.md`):
  op = `add` / `list` / `profile` / `forget` / `boundary` / `mute` / `status`; 三层落 `$DSH_HOME/lw/memory/`
  (`episodes.jsonl` 情节 / `profile.json` 画像 / `relation.json` 关系 —— 最后一份**宿主单写**, 她只能读),
  他划的线落 `boundaries.json` (`hard: true` 的由 `lw_say` 硬拒, 所以 hard 那条至少 4 字, 免得把嘴堵上).
  **写入前有一道隐私形状闸** (长数字串 / 金额 / 链接 / 验证码那类词一律拒收), 宿主从 `wishes.json` 自动补情节
  也要过它; `forget` 会落墓碑 (`forgotten.json`), 否则下一轮宿主又把它补回来. 读那一面三档都放,
  写那一面归写动 (`PROACTIVE_ACT_TABLE` 的 `['list', 'status']`)
- **情感状态也是宿主算的** (`host-plugin/emotion/state.mjs`, 纯函数): 每轮 `turn/start` 落 `lw/memory/affect.json`,
  对话场拼在 `{{lw_persona}}` 后面, 主动场走开场正文第 5 参; 四个维度 (valence / arousal / engagement / phase)
  与共情策略都不调模型 —— 判据 `tools/check-emotion.mjs`
- **「情绪与关系」那五格归门户判断面板** (2026-11-21, 2.8.1 #46, 方案 §9): `sim.json` 的 `affect` 段五键
  `baseline` / `empathy` / `boundary` / `recall` / `honesty` (缺省 1 / 0 / 1 / 2 / 1), **只在判断面板多一组**
  (`ACTIVITY_GROUPS` 收 `affect`, `SIM_GROUPS` 仍是四组 —— 设置页一个字节不改, 主人 2026-11-21 07:17 拍板 ③);
  宿主 `affectSettingsOf(sim.affect)` 读同一套键, 三处生效: 缺省策略 (`empathy` 盖 `empathyPlanOf` 的 default 那支) /
  召回预算 0·2·4·6 (`recall`) / 「今天的分寸」三句与边界条数 (`baseline` / `boundary`), 而 `honesty` 只在
  **真的提到旧事时**附一句"这是记得的哪一句" —— 判据 `tools/check-sim.mjs` + `check-emotion.mjs` 第十一节.
  两条界面口径 (主人 2026-11-21 定): **`recall = 0` (不提旧事) 时透明程度那一格置灰** (`MutedRow`, 摆灰字不给
  下拉 —— 拨了不生效的格子比不摆更糟), **判断面板六组以上高度走 0.72 屏** (0.66 要滚两屏)
- **她这一摊有离线审计** (2026-11-21, 2.8.1 #47): `node tools/lw-emotion-audit.mjs [--home DIR] [--since 7]
  [--json] [--template]` 出六个数 (人格漂移 / 重复开场 / 追发率 / 透明引用率 / 策略分布 / 边界违规) 与
  关系曲线, 只读文件不调模型; 策略分布读 `lw/memory/plans.jsonl` (宿主每**开成**一场主动对话补一行),
  曲线读 `lw/memory/relation.jsonl` (**一天一行**: 换天补一行, 同一天只改写那一行), 两份都**只追加**、
  同一条路径上的写入串行 (`host-plugin/emotion/ledger.mjs`), 写不动只 warn 不拖死这一场;
  **读不到的读数是 `n/a` 不是 0** (`found` 那几个标记跟着 `--json` 出去), 追发只认主动开口那一侧、
  他说的只认 `voice` / `keyboard` / `ball` 三种 source (门户正文不进那份账, 所以它是下界);
  `--template` 打八维抽检骨架 (`--out <文件>` 才写盘, 缺省只打 stdout); **`--strict` 时有 `over` 就退 3**
  (进发版闸用), 缺省恒 0 —— 它是量尺, 不替人拦 (主人 2026-11-21 定);
  判据 `tools/check-emotion-audit.mjs` (夹具真跑)
- **每个能力先过权限闸** (`PermissionGate` + `PermissionCatalog`): 缺什么说什么, **不假装成功**, 写入写完读回
- **答案由应用侧写**: 桥回来的 `result.text` 才是给人那句
- **只有 app uid 做不到的才走特权** (卸载/清数据/停应用/装包/停用/飞行/移动数据/蓝牙/熄屏), 白名单
  `LwSystemCommandTable.kt`
- `displayId` 可省 = "手里那块" (预览选中 → 最新建 → 无虚拟屏才 0); 事件订阅不补
- `lw_launch` 只走特权; 按键传名字; 打字优先 `ACTION_SET_TEXT`; `swipe` 均分 12 步、每步睡一帧
- 验证: `tools/lw-bridge.ps1` / `tools/lw-plugin-call.mjs` / `tools/lw-device-turn.ps1`; **读图不能在 run-as 里验**
- **问答工具不挂** (2026-11-15 主人: "禁止问答工具, 出现需要进入对话才能选择回答, 用户在前台看不到"):
  `presets/luwi` / `presets/explore` 的 `tool-ask-user` 都是 `disabled: true` —— 那个选项卡长在 dsh 自己的会话
  界面里, 门户 / 球盖着时前台看不见, 一问就卡住; 要问就在正文里问 (那句话会进门户的时间线); 判据
  `check-presets.mjs` 第 ⑥ 节 (行在就必须 disabled)

## 手机应用工坊

- **`app-projects/` 落在会话工作区里** (`<cwd>/app-projects/<slug>/`): 模型用现成读写工具改 Java 与 res,
  `lw_forge` 只管结构化动作 (init / meta / icon / build / install / screen / preview); **没有 `write` op**
- **argv 由 `forge/ForgePlan.kt` 这个纯函数出, 模型碰不到命令行**; 特权侧只认 `/data/local/tmp/lwforge/` 下的
  二进制与项目根, 白名单之外一句拒
- **中间产物不进 `/sdcard`** (`/data/local/tmp/lwforge/work/<sha1(项目)>/`): FUSE 上没 exec 位, `/sdcard` 也不能
  当编译目录; 成品才复制进 `.lwforge/app.apk`
- **进度只认文件**: `.lwforge/progress.json` + `build.log` 一份真源, 开发台与 Luwi 都读它, 不另开事件通道
- **开发台只读**: 它改不了项目; 编辑由 agent 与文件工具负责, 唯一写的是它自己的 `current.json`
- **对齐自己写** (`forge/ForgeAligner.kt`): targetSdk >= 30 的包要求 `resources.arsc` 不压缩且 4 字节对齐, 工具链里没有 zipalign 就重写 zip 做这两件事; 质量仍由 `aapt2 dump badging` + `apksigner verify` 兜
- **工具链是 Termux 的 aarch64 构建**: JDK / aapt2 链着 `libz.so.1` / `libfmt` / `libabsl_*` 这一套, 全摊在
  `toolchain/lib`, `runArgv` 里写死 `LD_LIBRARY_PATH` (2026-11-17 真机: 少了它 java 报 libz.so.1 找不到)
- **javac 只能 `-source 8 -target 8` + `-bootclasspath`**: JDK 21 只在 8 这一档还允许 bootclasspath
  (17 会被 "not allowed with target 17" 挡回); 安卓侧 24+ 全收 v52
- **签名两份口令文件** (`keys/pass` 与 `keys/key-pass`): apksigner 的 `--ks-pass file:` 与 `--key-pass file:`
  各读到 EOF, 同一个文件用两次第二条会 `end of file reached`
- 工具链（JDK / aapt2 / d8 / apksigner / android.jar）**不是应用也不是模块**: 它是一份 `luwi-toolchain.zip`
  （113 MB，发布在下载仓），由 `tool/ToolchainPack.kt` 下到 Luwi 自己的外部目录、解包、再交特权进程搬进
  `/data/local/tmp/lwforge/toolchain`；二进制既不进主包也不合进源码

## 主屏 / 语音 / 无障碍

- `displayId 0` 不进 `screens`, 尺寸现读, `release 0` 拒绝; **触摸刹车全删**, 只剩提示词层规矩
- **语音两档**: SenseVoice 快 (缺省, app 进程内), GLM 准但慢 (常驻, 点名 `engine=glm`); 模型都不随包发, 缺模型最多
  提醒 3 次
- **说时关麦**判据 `LwSpeak.talking(context)`, 不是 `VoiceState.speaking`
- **语音输出默认关** (2026-11-15, 2.8.1 #5): `SpeakSettings.readAloud` 缺省 **false** (`speak-read-aloud` 没那个键
  就是关), 老机器也没例外 —— 回答落定自动念是替主人做主, 要开就在设置页开一次; 模型点名 `lw_speak` 与设置页
  试听不受影响
- **第五引擎 = DeepSeek 官方 TTS** (2026-11-15, 2.8.1 #5): `SpeakSettings.Engine.DEEPSEEK`, **登录即可用** ——
  不填地址也不填密钥。**令牌只在宿主**: 应用 `LwDeepseekTts` → 回环 `POST /lw-tts` → 宿主拿
  `deepseekAccount.resolveToken` (没登录退 `DEEPSEEK_API_KEY`) → `POST https://api.deepseek.com/v1/tools/tts`
  (`{text, voice_id, format:wav, filter_markdown}`, **没有语速参数**) → 音频原样回应用, 由 `LwVoiceClip` 放;
  音色只有 `stella` / `tide` (`LwDeepseekSpeech` 白名单, 认不出退回缺省), 没登录时宿主回一句"还没登录";
  判据 `LwDeepseekSpeechTest`
- **语音输入第三档 = DeepSeek 官方** (2026-11-15, 2.8.1 #6): 引导里选了「使用 DeepSeek 语音输入」的机器
  (`lw/voice-source.json` 写 `deepseek`) 那一句话与页面那颗麦克风都走 `engine=deepseek` —— **本地一个模型都不碰**
  (那 240 MB 不再是就绪的前提): 采样封成 16 位 PCM 单声道 wav, 按 **60 s 一片**切, 交回环 `POST /lw-asr`,
  宿主拿 `deepseekAccount.resolveToken` (没登录退 `DEEPSEEK_API_KEY`) 以 multipart 的 `file` 字段转
  `POST https://api.deepseek.com/v1/tools/asr` (官方上限 **8 MiB / 120 s**, **没有语种参数**), 回来的那句话过
  `TranscriptClean` 再进收件箱; **令牌仍然只在宿主**, 设置页「唤醒」段两行可换 (本地 / 官方), 判据
  `tools/check-voice-asr.mjs` + `LwDeepseekAsrTest`
- **账号令牌走 `x-dsh-auth-token`, 手填 Key 才走 `Authorization: Bearer`** (2026-11-20 真机定位): `/v1/tools/asr`
  与 `/v1/tools/tts` 两条原先都写 `Authorization: Bearer`, 于是**登录着也一直 401**
  (`Authentication Fails, Your api key: ****xxxx is invalid` —— 那串只是令牌尾 4 位, 与账号有效性无关);
  上游 `llm-deepseek-account` 发给 `/anthropic` 的是 `x-dsh-auth-token` (`TOKEN_HEADER`), 同一枚令牌换这个头
  TTS 直接 200 audio/wav、ASR 只剩请求体边界的 400。分档写在宿主一处 (`lwToolsAuthHeader`), 两条路由共用;
  判据 `check-voice-asr.mjs` / `check-speak-engine.mjs` 各钉一侧 (账号那条**不许**再带 `Authorization`)
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
- **探索只由判断层触发, 没有开关也没有时刻** (2026-11-21 两次改口径): `judgeRouter` 判 `say=true` 且球不在场时,
  宿主自己 `startExplore { via:'router' }`; 应用侧**没有**闹钟 / 自愈 / 补跑 / 总闸 (`ExploreAlarmReceiver` 已删,
  `explore-schedule.json` 只剩 `steps` 与 `unlock` 两键)。**开场读卡**: 宿主 `readExploreTask` 每场读
  `lw/explore-card.md` (卡由 `lw_explore op=finish` 的 `nextTask` 演进, 上限 8000 字) 当正文, 空卡才落"自由探索";
  **预算只有步数**: 设置页那一格由宿主 `readExploreSchedule` 每场现读, 拨 10 步就只跑 10 步 (分钟只剩宿主内部
  30 分钟看门狗); **省电不拦探索**; 屏锁着由探索自己在 `lw_lock op=unlock` 过「允许锁屏解锁」那道开关
- **收尾写三样**: 摘要 / `nextTask` / `checks` —— `checks` 是"接下来盯什么", 最多 3 条 (**判法** `usage` / `time` /
  `event`), 宿主写进 `$DSH_HOME/lw/router.json`, 判断层当第三档候选 (分数 3); **默认要交**: 没有就在摘要
  `仍不确定的点` 写明为什么; 任务卡覆盖带尾注 `EXPLORE_CARD_TAIL`
- **空手也留痕**: `explore.json` 的 `lastFinish {at, ended, written, total, session}` 与 `checksStreak` (同场重交不 +1)
- **跨应用记忆记在 `explore.json` 的 `run` 里** (2.8.1 #36): 三格 `run.intent` / `run.pkg` / `run.memory`
  (`{pkg: {intent, confirmed, pressed, failed, interrupted, resumed, active, at}}`) —— 切走标 `interrupted`,
  切回来 `resumed` +1 并把 intent 当 steer 第一行交回去 (`lw_explore op=status` 的 `memory.packages /
  interrupted / resumed / pressed` 读它); 一处真源、两处读 (`exploreMemoryStatus` 与 `exploreMemoryFor`);
  **硬界 `EXPLORE_MEMORY_MAX`** (缺省 8, 进程级环境变量): 超了按三级淘汰 —— ① 不是手里这个也没被打断的
  ② 回去过一次却什么都没捞到的 ③ 按 `at` 升序 (手里这个最后); 被打断的先留着, 但硬界照收
  (`0` **只关 memory 三格的新写**, `run.intent` / `run.pkg` 仍落盘, 盘上旧账仍报 —— 回退不是"逐字回到今天")
- **那三格记什么 / 不记什么** (2026-11-21 第二轮): `confirmed` 只在 `effect === 'changed'` 时记 (要等 #32
  的 effect 回读进基线), 基线里能记的是 **`pressed` 档** —— `unknown` + 真的按到了才有, 提示念「上次按过:
  X」; 盘上每行只留 `6 位 hash + 掩码后前 24 字` (`\d{4,}` → `****`, 金额 → `***`, 含验证码 / 密码 / 余额 /
  金额 / 身份证 / 卡号的整条不进), 幂等靠"切 7 字重算 hash 对得上"而不是看形状; **读侧也过滤**: `run.pkg` 与
  `memory` 里上一版留下的敏感行读回来就丢; 敏感包 = 短信 / 通讯录 / 电话 / 微信 / QQ / 邮箱 / 密码管理器 /
  健康 / 银行券商 / 支付 / 输入法 (段名 + 段前缀 + 全名三路), 归属只认 `lw_launch` 或"屏上包名真的变了"
  (主屏也走这条; 通知栏 / 权限弹窗 / 桌面 / 安装器不算, 桌面表与 `ROUTER_HOME_PACKAGES` 共用, 那张
  "哪块屏是哪个应用"的表随场次清、还屏删一格); 判据 `tools/check-explore.mjs` 第十九节
- **事件型判法要日历, 准点那拍应用自己算**: 宿主每拍问桥 `calendarWindow` (1.5 s 超时 / 60 s 缓存 / 读不到就
  `available:false`), 数据由 `LwCalendar.window` 给 (**不进 `LwCalendar.OPERATIONS`**); 提前量由 `RouterTick.leadAtOf`
  读 `router.json` 的 `checks` + `AutomationCalendar` 算 (`arm()` 跑得太早, 宿主那时还没判断完); 去重键
  `routerCheckHit` 回 `{fact, key}`, event 键是 `日期@startMs`
- **检测内容由探索加, 节奏由设置页给**: `$DSH_HOME/lw/sim.json` (见 `tool/SimSetting.kt`, 缺省照 `socialV2`) 管
  潜水/活跃、唤醒间隔、分条节奏、判断层阈值; 设置 → 活动 → 更多设置 是它的界面, **没有手写检测项的入口**;
  判据 `tools/check-sim.mjs` / `check-router.mjs`
- **表情单张上限同在那页**: `sim.json` 的 `sticker.maxMb` (1~20, 缺省 2), 三处同读 —— 宿主 `lw_sticker op=fetch`、
  `BallStickers.capBytes`、`PortalBridge`; 只改一处就"存得下但画不出"
- **表情"贴得勤不勤"也是设置里的一格** (2026-11-15, 主人: "当前发送表情包的概率太小"): `sim.json` 的
  `sticker.everyN` (0~20, 缺省 4, 0 = 不贴) —— 宿主把它换成提示词里的一句密度 (`stickerMoodLine`), 所以
  这是**行为**刻度不是物理上限。配套三件: ① `{{lw_stickers}}` 提示词变量 (`stickersFor`, 与 `lw_persona`
  同一个注入点) 把"库里有哪几张 + 标签 + 用过几次"直接喂进 prompt, 她不必先 `lw_sticker op=list`;
  ② `lw_say` 的 `sticker` 收**情绪/场景词** (`pickSticker` 按标签与名字挑, 多命中随机), 挑不到当场回候选
  —— 以前抄错名字是静默落一行画不出来的表情; ③ 说了话再补一张也认 (表情单独一个气泡, 以前只有没给文字
  才贴)。标签账落 `lw/stickers/tags.json` (`op=tag`, 不进张数也不当图)。**预设与宿主同一次装机才有
  `{{lw_stickers}}`**: 旧宿主 + 新预设会 fail loud (`unknown prompt variable`)。
  ④ **没标签的图会被点名三处** (2026-11-16 主人: "使用表情包时列出没有标签的图, 有就顺便标上"):
  提示词摘要的【还没标签】段 / `op=list` 尾行 / `lw_say` 贴出去的回执 —— 没标签的图只认准确文件名
  (`1000026655.jpg` 这种流水号等于检索不到), 所以贴中一张没标签的, 她说完那句话就顺手 `op=tag` 记
  1~3 个词 (一轮最多一张, 不为打标签另起一句话)
- **一条气泡只装一样东西** (2026-11-16, 2.8.1 #9, 主人: "表情或图片和文字同时进一条气泡时表情会被吞,
  要求表情图片等文件必须单独发一条气泡"): `lw_say` 的话 / 图 / 文件 / 表情**各落各的 jsonl 行** ——
  图与文件不再挂在最后一句的 prepare 上 (原来是同一个对象里两种 `kind`), 表情行也不再带 `[…]` 占位正文;
  一行 = 门户一个气泡 = 球一样东西。老行 (话与图并在一行) 由门户 `outItemsOf` 拆成两项; 判据
  `check-lw-out` 第十六节 + `check-luwi-portal` 第十八节 (真跑拆行真值表)
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
  (第 3 次过); **带 `-i` 反而更容易被 `INSTALL_FAILED_USER_RESTRICTED` 挡** —— 2026-11-20 起实测
  **不带 `-i` 的 `adb install -r -t <apk>` 一次就过** (连试三次里必有一次), 两条路都失败才去开发者选项开「USB 安装」
- **`packHostTree` 的 npm 走 npmjs, 不走 npmmirror** (2026-11-20): 用户 `~/.npmrc` 指着 npmmirror, 而镜像上
  `@earendil-works/pi-schema` 只同步到 1.5.x, `pi-ai` 被解析到 1.6.0 后就要 1.6.0 的 schema → `ETARGET` 整树挂;
  构建前先 `$env:npm_config_registry='https://registry.npmjs.org'` (同一台机器 npmjs 那条通, 只是慢)
- 迭代: submodule 里提交 (同一步改 `third_party/deepseek-harness/patch.md`) → `pack-host.mjs` → `push-host.mjs` → 重启 app
- 判据: `DshHost: dsh web:` = 树起来; `DshWebView: shell` 的 `rootChildren` 非 0 = 渲染; `LwMain: resumed with host Running`
  = 没重载
- **出包前先删旧 APK**: `app/build/outputs/apk/<变体>/app-<变体>.apk` (发布包是 `release/app-release.apk`) ——
  打包任务会在旧包上原地改写留空洞
- **新建的 git worktree 里 `jniLibs` 是空的** (2026-11-21 踩到): 24 个 `.so` (含 65 MB `libnode.so`) 是未跟踪的本地文件,
  只存在于别的检出里; 不补这一目录, `:app:assembleDebug` 照样 BUILD SUCCESSFUL, 但 APK 里没有 `libnode.so`,
  装机后 host 报 `node runtime is missing at …/lib/libnode.so`、整包起不来. 判据 `unzip -l <apk> | findstr libnode`
- **工位里的 dsh 子模块与 `luwi-plugins` 要自己备** (2026-11-21): `git -c protocol.file.allow=always submodule update
  --init third_party/deepseek-harness` (从别的检出 clone), 再在子模块里
  `pnpm install --frozen-lockfile --config.registry=https://registry.npmjs.org --config.node-linker=hoisted`
  (少了它会 `tsx` 找不到 `esbuild` / `tsc` 报 TS2554 退出); `copySeedAssets` 按「仓库根上级」找
  `luwi-plugins/packages/*.lwp`, 工位不在 `D:\apk` 底下时用 `mklink /J` 补一个
- **`packHostTree` 偶发原生崩溃**: `Client bundle` 那一步整个进程退 `3221226505` (`0xC0000409`), 那是原生
  bundler 一次从零打三百多个包时的偶发事 —— 同一棵树重跑就绿 (`run-gates` 10/10, 第二趟只补剩下的);
  `tools/pack-host.mjs` 只在原生崩溃码 / 信号上自动补跑一次, 脚本自己退的 1 不重试 (真红不许盖)
- host 树裁剪在 `pack-host.mjs` 末尾 (剔 win32/darwin、`.map`、`.d.ts`、测试), 判据 `tools/check-host-slim.mjs`,
  **别用事后重打 zip 的脚本**
- **换基座后先跑 `node tools/check-host-patches.mjs`**: 钉 `patch.md` 第 5/6/7/8 组 (bash/rg 指定、硬链接退路、附件
  祖先 fsync、`--allow-lan`); 0.2.2 换基座就悄悄丢了这四组, 症状 `spawn bash EACCES`
- **推送**: `git push` 不通; 走 `tools/lw-api-push.ps1`: blob → tree → commit → **最后才动 ref**, 每对象比 SHA,
  先 dry run 再 `-Apply -Tag`; `-input` 的 JSON 不能带 BOM
- **fetch 也不通 → 用 `tools/lw-api-fetch.mjs` 补对象** (2026-11-14): 同一个 GitHub API 反过来拉 —— commit 由
  `verification.payload` 原文重建 (**带 GPG 签名的要把 `verification.signature` 按 `gpgsig` 缩进插回去,
  且签名值**带**尾换行**, GitHub 的 merge 提交就是这样), tree 缺就逐层重建, blob 按 base64 写; 每个对象都跟
  期望 SHA 比对, 全对才 `update-ref`。`node tools/lw-api-fetch.mjs` 先看缺什么, 加 `--apply` 才动
  `refs/remotes/luwi/main`
- **`RemoteRef` 必须写全名** (2026-11-14 挖到的真坑): 仓库里同时有 `refs/heads/luwi/main` (一条陈旧本地分支)
  与 `refs/remotes/luwi/main`, 短名 `luwi/main` 会被 git 解析到**前者** —— 于是 base 永远是旧的, 每次推送都会把
  别人的提交重放一遍。那条本地分支已归档成 `refs/heads/archive/luwi-main-local`, 两个脚本的默认值也都改成
  `refs/remotes/luwi/main`
- **后台 job 回执为什么慢**: harness 判完成等**整棵进程树清空**, gradle 守护进程是子孙; `dev.ps1` 因此 ① DSH 会话里
  (`$env:DSH_SHELL`) 加 `--no-daemon` 并**跳过** assemble 前 `--stop`, ② 用 `Start-Process -RedirectStandardOutput` 跑
  (不再 `& gradlew | Tee-Object`), **不能加 `-Wait`**, 只 `$proc.WaitForExit()`; 代价: 输出不流式 (全文在
  `logs\build\<时间>-<标签>.log`), 慢 10~20 s
