# 2.8.1 发版闸 · 真机读数（2026-11-22）

> 候选: `main` = `47ed344`（含 #37 PR #153）
> 包: `:app:assembleRelease` 出的 `app-release.apk`，重签后冻结成 `archive\releases\Luwi-2.8.1-frozen-20261122.apk`
> versionCode 21 / versionName 2.8.1
> 设备: OJZD5D6TMNSKFYHM（Redmi 22041216C / Android 14 / HyperOS, 1080x2460）
> 时间: 2026-11-22 23:16 ~ 23:46 CST

## 整包装机与 host

- [测试环境] 真机 - Redmi 22041216C / Android 14
- 23:40 `lw-install.ps1` 装上 vc21 / 2.8.1 的包，logcat: `DshHost : dsh web: http://127.0.0.1:3080/?token=…` 就绪；无障碍 listed + bound；`acceptance: accessibility is listed and bound, notification access is listed`
- 判据 check-phone-actions 70/70、check-explore 246/246、单测 1046 个用例通过

## #37 lw_tap 锚点核对

- [测试环境] 真机 - Redmi 22041216C / Android 14
- 23:44 logcat: `LwTap: anchor=mismatch on displayId 0 at 895,1213 for "WLAN"`（found=`已开启`，0 次触摸）
- 23:44 logcat: `LwTap: anchor=confirmed on displayId 0 at 895,1213 for "蓝牙"`（设置页「蓝牙」行：文字框 94x64、命中区 1014x154）
- 判据 check-phone-actions 70/70、check-explore 246/246
- 缺项: `effect=unchanged` / `reason=effect-missing` 这段要注入触摸，这台没有 root 也没有 Shizuku → 待有特权通道的机器复验（判据侧已用假通道覆盖）

## 图标切换（#146 / #147 / #150）

- [测试环境] 真机 - Redmi 22041216C / Android 14
- 15:00 读数：`icon.json=builtin` 冷启后桌面第二页第 4 位变鲸尾，状态栏与通知卡片仍是女仆；`icon.json=maid` 冷启后两处都是女仆
- 判据 check-icon-sets 98/98、单测 IconSetTest 通过（1046 个用例之一）

## 终端页 3 秒门槛与问答中继（#151 / #152）

- [测试环境] 真机 - Redmi 22041216C / Android 14
- 20:23（飞行模式 + 撤 `adb reverse` 完全断网）logcat: 进终端后 1.39 / 2.57 / 3.65 s 三帧都没有卡，4.72 s 那帧才见「电脑没连上」
- 23:01（PC 重启 host 后插件 0.4.7）：会话 `免审批问答工具测试` 出现 `seq=19` 的中继提示，手机回答后同场多出 `seq=19.5`「已按你在手机上的回答继续」，随后 agent 续话；`/sync doctor` 报 `问答: relay · 等 120s · 此刻在等 0`
- 判据 check-terminal 与 check-luwi-portal 全绿

## 语音、账号与通知（#1 ~ #16 那一批）

- [测试环境] 真机 - Redmi 22041216C / Android 14
- 23:40 装机后 hostReady、通知使用权 listed；历史 accept 读数：DeepSeek ASR/TTS 真跑 401/200 分档、logcat `LwSpeak: filler` 一行、`lw-say` 通知一条
- 判据 check-speech-tail 16/16、check-voice-asr 24/24、check-lw-out 172/172

## 签名（2.8.1 彻底换签名，走 v3 lineage）

- [测试环境] 无需设备 - 逻辑簇
- 改动: tools/lw-release-check.ps1, docs/device-evidence-2.8.1.md
- 判据 5/5（文件名 / 验签 / 证书 / 升级链 / 可调试 全 PASS）
- 单测 1046 个用例通过
- `apksigner verify`: V3.0 Signer `CN=Luwi Release, OU=Luwi, O=Luwi, C=CN`，SHA-256 `550c0499…6d77b`
- `apksigner lineage`: Signer #1 `CN=Android Debug` → Signer #2 `CN=Luwi Release`（2.8.0 可覆盖升级）

## 覆盖安装（换签名后仍能升级，数据不丢）

- [测试环境] 真机 - Redmi 22041216C / Android 14
- 07:08 db install -r -t archive\releases\Luwi-2.8.1-frozen-20261122.apk -> `Success`（旧包装的是 CN=Android Debug 签的 2.8.1）
- logcat: `dsh web: http://127.0.0.1:3080/?token=…` 就绪；`dumpsys package` 读到 `signatures=[aa37e9a6] version:3 past signatures:[39dcef1f, aa37e9a6]` —— 系统认下 lineage
- 数据：历史对话窗仍列着「当前 · Luwi / 相册最近三张时间核对计划 / 重新发送通知 / 死里控体验分享 / He give it there」等 8 场，截图 `shots/2026-11-23-OJZD5D6TMNSKFYHM-2.8.1-frozen-install.png`
