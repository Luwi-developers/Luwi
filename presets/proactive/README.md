# dsh-preset-proactive（本机版「主动对话」预设）

一场主动对话 = 落在 `Luwi` 工作区的一场**新**会话: 到了主人定的时刻，应用往收件箱投一行 `source:"proactive"`，宿主按 `startProactive` 固定新开一场，开场就用本预设。它读最新探索摘要 / 记忆 / 今天的日历 / 通知摘要，再决定要不要开口；默认只有提醒那一档。

## 用途

- **启动顺序固定**：最新探索摘要（`lw_files` 列 `$DSH_HOME/lw/explore/`）→ 记忆搜索 → 今天的日历（`lw_calendar op=events`）→ 通知摘要（`lw_notifications op=list`）→ 决定要不要开口。
- **默认可沉默**：四样读完没有值得说的就保持沉默，一条话都不写 —— 排期到点不等于必须说话。
- **只提醒**：不可 shell / 不可写文件 / 不可屏幕控制 / 不可 App 控制；需要动手的事只告诉主人，或建议他用自动指令（总闸由主人开）。
- **主动场不建虚拟屏**：屏幕类工具在主动场里由宿主 `proactiveScreenGate` 硬拒，预设本身也不把 `tool-bash` / `tool-fs` 这些写类插件装进来。
- **固定新开**：每一场都是 `controller.create` 出来的新会话，不接浮标那一场，也不改主人正看着的那一场。

## 与「探索模式」（`presets/explore`）的差异

- 探索是"在预算里只读地看清这台手机"，主动对话是"看一眼最近，再决定要不要开口"；两边的配置文件、卡片与宿主账都是分开的（`proactive-schedule.json` / `proactive-card.md` / `proactive.json` 对探索那三份）。
- 主动对话的 plugins 列表**故意比探索短**：没有 `tool-bash` / `tool-pwsh` / `tool-fs` / `tool-jobs` / `tool-web` / 子代理那些行 —— 默认只提醒，用不到它们。`lw_*` 那些工具仍由宿主插件注册，屏幕类那几条被硬闸拒绝。
- 30 分钟最小间隔、静默时段与每日上限归 B4-b；设置页归 B4-c。这一版（B4-a）只保证"排期能起"与"主动场不建虚拟屏"。

## 运行期落位与安装

- 预设声明落在 `<DSH_HOME>/profiles/web/cordis.patch.yml`，行 id `preset-proactive`，`config.id = proactive`，显示名「主动对话」，`order: 8`。
- 那一步由应用自己做（`app/src/main/java/.../host/CustomPresets.kt` 的 `PRESET_ROWS`）：host spawn 之前把本目录 `cordis.patch.yml` 那段 `- insert:` 按行 id 追加进 profile patch；随 host 树走的那一份在 `lw-presets/proactive.patch.yml`，由 `tools/pack-host.mjs` 拷进去。
- 也支持作为 bundle 安装（`dsh.bundle.patch` 已声明）。

## 卸载回滚

把 profile patch 里 `- id: preset-proactive` 所在的 `- insert:` 整段删掉即可。`$DSH_HOME/lw/proactive-schedule.json` 与 `proactive.json` 都是普通文件，删不删不影响预设本身。

## 已知边界

- 提示词层仍是"不可 shell / 不可写文件 / 不可 App 控制"唯一的闸（D9 的口径）；宿主只对屏幕类工具做了硬拒（`lw_screen_*` / `lw_tap` / `lw_swipe` / 截图 / OCR 等）。
- 这一版没有主动对话自己的收尾工具：说完就停，读数只记在 `$DSH_HOME/lw/proactive.json`。

许可：MIT（与 `presets/explore` 同）。
