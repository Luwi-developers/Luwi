# dsh-preset-proactive（本机版「主动对话」预设）

一场主动对话 = 落在 `Luwi` 工作区的一场**新**会话: 到了主人定的时刻，应用往收件箱投一行 `source:"proactive"`，宿主按 `startProactive` 固定新开一场，开场就用本预设。它读最新探索摘要 / 记忆 / 今天的日历 / 通知摘要，再决定要不要开口；缺省只有提醒那一档。

## 用途

- **启动顺序固定**：最新探索摘要（`lw_files` 列 `$DSH_HOME/lw/explore/`）→ 记忆搜索 → 今天的日历（`lw_calendar op=events`）→ 通知摘要（`lw_notifications op=list`）→ 决定要不要开口。
- **默认可沉默**：四样读完没有值得说的就保持沉默，一条话都不写 —— 排期到点不等于必须说话。
- **能做什么是三档，缺省只提醒**（2026-11-10，方案 `docs/Luwi-主动场硬闸与解闸开关-方案-2026-11-10.md`）：设置 → 活动 → 主动对话 里三选一，落 `$DSH_HOME/lw/sim.json` 的 `proactive.acting`：

  | 档 | 能做什么 |
  | :-- | :-- |
  | `remind`（缺省） | 只读 + 说话：不可 shell / 不可写文件 / 不可屏幕控制 / 不可 App 控制，主动场不建虚拟屏 |
  | `act` | 写文件 / 开应用 / 跑命令；**屏永远不碰** |
  | `full` | 连建虚拟屏、截图、点、滑一起放开（设置页选它要过一道确认） |

- **闸是硬的，在宿主那一侧**：`host-plugin` 的 `proactiveGate` 按三张表（A 屏 / B 写动 / C 命令）与档位判，缺省全拒；预设本身也不把 `tool-bash` / `tool-fs` 这些写类插件装进来。`full` 档之前"主动场不建虚拟屏"只是在 `remind` / `act` 两档成立。
- **发言只走 `lw_say`**：一次调用落一份 jsonl，门户与球显示同一句；`lw_overlay` / `lw_sticker` / `lw_speak` 是宿主内部的底层通道，提示词里明确不让她直接调（2026-11-10 改口径 —— 这一份原来教的是 `lw_overlay op=burst`，那是 `lw_say` 立起来之前的写法）。
- **固定新开**：每一场都是 `controller.create` 出来的新会话，不接浮标那一场，也不改主人正看着的那一场。

## 与「探索模式」（`presets/explore`）的差异

- 探索是"在预算里只读地看清这台手机"，主动对话是"看一眼最近，再决定要不要开口"；两边的配置文件、卡片与宿主账都是分开的（`proactive-schedule.json` / `proactive-card.md` / `proactive.json` 对探索那三份）。
- 主动对话的 plugins 列表**故意比探索短**：没有 `tool-bash` / `tool-pwsh` / `tool-fs` / `tool-jobs` / `tool-web` / 子代理那些行 —— 三档都靠 `lw_*` 那套工具（`lw_files` 写、`lw_linux` 跑命令、`lw_launch` 开应用），屏幕类那几条由硬闸按档位放行。
- 30 分钟最小间隔（与自动指令共用同一笔账，手动「立刻跑一次」不计）与静默时段由 B4-b 接上；每日总次数上限那一版已取消（B4-b）。设置页归 B4-c。

## 运行期落位与安装

- 预设声明落在 `<DSH_HOME>/profiles/web/cordis.patch.yml`，行 id `preset-proactive`，`config.id = proactive`，显示名「主动对话」，`order: 8`。
- 那一步由应用自己做（`app/src/main/java/.../host/CustomPresets.kt` 的 `PRESET_ROWS`）：host spawn 之前把本目录 `cordis.patch.yml` 那段 `- insert:` 按行 id 追加进 profile patch；随 host 树走的那一份在 `lw-presets/proactive.patch.yml`，由 `tools/pack-host.mjs` 拷进去。
- 也支持作为 bundle 安装（`dsh.bundle.patch` 已声明）。

## 卸载回滚

把 profile patch 里 `- id: preset-proactive` 所在的 `- insert:` 整段删掉即可。`$DSH_HOME/lw/proactive-schedule.json` 与 `proactive.json` 都是普通文件，删不删不影响预设本身。

## 已知边界

- **三张表就是全部的闸**：A 屏 / B 写动 / C 命令之外的工具（读摘要、说话、看通知、拍照）三档都放行；表里没有的工具等于不受限，所以**新加的"会动设备"的工具必须补表**（`Luwi/AGENTS.md` 的「别做的事」里那一条）。
- `full` 档放行的每一次都往 `$DSH_HOME/lw/proactive-act.jsonl` 记一行（时刻 / 档位 / 工具名 / 参数摘要），出问题先看这一份。
- 档位读的是 `sim.json`，带 3 s + mtime 缓存：改完 ≤3 s 生效，不需要重启 host（`SimSetting` 下一次整份写会把旧布尔 `allowActing` 正式换成 `acting`）。
- 这一版没有主动对话自己的收尾工具：说完就停，读数只记在 `$DSH_HOME/lw/proactive.json`。

许可：MIT（与 `presets/explore` 同）。
