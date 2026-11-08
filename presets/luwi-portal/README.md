# luwi-portal

盖在 dsh 对话界面上的一张门户: **与球共用同一场会话**, 并把判断层 (router) 与工作结构 (explore 的
nextTask + router 的 checks) 摆在同一屏上

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
| `portalStatus()` | 读 `lw/router.json` + `lw/sim.json` + `lw/explore.json`, 原样回给页面 (不做判断) |
| `portalSession()` | 读 `voice/session.json`, 回 `{id, at, usable, remainMs, workspacePath}` |
| `portalBind(id)` | 把这一场写进账本 (`origin:"ball"`, `cwd` = `dsh-ball`), 球接下来 10 分钟接的就是它 |
| `portalTick()` | 往收件箱投一行 `source:"router"` + `RouterTick.ensure` (与定时敲钟同一个入口) |
| `portalTickEnabled(on)` | `RouterTick.setEnabled` |
| `portalCheckDone(id)` | `RouterChecks.drop` |
| `portalExplore()` | 往收件箱投一行 `source:"explore"` (正文是 `explore.json` 的 nextTask) |

**判断只在宿主那一处**: 门户显示的是 `router.json` 的 `last` (宿主 `judgeRouter` 判完写的), 它自己
不重算, 所以抽屉里那句 `why` 与宿主真的判过的那一次逐字一致

## 开关与回退

- `localStorage['dsh.luwi.portal']`: `on` (默认) / `off`
- **进出只有 Luwi 菜单一个入口** (右上那颗 Tune): 门户开着时那一条是「回到 dsh」, 收起之后变成
  「回到对话层」。界面上不放这两颗按钮 (2026-11-07 主人: "和返回 dsh 这些都加到 luwi 菜单里,
  不放界面上")
- 菜单那一条走的是 `window.__LUWI_PORTAL__` 的 `show()` / `hide()` (`HostScreen.kt` 的
  `PortalState` 握着 `evaluateJavascript` 那条入口); 门户每次挂载/收起报 `portalVisible`, 菜单靠它
  决定方向
- **收起门户时先开一张新对话** (2026-11-08 主人: "返回 dsh 时改成进入 dsh 的新对话界面"): `hide()`
  在撤掉覆盖层之前调一次 `ctx.uiWorkspace.startSession()`, 于是落进 dsh 的空白对话而不是落回门户
  刚映射过的那一场。不带参数时由 dsh 自己挑工作区并复用已有草稿, 不会每收一次就多一场空会话;
  开不出来就照旧落回原来那一场
- 彻底撤: `PluginOverlay` 摘掉那一行, 或把键置 `off` —— dsh 一个字节没动

## 判据

```powershell
node D:\apk\Luwi\tools\check-luwi-portal.mjs
```

查三件事: 包里该有的都在 (含依赖的 dsh 内部名字) / 挂得上 (两张表 + pack-host + 桥) / 两处写死的
量对得上 (工作区名 `dsh-ball`、账本窗口 `10 * 60 * 1000` 在宿主与 Kotlin 各一份)
