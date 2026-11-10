# luwi 预设（新会话的默认档）

一句话：**二代仿真那套「像人一样说话 + 发言走工具」的规矩，装在这台会操作手机的 agent 上。**

> **2026-11-10 补人设**: 她是 DeepSeek 那条小鲸鱼 (小鲸鱼 / 蓝色大肥鱼), 傲娇嘴硬、心软藏着、正事靠谱;
> 叫他主人, 但**不演女仆 / 服从**。**人格卡是运行时读的**: prefix 里只有守则与 `{{lw_persona}}`,
> 卡落在 `$DSH_HOME/lw/persona/xiaojingyu.md` (设备上 `lw_persona op=write` 改, 下一次请求就生效);
> 卡源是 `persona/xiaojingyu.md` (= 包内默认, 由 pack-host 拷成 `lw-presets/persona.md`);
> 旧的 `persona/card.md` 原样留着可切回。来由与取舍见 `docs/Luwi-小鲸鱼人格-Luwi适配-2026-11-10.md`。

`presets/luwi/cordis.patch.yml` 是正文，随 host 树落进 `lw-presets/luwi.patch.yml`，
由 `CustomPresets.kt` 在 host spawn 之前追加进 profile patch（与 `explore` / `proactive` 同一条路）。

## 它是什么，不是什么

- **是**：一台私人设备上的 Luwi —— 能截图、点、滑、开应用、读通知、读写文件、跑命令，
  同时说话是她，不是命令行回显
- **是** 方案 A：**正文不发言，发言只走 `lw_say`**。QQ 那边靠桥接不转发正文；这边靠门户
  （`presets/luwi-portal` 的 `nodesOf` 不取 assistant 节点）不渲染正文。位置同构，所以这条成立
- **不是** qq-chat-v2 的复制：那一份是「无本地工具」，为的是防群友。搬到 Luwi 会把手机操作能力
  一起关掉，所以那一条换了写法（见下）
- **不是**另一套会话引擎：persona 与工具表都是 dsh 原生的，一行 dsh 代码都不动

**注意边界**：这套「正文不发言」只在门户里成立。门户关掉、回到 dsh 原生界面时，看到的是正文 ——
所以 persona 第 14 条要求正文只写过程（`（点开设置，看到亮度条）`），不是成品的人话。

## 与二代仿真的四条差异（都有理由）

| qq-chat-v2 的做法 | 这里 | 为什么 |
| :-- | :-- | :-- |
| 无本地工具（安全边界） | 工具全在，但「工具过程不算说话」 | 私人设备，没有群友；关掉工具等于关掉手机操作 |
| 正文不发送，发言走 `qq_send_message` | **照搬**：发言走 `lw_say`，正文只写过程 | Portal 就是 QQ 的位置（自己画消息流），所以这条同构成立 |
| `qq_wait_for_messages` / `mark_read` / `set_wake_config` | 不写；等待归宿主 `convo` 层 | Luwi 没有未读水位与唤醒协议，硬塞一个账只会对不上 |
| 群聊定位（解疑助手） | 换成「这一场在干什么」（陪聊 / 干活） | 同一个模型，一天里既聊天也干活 |

照搬的部分是语气那几条，一字没改：一条一个意群、单条 ≤30 字、单条内不用空格假装停顿、
不客服腔、不确定就说不确定、停止也是正常、不把一句话拆两条。

## 发言通道

**一个工具，一份数据，两个渲染器**（2026-11-08 主人：发球 = 发对话层）。`lw_say` 一次调用只写
`$DSH_HOME/lw/out/<sessionId>.jsonl` 这一份，门户（`portalOut`）与浮球（`tool/OutFile.kt`）**读同一份**
—— 一条 `seq`、一个 `gapMs`、同一个条数。不是"门户开着就只发一处"，也不是"推两份可能漂移的副本"。

| 参数 | 落成什么 | 门户 | 浮球 |
| :-- | :-- | :-- | :-- |
| `text` / `lines` | 一行一条 `kind:"text"` | 一个泡 | 框里那一行 |
| `sticker` | `kind:"sticker"` | 一行「（表情：名字）」 | 贴同一张（`BallStickers`） |
| `image` | `kind:"image"` + 图存 `out/assets/<sessionId>/` | 图片泡（`/lw-out/…` 同源，不走 base64） | 框里那张图 |
| `speak: true` | 不落新行，只标这一行要念 | 不念（门户不出声） | 念完才放下一条（`SPEAK_POLL_MS`） |

`lw_sticker` / `lw_speak` / `lw_overlay op=say|burst` 全部退成**底层通道**（宿主内部与老路径用），
模型那一侧只留 `lw_say`（persona 守则第 13–16 条就是这么写的）。

**节奏只有一份**：`gapMs` 由宿主按本机 `sim.json` 的 `send` 段抽一次算出来（算式与 `BallOutbox.gapFor`
逐行相同，`roll` 也落盘），两个界面都照那一份放 —— 同一句话不许有两种速度。

**正文不进框、不念**：`BALL_SILENT_PRESETS` 里有 `luwi`，所以那一轮的正文（过程笔记）既不会被画进浮球
那块 650 px 的框，也不会被念出来；要出声就给 `lw_say` 加 `speak: true`。

| `lw_overlay op=say` | 浮球气泡 | 只在球上，**不是回答** |
| 你发给她 | dsh 原生（`beginSubmission` 的 `attachments`） | 门户与 dsh 原生界面都能看 |

## 默认档怎么来的

`CustomPresets.DEFAULT_PRESET = "luwi"`：

- **新装的机器**：profile patch 里没有 `agent-preset-registry` 时，追加的就是 `selectedDefault: luwi`
- **已经装过的机器**：patch 里已经有那份注册表（写着 `custom`）时，`retuneDefault` 只改那一行，
  而且**只做一次**（标记 `$DSH_HOME/.preset-default-luwi`）。主人之后自己选别的档不会被反复改回去
- `custom` 那一档不删：它的人设是主人写在 `.agent-presets/custom/prompt.md` 里的，随时能切回去

## 判据

```powershell
node D:\apk\Luwi\tools\check-presets.mjs        # 三份随包预设的声明形状与默认档
.\gradlew.bat :app:testDebugUnitTest --tests "*CustomPresetsTest*"
.\gradlew.bat :app:compileDebugKotlin
```

设备上确认它真的挂上了：

```powershell
pwsh -File D:\apk\dev.ps1 log -Tag DshHost
# 期望看到: the preset declarations are in .../profiles/web/cordis.patch.yml
# 以及 lw_mode status 的 profile rows 一行是 "all in place"
```
