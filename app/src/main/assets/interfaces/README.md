# Luwi 开放接口（给 agent / 脚本看）

这些是 Luwi 目前**对外开放**的文件接口。它们都在 `$DSH_HOME` 下面，agent 与 app 是同一个 uid，
所以读写都不需要 root 或额外权限。改完在"下一次该读它的时刻"生效（每条都写了是哪一刻）。

**先看「谁写」那一列**：标成「应用写」的那几条是 Luwi 自己的状态输出，agent 只读，不要覆盖 ——
覆盖出来的是一颗会说假话的球、或者一个假状态。

> **第 9 节不写密钥。** 密钥只存在应用偏好里，这份文档只报「有没有设置」——任何明文都不会落进
> `interfaces.md`、回执或日志。

## 总览

| 接口 | 文件 | 谁写 | 干什么 |
| :-- | :-- | :-- | :-- |
| 开屏外观 | `lw/splash.json` + `lw/splash/` | agent / 人 | 开屏的图标、动效、配色、文案 |
| 浮标状态 | `lw/ball-phase.json` | **应用写（只读）** | 球上「正在想 / 失败」那一档 |
| 浮标外观 | `plugins/.theme.json` | 应用（设置页那一行） | 选哪一套浮标外观 |
| 语音状态 | `lw/voice-live.json` | **应用写（只读）** | idle / listening / thinking / speaking |
| 快捷指令 | `quick-commands/<名字>.md` | agent / 人 | 设置页里点一下，把正文投给会话 |
| 技能 | `skills/<名字>/SKILL.md` | agent / 人 | dsh 按 frontmatter 的 name / description 认 |
| 自动指令 | `automations/<名字>.json` | 模型（经 `lw_automation`） | 满足条件就投一句话 |
| 探索卡 | `lw/explore-card.md` | 模型（经 `lw_explore op=finish`） | 下一场探索做什么 |
| API 朗读与音色库 | 第 9 节 + `lw/tts-voices.json` | 配置：应用写 / 音色库：应用代写（`lw_speak op=voice`） | 设计出来的音色登记在这里，设置页「说话 → API」读它 |

`$DSH_HOME` 在这台机器上是：

```
$DSH_HOME
```

这份文档自己就在 `$DSH_HOME/lw/interfaces.md`（每次开屏之前按最新版本覆盖一次），
设置页最末那段「接口」里的「复制文档地址」复制的就是这条路径。

## 1. 开屏外观

配置 `$DSH_HOME/lw/splash.json`，素材 `$DSH_HOME/lw/splash/`（`icon` 的名字相对这里）。
改完**下一次开屏**生效，不用重启 host，也不用改 APK。

```json
{
  "version": 1,
  "icon": "icon.png",
  "motion": "pulse",
  "accent": "#FFB86B",
  "background": "#101014",
  "log": true,
  "credit": "powered by deepseek harness",
  "title": "",
  "subtitle": ""
}
```

| 字段 | 类型 | 缺省 | 说明 |
| :-- | :-- | :-- | :-- |
| `version` | 整数 | `1` | 只认 1，别的值整份忽略 |
| `icon` | 字符串 | 空 | 相对 `splash/` 的图片名（png / jpg / webp），空 = Luwi 自己的标记 |
| `motion` | 字符串 | `"spin"` | `"spin"` 转圈 / `"pulse"` 呼吸 / `"none"` 不转（大小写不敏感） |
| `accent` | 颜色 | 跟随主题 | 环与进度条的颜色，`#RRGGBB` 或 `#AARRGGBB` |
| `background` | 颜色 | 跟随主题 | 整屏底色，配了它字色会按深浅自动取（深底白字） |
| `log` | 布尔 | `true` | 图标下面那行 host 输出，以及「点一下看完整日志」 |
| `credit` | 字符串 | `powered by deepseek harness` | 最底下一行，空串 = 不显示 |
| `title` | 字符串 | 空 | 图标下面那句话，空 = 用当前阶段（正在启动 host 等） |
| `subtitle` | 字符串 | 空 | `title` 再下面一行小字 |

- **逐字段回退**：哪一项写错（颜色不合法、`motion` 认不出来、图找不到）只有那一项回缺省，
  被拒的那项进 logcat（tag `LwSplash`）
