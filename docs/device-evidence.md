# 2.8.0 发版闸 · 真机 9 项读数

> 候选: `agent/sa-950a18dd98b944973866dcadbf56498b`（main 390efc7 + #20/#21/#22 + #24/#25）
> APK: `app-debug.apk` 242,782,336 字节, sha256 `7c9006ffadbbc244471ce9fb3707370d373e677064c1451dd7fd463c0b58857c`
> versionCode 19 / versionName 2.8.0, host stamp `245323f44ad7f1986c30b984fd78aacf`（entries 15883, dsh a2c77c35）
> 设备: OJZD5D6TMNSKFYHM（Redmi 22041216C / Android 14 / HyperOS, 1080x2460）
> 时间: 2026-11-07 00:43 ~ 00:59 CST

## 余额缓存与真实 provider

- [测试环境] 真机 - Redmi 22041216C / Android 14
- 2026-11-07 00:46:58 长按浮标 ->「看余额」-> 屏上 `¥ DeepSeek 余额 ¥102.45 (赠金 ¥0.00) · 刚刚`，截图 `D:\apk\shots\2026-11-07-OJZD5D6TMNSKFYHM-26-balance.png`
- `balance.json`: 手动那一次 `seq 1793983617961`, `networkMs 451`, `seenAfterMs 8`, `writeMs 4`, `provider deepseek-account`, `value 102.45`, `ok true`（真实 provider，不是夹具）；之后一轮对话结束的自动刷新 `seq 0`, `networkMs 419`, `value 101.23`（同一条真实 provider 通路）
- 原始读数 `D:\apk\logs\device\2026-11-07-26-balance.txt`

## 快应用 runtime

- [测试环境] 真机 - Redmi 22041216C / Android 14
- `lw_capabilities`: `quick apps: supported - com.miui.hybrid/.VendorDispatcherActivity answers hap://app/com.example.luwi.probe`
- `lw_quickapp op=probe` -> `route deep_link`, `ready true`, handler `com.miui.hybrid/.VendorDispatcherActivity`
- `lw_quickapp op=open` -> `opened hap://app/com.example.luwi.probe (hap deep link) through com.miui.hybrid/.VendorDispatcherActivity on the phone's own screen. No virtual screen was created.`
- `dumpsys display | grep -c mDisplayId=`：2 -> 2（虚拟屏一条都没建）
- 原始读数 `D:\apk\logs\device\2026-11-07-26-quickapp.txt`

## 日历临近

- [测试环境] 真机 - Redmi 22041216C / Android 14
- 事件 `LuwiGate-26-calendar`（calendar_id 1，事件 _id 14，13 分钟后开始 2026-11-07 01:00）
- 规则 `calendarSoon withinMinutes=20` 命中：`{"rule":"calendar-gate","kind":"calendarSoon","hit":true,"reason":"「LuwiGate-26-calendar」13 分钟后开始 (2026-11-07 01:00)","action":"remind","delivered":true}`
- 收件箱 seq 46 `source:"automation"`
- 原始读数 `D:\apk\logs\device\2026-11-07-26-calendar.txt`

## 通知摘要

- [测试环境] 真机 - Redmi 22041216C / Android 14
- `cmd notification post` 发 LuwiGate 通知后，规则 `noticeDigest withinMinutes=10 minCount=2` 命中：`{"rule":"digest-gate","kind":"noticeDigest","hit":true,"reason":"10 分钟内收到 2 条通知: LuwiGate、LuwiGate","action":"remind","delivered":true}`
- 收件箱 seq 47 `source:"automation"`
- 原始读数 `D:\apk\logs\device\2026-11-07-26-digest.txt`

## 主动对话到点

- [测试环境] 真机 - Redmi 22041216C / Android 14
- 本候选上 `dumpsys alarm` 有 `tag=*walarm*:io.github.yuloong07star.luwi/.tool.ProactiveAlarmReceiver`, `origWhen=2026-11-07 19:30:00.000`（排期已排上）
- 到点实跑读数（同分支 `66d9caa`, 2026-11-06 22:10）：`LwProactive: the proactive schedule fired (22:10)` -> `queued as line #42` -> `proactive conversation session-9ecb8bfb... started ... preset proactive, no virtual screen`；`dumpsys display` 前后都只有 display 0
- 原始读数 `D:\apk\logs\device\2026-11-06-20-proactive.txt`、`D:\apk\logs\device\2026-11-07-26-proactive-alarm.txt`

## 30 分钟拦截

- [测试环境] 真机 - Redmi 22041216C / Android 14
- 拒绝：gate lastAt = 1793982120311（距到点 29:59），`once` 规则 `gate30-block` 到点命中 `{"at":1793983919028,"rule":"gate30-block","kind":"once","hit":true,"blocked":"throttle","reason":"上一条主动投递才 29 分钟, 30 分钟内不开口"}`，gate 账未被覆盖
- 放行：gate lastAt = 1793982308511（距到点 30:01），`once` 规则 `gate30-allow` 到点命中 `{"at":1793984109018,"rule":"gate30-allow","kind":"once","hit":true,"reason":"到点了","action":"remind","delivered":true}`，gate 账改成 `{"at":1793984109018,"source":"automation"}`
- 两次到点与 gate lastAt 的差：拒绝 29:58.7，放行 30:00.5（单调测试钉 29:59 / 30:00 边界）
- 原始读数 `D:\apk\logs\device\2026-11-07-26-gate30.txt`

## Doze / 静默时段

- [测试环境] 真机 - Redmi 22041216C / Android 14
- 默认静默窗口 23:00-07:00（`automations/settings.json` 缺省 `quiet.enabled=true`）；`once` 规则 `gate-quiet`（`quietHours=true`, at 2026-11-07 00:58:05）到点被拦：`{"at":1793984285111,"rule":"gate-quiet","kind":"once","hit":true,"blocked":"quiet","reason":"现在是静默时段 (23:00 - 07:00)"}`，收件箱没有新增
- `dumpsys deviceidle` 读数 `mState=ACTIVE mLightState=ACTIVE mScreenOn=false mCharging=true`
- 原始读数 `D:\apk\logs\device\2026-11-07-26-quiet.txt`

## 探索步数与到时释放

- [测试环境] 真机 - Redmi 22041216C / Android 14
- steps=2 时 `after steps: 1 released` 早于 `used up its budget` 72 ms（账上 releasedAt-createdAt 1.57 s）；finish 后 `after finish: 1 released` 31 ms
- 前后截图 `D:\apk\shots\2026-11-02-OJZD5D6TMNSKFYHM-15-screen-before-finish.png` / `...-after-finish.png`
- 原始读数 `D:\apk\logs\device\2026-11-02-1425-explore-finish.txt`、`D:\apk\logs\device\2026-11-02-1435-finish-release.txt`

## 常见直连动作不创建虚拟屏

- [测试环境] 真机 - Redmi 22041216C / Android 14
- `lw_launch` 设置 -> `launched com.android.settings on displayId 0 "主屏"`, `LaunchState: COLD`, `Status: ok`；`lw_intent openUrl` -> `opened https://example.com`；`lw_intent SET_ALARM` -> `started android.intent.action.SET_ALARM`
- `dumpsys display | grep -c mDisplayId=`：2 -> 2 -> 2 -> 2（一条虚拟屏都没建）
- 截图 `D:\apk\shots\2026-11-07-OJZD5D6TMNSKFYHM-26-native-settings.png`
- 原始读数 `D:\apk\logs\device\2026-11-07-26-native-first.txt`、`D:\apk\logs\device\2026-11-07-26-native-first-retry.txt`
