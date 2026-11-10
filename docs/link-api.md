# 连接接口 (Link API, 2.8.1 B1)

别的应用问 Luwi「你现在什么状态」的那扇门。这一版只开了一条只读 scope, 而且只认**同一张证书**签出来的应用。

## 为什么先只认同签名

`lw_external` (PR #54) 是 Luwi 主动去开别人的应用, 谁拿到通道 token 都能调。反过来让别人问 Luwi, 第一步必须先把"谁能问"定下来, 否则每个 scope 都要各写一份判断, 以后返工。

同签名的语义很硬, 也很清楚: `PackageManager.checkSignatures(callerUid, myUid) == SIGNATURE_MATCH`。也就是说**只有用同一把 debug/发布证书签出来的应用**绑得上, 不需要用户在弹窗里点任何东西。第三方逐 scope 授权那一档等 `notify.post` / `speak.request` 这些真要给第三方用的时候再开。

## 协议

手写 Binder, 不引 `.aidl` (仓库里一律不引: aidl 会生成 Java, 把 AGP 9 的坏资源管线拉回来)。

绑服务:

```kotlin
val intent = Intent("io.github.yuloong07star.luwi.link.BIND")
    .setPackage("io.github.yuloong07star.luwi")
bindService(intent, conn, Context.BIND_AUTO_CREATE)
```

服务在 manifest 里带 `android:permission="io.github.yuloong07star.luwi.permission.LINK"`, 那条权限是 `signature` 级, 所以不同签名的调用方连 bind 都过不去。

两个事务:

| code | 名字 | 请求 | 回复 |
|---|---|---|---|
| `0x4c5701` | describe | 无 | 一段 JSON, 说这一版开了哪些 scope |
| `0x4c5702` | invoke | `scope`, `method`, `params` 三个字符串 | `{"ok":true,"data":…}` 或 `{"ok":false,"code":…,"because":…}` |

`describe` 的样子:

```json
{"api":"lw-link/1","scopes":[{"id":"state.read","methods":["snapshot"]}],
 "pending":["status.read","notify.post","speak.request","widget.attach","prompt.write"]}
```

`pending` 是**故意写出来的**: 调用方看到自己想要的 scope 不在 `scopes` 里但出现在 `pending`, 就知道是"还没开", 而不是自己写错了名字。

## 这一版开的 scope

### `state.read` / `snapshot`

读一眼就有的事实, 不现起子进程、不截图、不打开任何东西:

```json
{"app":"2.8.0","code":19,"host":"7888d54c31aaa159a32bfbfd66023f89","nodeMb":65,
 "channel":{"connected":true,"backend":"shizuku"},"accessibility":true,
 "screens":{"count":1,"displayId":2,"width":1080,"height":2316,"dpi":440},
 "storageFreeMb":47578}
```

字段语义:

- `null` 表示**这一版读不到**, 不表示"没有"。调用方不要把 `null` 当 `false`
- `host` 是 host 解包 stamp 的第一行; `nodeMb` 是 `libnode.so` 的大小
- `channel` / `accessibility` / `screens` 用的是应用里现成的状态, 没有额外探测

## 限流与审计

- 同一个 uid 一分钟最多 **30 次**, 超了回 `{"ok":false,"code":"too-many"}`
- 每次调用都往 `$DSH_HOME/lw/link-audit.log` 追加一行, **放行和拒绝都写**: 时间 / uid / 包名 / scope / 方法 / 结果 / 耗时
- 审计**不记参数正文与返回读数** —— 它是"谁调过我"的证据, 不是内容的副本
- 文件超过 256 KB 轮换成 `link-audit.log.1`, 只留一份旧的

一行长这样:

```
2026-11-10T19:20:00.000+0800 uid=10123 pkg=com.luwi.companion scope=state.read method=snapshot ok=true code=- because=- ms=3
```

## 拒绝码

| code | 什么时候 |
|---|---|
| `unknown-scope` | scope 名字不认识, 或者这一版没开 |
| `unknown-method` | scope 认识, 但它没有这个方法 |
| `not-same-signature` | 调用方不是同证书签的 |
| `too-many` | 一分钟超过 30 次 |

## 判据

- 同签名调用方 `describe` 能拿到 `lw-link/1`
- 同签名调用方 `invoke state.read snapshot` 能拿到上面那段 JSON
- 未知 scope 回 `unknown-scope`, 且审计里留一行 `ok=false`
- 一分钟内第 31 次回 `too-many`
- 审计文件里不出现调用参数的内容

前四条里, 除"同签名能通"之外都钉在 `app/src/test/java/io/github/yuloong07star/luwi/link/LinkTest.kt` (9 条) 上; 真机只验最后那条端到端。

## 真机验证 (2026-11-10, k40 / M2012K10C / ares / Android 13 / SDK 33)

探针应用 `D:\k40\linkprobe` (仓库外, 只为这次验证存在): 一个单 Activity 的独立 apk, 用编译 Luwi 的同一把 debug 证书签名, 包名 `io.github.yuloong07star.luwi.linkprobe`。

| 步骤 | 读数 |
|---|---|
| 服务注册 | `dumpsys package` 里 `.link.LwLinkService` 带 `permission io.github.yuloong07star.luwi.permission.LINK`, action `"io.github.yuloong07star.luwi.link.BIND"` |
| 权限声明 | `Permission [io.github.yuloong07star.luwi.permission.LINK]: prot=signature, INSTALLED` |
| 同签名 bind | 探针 `bindService returned true`, `connected io.github.yuloong07star.luwi/.link.LwLinkService` |
| 同签名权限 | 探针侧 `io.github.yuloong07star.luwi.permission.LINK: granted=true` |
| 异签名权限 | 另一把证书签的 `...linkprobe2` 只列出请求, **没有 `granted=true`**, 即系统没给 |
| `describe` | `{"api":"lw-link/1","scopes":[{"id":"state.read","methods":["snapshot"]}],"pending":["status.read","notify.post","speak.request","widget.attach","prompt.write"]}` |
| `state.read/snapshot` | `{"ok":true,"data":{"app":"2.8.0","code":19,"host":null,"nodeMb":65,"channel":{"connected":null,"backend":null},"accessibility":false,"screens":{"count":0,"displayId":null,"width":null,"height":null,"dpi":null},"storageFreeMb":48060}}` |
| 未知 scope | `{"ok":false,"code":"unknown-scope","because":"this build does not offer that scope"}` |
| 未知方法 | `{"ok":false,"code":"unknown-method","because":"state.read takes snapshot, not openDoor"}` |

那次快照里 `host` / `channel` / `screens` 是 `null` 与 `0`, 因为绑定是探针发起的, Luwi 进程刚被拉起、这些状态还没刷新 —— 这正是把 `null` 与 `false` 分开的理由, 调用方不会把"还没读"读成"没有"。

审计落盘 (`files/dsh-home/lw/link-audit.log`), 放行与拒绝都在:

```
2026-11-10T19:10:57.808+0800 uid=10199 pkg=io.github.yuloong07star.luwi.linkprobe scope=state.read method=snapshot ok=true code=- because=- ms=18
2026-11-10T19:10:57.832+0800 uid=10199 pkg=io.github.yuloong07star.luwi.linkprobe scope=bogus.scope method=snapshot ok=false code=unknown-scope because=this build does not offer that scope ms=0
2026-11-10T19:10:57.834+0800 uid=10199 pkg=io.github.yuloong07star.luwi.linkprobe scope=state.read method=openDoor ok=false code=unknown-method because=state.read takes snapshot, not openDoor ms=0
```

**没验到的两项, 记在这里不装成验过**:

- 异签名应用真的去 bind 时会长什么样 (SecurityException 还是 `bindService` 回 false): 那个探针第二次打包起来就退, 没拿到读数; 上面那条 `granted=true` 的有无只是权限侧的静态证据
- `too-many`: 一分钟 30 次的闸只钉在单测 (`LinkTest.burstIsCappedPerWindow`) 上, 真机没连打 31 次

## 还没做的

- `status.read`: 等 PR #51 (自检与上报) 合并后直接复用 `doctor/Doctor.kt` 的八项读数, 不另写一份
- `notify.post` / `speak.request`: 要在应用里弹出可见的入口, 得先有授权页
- `widget.attach`: 桌面小部件那条路还没定
- `prompt.write`: 最后做, 且只给同签名应用开; 等于"我的另一个应用能替我在 Luwi 里说话"