- 图：原始 ≤ 8 MB，长边超过 480 px 会先缩到 480 再解，竖拍照片的 EXIF 方向会被认
- `icon` 不许绝对路径、不许 `..`
- 删掉 `splash.json` 与 `splash/` 里的图就是恢复默认开屏

## 2. 浮标状态（应用写，只读）

`$DSH_HOME/lw/ball-phase.json`，由宿主插件**原子写**（先写 `.tmp` 再 rename），应用用 inotify 盯目录。
agent 只读：手写它会让球显示一个不存在的「正在想」。

```json
{
  "v": 1,
  "at": 1759600000000,
  "turns": [{ "id": "session-…", "startedAt": 1759599990000 }],
  "last": { "id": "session-…", "at": 1759600000000, "kind": "error", "why": "…" }
}
```

| 键 | 说明 |
| :-- | :-- |
| `turns` | 哪几场在跑，一项一场；球上只显示 **`startedAt` 最大**那一场，它的环色按会话固定（5 色轮转） |
| `last` | 刚结束的那一轮怎么收的（可缺）；`kind` 是 dsh 的原样透传，`why` 只有带结构化理由时才有 |

`kind` 里只有三种会在球上写成「失败」：`error`（真失败）、`blocked`（被闸住，一步没跑）、
`max-tokens`（回答被截断）。`completed` / `aborted` / `interrupted` / `forked` 都不报失败。

球上的状态名（外观插件的 `ball.json` 用的就是这几个）：`idle` / `listening` / `thinking` /
`speaking` / `failed` / `done` / `peeked`（贴边半藏那一档）。

## 3. 浮标外观

`$DSH_HOME/plugins/.theme.json`：`{"id":"<插件 id>"}`，空 id = 内置画法。
它由设置页「浮标外观」那一行写，换了之后球在下一次重画时生效。外观插件本身是 LW 插件
（`kind: art`，带 `theme/ball.json`），仓库在 `Luwi-developers/luwi-plugins`。

## 4. 语音状态（应用写，只读）

`$DSH_HOME/lw/voice-live.json`，**只在状态真的跳变时写一次**（零轮询）。

```json
{ "v": 1, "state": "idle", "session": "session-…", "at": 1759600000000 }
```

- `state`：`idle` / `listening` / `thinking` / `speaking`（优先级 说 > 想 > 听 > 待机）
- `session`：不透明的会话 id，可为空；**没有任何文本或标题**
- `at`：只在这份文件里，不进广播也不进 provider
- 广播 / provider 那一级出口由设置页那个开关控制（填包名，默认关），内容只有 `state` 与 `session`

## 5. 快捷指令

`$DSH_HOME/quick-commands/<名字>.md`，一个文件一条，**正文不写 frontmatter**（正文就是投给会话的那段
工作流）。文件名去掉 `.md` 就是它在设置页里的名字。点一下 = 往会话投一句话（`source: quick`）。

## 6. 技能

`$DSH_HOME/skills/<名字>/SKILL.md`，目录名 = frontmatter 里的 `name`。dsh 靠 frontmatter 的
`name` / `description` 认它，`description` 要写清"什么时候该用它"。

```markdown
---
name: my-skill
description: 一句话说清什么时候该用这个技能
---

正文（给模型看的步骤、规范、例子）
```

## 7. 自动指令

`$DSH_HOME/automations/<名字>.json`，**由模型经 `lw_automation` 写**（别手搓，格式有闸）。
规则形状：`{"kind":"all"|"any","conds":[{"kind":"…"},…]}`，叶子 2~5 个、**不许嵌套**；
叶子 `kind` 有 `notice` / `foreground` / `light` / `time` / `place` / `weather` / `unlock` / `activity`，
动作 `kind` 有 `remind` / `task`。同一目录下还有 `settings.json`（九个监测器开关）、
`history.jsonl`（一次判定一行，冷却与上限都从它算）、`places.json`。

## 8. 探索卡

`$DSH_HOME/lw/explore-card.md`（上限 8000 字）。每天一个时刻由 `AlarmManager` 读它投一句话，
卡本身由 `lw_explore op=finish` 的 `nextTask` 演进 —— **改它用工具，别直接覆盖文件**。

## 9. API 朗读与音色库

### 当前配置（实况，随设置更新）

