# 设备读数证据: 2.8.0 齐全夹具

> 这份夹具四档各一项, 每项都有实测结果, 用来验 tools/check-device-evidence.mjs 的放行那一侧
> 期望: 退出 0, 报读数 7 条

## #32 侧边栏终端

- 改动: app/src/main/java/io/github/yuloong07star/luwi/ui/TerminalScreen.kt
- [测试环境] 真机 - Redmi 22041216C / Android 14
- 截图: shots/2026-11-04-OJZD5D6TMNSKFYHM-32-terminal.png
- logcat: logs/device/2026-11-04-32-terminal.txt

## #33 浮标语音开关

- 改动: app/src/main/java/io/github/yuloong07star/luwi/overlay/LwOverlay.kt
- [测试环境] 模拟器 - Luwi_API36 / Android 16
- 画面: shots/2026-11-04-emulator-5554-33-tap.png
- logcat 关键行: I/LwOverlay: voice input is on

## #30 提交前置闸

- 改动: tools/check-device-evidence.mjs
- 改动: tools/lw-release-check.ps1
- [测试环境] 无需设备 - 逻辑簇
- 判据: node tools/check-device-evidence.mjs --self-test 8/8
- 单测: :app:testDebugUnitTest 727 通过 / 0 失败

## #19 快应用

- 改动: app/src/main/java/io/github/yuloong07star/luwi/channel/QuickAppCapability.kt
- [测试环境] 真机 - Redmi 22041216C / Android 14（缺 MIUI 快应用：handler 未装）
- 判据: check-phone-actions.mjs 24/24
