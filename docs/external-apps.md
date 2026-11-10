# 外部工具登记表

2.8.1 B2。把主人自己装的工具登记成**固定的 id**，模型就不必每台手机重新猜包名。

- 位置：`$DSH_HOME/lw/external-apps.json`（`$DSH_HOME` 就是 app 私有目录下的 `dsh-home`）
- 工具面：`lw_external op=list|probe|open|handoff`
- 这一层不下载、不安装、不建虚拟屏：装什么由主人自己决定

## 文件长什么样

```json
{
  "v": 1,
  "apps": [
    {
      "id": "termux",
      "label": "Termux",
      "package": "com.termux",
      "activity": "com.termux/.app.TermuxActivity",
      "sendAction": "android.intent.action.SEND",
      "mime": "text/plain"
    },
    {
      "id": "notes",
      "label": "备忘录",
      "package": "com.example.notes"
    }
  ]
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 模型用的名字，只能字母数字与横线，32 字符以内，不能重复 |
| `package` | 是 | 包名。`lw_apps query=...` 能查到一个应用的实际包名 |
| `label` | 否 | 给人看的名字，不写就用 `id` |
| `activity` | 否 | 显式组件，`包名/.类名` 或 `包名/完整类名`。不写就走启动器入口 |
| `sendAction` | 否 | `handoff` 用的 action，默认 `android.intent.action.SEND` |
| `mime` | 否 | `handoff` 用的类型，默认 `text/plain` |

坏一条不影响其余：漏 `package`、`id` 重名、包名不像包名、`activity` 写法不对，那一条会被跳过，
`list` 的输出里带上原因。整个文件不是 JSON 时，`list` 回空表并说清是哪一步坏的。

## 四个 op

| op | 做什么 | 不做什么 |
|---|---|---|
| `list`（默认） | 念登记表，每条带上"现在装没装" | 不发 Intent |
| `probe` | 问装没装、能不能打开、收不收这种文字 | 不发 Intent，不建屏 |
| `open` | 显式组件优先，退化到启动器 | 不猜包名：id 不在表里就回 unsupported |
| `handoff` | 把一段文字经 `ACTION_SEND` 交给它 | 不递文件、不递路径、不递凭据 |

`handoff` 的文本门槛（`ExternalApps.handoffProblem`）：

- 空、超过 500 字 → 拒
- 出现 `file://` `content://` `/data/` `/sdcard/` `/storage/` `data/local/tmp` `run-as` → 拒
- 出现以 `/` 开头的路径片段 → 拒。普通句子里的 `3/4` 不算路径，不会被拦
- 出现 `token` `api key` `secret` `password` `cookie` → 拒

要递文件内容，先用别的工具把它读成文字，再把要说的那段话写进 `text`。

## 为什么不是直接用 `lw_apps`

`lw_apps` 列的是这台手机上能启动的**全部**应用，`label` 随系统语言变。同一件事在两台手机上
会得到两个不同的名字，于是模型每换一台就要重新找一次。登记表把"我要用的那个"固定成一个 id，
换手机只要换一份 JSON。

## 判据

- `app/src/test/java/io/github/yuloong07star/luwi/channel/ExternalAppsTest.kt`：解析与 handoff 门槛
- 这一层不许出现下载与建屏调用（`lw_external` 的源码里没有 `Download` 与 `VirtualScreen`）

## 真机验证（2026-11-10，k40 / M2012K10C ares / Android 13 SDK 33）

登记表放在 `files/dsh-home/lw/external-apps.json`，四条：`termux`（com.termux）、`notes`（com.miui.notes，
`sendAction` 走 ACTION_SEND）、`settings`（显式组件 `com.android.settings/.Settings`）、`missing`
（`com.example.notinstalled`，故意不装，用来量负面路径）。

| op | 读数 |
|---|---|
| `list` | 四条都出来：termux、notes、settings 标"装了"，missing 标"没装" |
| `probe` | 三个装了；missing 回 unsupported；并报出 termux 与 notes 能收 `ACTION_SEND` 文本，settings 只能开 |
| `open notes` | 真的跳到备忘录：`dumpsys window` 的 `mCurrentFocus=Window{... com.miui.notes/com.miui.notes.ui.activity.EditActivity}` |
| `handoff hello → notes` | 「hello」五个字符作为 `EXTRA_TEXT` 交出去，系统回报已交 |

同一轮还验了两件负面事实：`missing` 没有被猜成别的包，`handoff` 只收纯文本。

验证方式说明：`third_party/deepseek-harness` 在本机是空目录（私有子模块未初始化），打不出带新 host 的
APK，所以这一轮是「新装应用侧 APK + 把 `lw_external` 的 46 行工具块与 55 行 `formatExternal` 移植进
手机上已解包的旧 `luwi-channel/index.mjs`（原文件备份为 `index.mjs.bak`）」。**仓库里的 host 代码路径尚未
被端到端跑过**，等用主分支打出的包再复验一次。