下面几行是这台机器**此刻**的设置；念之前应用也会现读一次。改了设置之后这份文件会跟着重写，
不用重启 host：

```
api-url:      {{API_URL}}
api-endpoint: {{API_ENDPOINT}}
api-key:      {{API_KEY_STATE}}
api-model:    {{API_MODEL}}
api-voice:    {{API_VOICE}}
```

- `api-endpoint` 是补全后的真正请求地址（OpenAI 兼容的 `POST …/v1/audio/speech`）：地址那栏填域名、
  `…/v1` 或完整端点都能补。
- 只有设置里把朗读引擎选成 **API** 时，下面这些音色才会用在回答朗读上。
- `api-key` 只是**有没有设置**，值不在本文档里；需要鉴权的服务商，请主人把密钥交给你，或由主人代做
  设计那一步，只把服务商返回的音色标识给你。

### 音色库 `$DSH_HOME/lw/tts-voices.json`

**应用代写（`lw_speak op=voice action=add`），手改也行。** 为什么不是直接写文件：会话自己的 `read` /
`write` / `bash` 被 dsh 的文件沙箱关在**工作区**里，看不到 `$DSH_HOME`（快捷指令、自动指令、探索卡
是同一个道理）；登记与撤销由应用代做，格式与上限都在应用那一侧。

设计出来的音色登记在这里，设置页「说话 → API」那一段会把它列进音色选择；选中哪一条存在应用偏好里。

```json
{
  "v": 1,
  "voices": [
    { "id": "luwi-soft-01", "name": "柔声", "model": "cosyvoice-v3-plus", "note": "女声, 偏轻" }
  ]
}
```

| 字段 | 必填 | 说明 |
| :-- | :-- | :-- |
| `v` | 否 | 只认 `1`（缺省视为 1），别的值整份不采用 |
| `id` | 是 | 服务商给的音色标识，去空白后 ≤ 128 字符；重复时后写的覆盖先写的 |
| `name` | 否 | 设置页显示的名字，≤ 48 字符；缺省用 `id` |
| `model` | 否 | 只对这一条音色生效的模型（有的服务商把设计出来的音色挂在另一个模型上）；缺省用上面的 `api-model` |
| `note` | 否 | 一句备注，≤ 120 字符 |

- 最多 **32** 条；认不出的条目在读取时跳过，不会把整份作废；文件读不懂时**拒绝增量写**（先修或清空）。
- 文件 > 256 KiB / 不是 JSON / `v` 不对：整份不采用，设置页与 `lw_speak op=status` 会报原因。
- 登记走工具，读这一份不用重启：设置页那一段开着时会自己重读；`lw_speak op=status` 每次都现读。

### 怎么设计一个音色（给 agent）

1. 用上面的 `api-url` / `api-model` 调**服务商自己的**音色设计或声音复刻接口（`api-key` 那行只说明
   有没有设置，**值不在这里**；需要鉴权时向主人要，或请主人代做这一步）。Luwi 不绑定任何一家，也不
   代你调 —— 各家端点、请求体与返回字段以服务商文档为准。
2. 拿到它给的音色标识（有的家叫 `voice_id`，有的叫 `voice_type` 或别的名字）之后登记：

   ```
   lw_speak op=voice action=add id=<标识> name=<显示名> model=<这条音色所属的模型，可省>
   ```

   `action=list` 看已经登记了什么，`action=remove id=<标识或登记名>` 删掉一条。
3. 在设置页「说话 → API → 音色」里挑它；也可以**不改设置**，用
   `lw_speak op=speak text="…" voice=<标识或登记名>` 当场试听。
4. 服务商没有设计 / 复刻能力时，这里没有可伪造的替代：**不要编一个 id** 登记进去，那只会让朗读报错。

## 许可与回退

- 读不到 / 写坏了：开屏回默认那一套、球不亮「正在想」、语音状态停在 `idle` —— 都不会让 app 起不来
- 音色库读不到只是「说话 → API」那一段空着，不影响朗读：选中的音色标识照旧发给服务商
- 上面这些路径里，`lw/` 与 `skills/`、`quick-commands/`、`automations/` 都在 app 沙盒内，工作区根
  （`/sdcard/DSH/`）是另一回事：那是 dsh 的工作区，不放这些
