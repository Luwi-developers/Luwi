# 设备读数证据: 2.8.0 缺项夹具

> 这份夹具故意缺读数, 用来验 tools/check-device-evidence.mjs 的拦下那一侧
> 期望: 退出 3, 点名 #32 侧边栏终端 / #33 浮标语音开关 / #35 通知栏

## #32 侧边栏终端

- 改动: app/src/main/java/io/github/yuloong07star/luwi/ui/TerminalScreen.kt
- 截图: shots/2026-11-04-OJZD5D6TMNSKFYHM-32-terminal.png

## #33 浮标语音开关

- 改动: app/src/main/java/io/github/yuloong07star/luwi/overlay/LwOverlay.kt
- [测试环境] 已测真机
- 截图: shots/2026-11-04-OJZD5D6TMNSKFYHM-33-tap.png

## #34 提交前置闸 (这一项是齐的)

- 改动: tools/check-device-evidence.mjs
- [测试环境] 无需设备 - 逻辑簇
- 判据: node tools/check-device-evidence.mjs --self-test 8/8
- 单测: 727 通过

## #35 通知栏

- 改动: app/src/main/java/io/github/yuloong07star/luwi/overlay/NotifyLine.kt
- [测试环境] 无需设备 - 逻辑簇
- 判据: check-auto-shot.mjs 12/12
- 单测: 700 通过
