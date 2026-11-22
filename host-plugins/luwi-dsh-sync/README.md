<div align="center">

# 🔄 luwi-dsh-sync

**DeepSeek Harness 的跨设备同步 —— 会话库的一个专用 git 镜像, 外加一条跨设备对端通道。**

*两台机器各推一份、冲突两边都留、一轮都不会丢; 还能把一句话交给对面那台机器的 agent 去干。*

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![dsh-plugin](https://img.shields.io/badge/dsh--plugin-✅-green)](https://github.com/topics/dsh-plugin)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen.svg)](#)
[![Version](https://img.shields.io/badge/version-0.0.1-blue.svg)](https://github.com/Luwi-developers/luwi-dsh-sync/releases)

[English](README.md) · [简体中文](README-zh.md)

</div>

---

## 这是什么

**Luwi 二开版**的 [`PerryLink/dsh-session-sync`](https://github.com/PerryLink/dsh-session-sync) (Apache-2.0)。
上游那套「把会话库做成一个 git 镜像、两台机器互相推拉」的引擎**一个字节没改地留着**, 这个 fork 在它之上加了三样, 都是为了把它跑在手机 (安卓上的 dsh, 即 [LittleWhale / Luwi](https://github.com/Miuzarte/LittleWhale)) 与电脑之间:

| 加的东西 | 干什么 |
| :-- | :-- |
| **跨设备对端通道** | 一端给另一端的 **agent** 发一句话 (HTTP 直连, 打不通落队列), 并读它正在说的回答。**「让电脑替我干活」靠的是这条**, 不是 git 同步 |
| **投影会话** | 把对方那几场会话折成本地只读的一场 (cwd 写在影子目录里 → 天然进分组); 在那一场里打字 = 把这一句送给**归属方**执行, 本机模型一个字都不跑 |
| **手机侧的沙盒 git** | 手机上的 git 跑不动 (没有 glibc 环境), 于是经一条 loopback 桥进 Linux 沙盒 (proot + Alpine) 执行; 电脑侧照旧走 `ctx.subprocess` |

反向也成立: 电脑上也可以给手机的 agent 派活。

## 装

```bash
dsh plugin --profile <你的 profile> add luwi-dsh-sync
```

**从源码装** (仓库里没有构建步骤, 直接就是运行时文件):

```bash
git clone https://github.com/Luwi-developers/luwi-dsh-sync.git
cd luwi-dsh-sync
npm install            # 只有测试与类型检查要它; 运行时只有 zod 一个依赖
node --test "test/*.test.mjs"
```

`package.json` 的 `main` 就是 `index.mjs`; 挂载行 id 与 `cordis.patch.yml` 里那条都是 `luwi-dsh-sync`。

## 配

配置住在 `$DSH_HOME/lw/session-sync.json` ( **手机侧唯一的配置面**; 电脑侧一般写 profile 覆盖行)。
**改完要重启 host 才生效** —— 插件是在挂载时读这一份的。

```jsonc
{
  "remote": "https://<token>@github.com/<你>/<仓库>.git",  // 两台机器填同一个; 空 = 不同步
  "branch": "main",
  "autoPullOnStart": true,        // 挂载时拉一次
  "autoPushOnTurnEnd": true,      // 每轮对话结束推一次
  "pullIntervalMinutes": 0,       // 周期拉取 (0 = 关)
  "deviceName": "Luwi 手机",       // 对面那个分组上显示成 名字（设备名）
  "peer": { "enabled": true, "listen": true, "proxy": true,
            "token": "<两端同一个, 至少 16 字>", "url": "http://<对端>:3080" },
  "live": { "enabled": true, "maxEntries": 40, "maxChars": 16000, "keepMinutes": 30 },
  // 2026-11-22 终端问答: 电脑上的 ask_user_question 传不传到手机
  //   off = 与以前一样 / notify = 只传过去看得见 / relay = 传过去 + 手机上能答 + 超时自定义回答 / auto = 不问
  "ask": { "mode": "relay", "waitMs": 120000, "brief": true }
}
```

**同步默认关着** (`remote` 为空 = 什么都不跑)。要同步就填一个仓库地址:

- **GitHub 私人仓库可以**: 地址写成 `https://<token>@github.com/<你>/<仓库>.git`, 用只授**这一个仓库** Contents 读写权限的细粒度 token; 别用 SSH (手机沙盒里没有你的 key)。
- **不想上第三方**: 任意一台机器能 `git daemon --base-path=... --enable=receive-pack` 就行, 局域网内也够。

### 拉取是拉模式, 不是推送

这个插件**不会**在对方一有新东西时立刻知道: 拉取只发生在「挂载时 / 每 N 分钟 / 你手动点」这三处。
GitHub 那边没有 webhook 能打到 NAT 后面的手机 —— 想更接近即时就把 `pullIntervalMinutes` 调小, 代价是
每次都起一次 git (手机上是隔着沙盒的)。

## 用

```
/sync status | pull | push | diff | peers        # 会话那一根
/sync ws status|pull|push                        # 工作区那一根
/sync peer state|live|send <一句话>               # 跨设备通道
/sync ask 状态|关|提示|中继|自动                   # 终端问答: 电脑上的问句传不传到手机 (英文 off|notify|relay|auto 也认)
/sync doctor                                      # 只读自检 (peer 解析落点 / ② 层多余包 / git 能不能跑)
```

**终端问答** (2026-11-22): 电脑上的 `ask_user_question` 在手机那一头原本是隐形的 —— 卡片长在 dsh
自己的会话界面上, 手机看的是只有文本的投影, 而且问一句不改会话日志, 手机连"来取快照"的判据都不动。
现在 `relay` 档把它变成快照里的一行 (合成条目, 不进对话账), 手机直接在终端里回 `1` / `2` / 一句话即算
答案; 到 `waitMs` 还没人答, 就按「自定义回答」继续 (模型在正文里写「我替你定了：…」)。手机端不用改。
细节 (四档 / 谁是"手机驱动的那一场" / 为什么接管必须 prepend / 为什么不能改正文) 见
[README-zh.md 那一节](README-zh.md#终端问答手机看得见电脑在问什么2026-11-22)。

模型侧还有 `sync_status` / `sync_pull` / `sync_push` / `sync_doctor` / `sync_peer`。
在官方侧边栏里另有一块「同步」面板 (总览 / 操作 / 诊断), 宿主没有 HTTP 服务时它安静不装。

## 相对上游改了什么

**逐条列在 [UPSTREAM.md](UPSTREAM.md)** (哪一份文件、动了什么、为什么)。要跟上游对齐时照那张表重放。

## 出处与许可

- 上游: [PerryLink/dsh-session-sync](https://github.com/PerryLink/dsh-session-sync) @ `c5f0c929685aafae94749868b07e874035b18ba4` (0.2.24), Apache-2.0
- 本仓: **Luwi 二开**, 版本号从 **0.0.1** 起算 (与上游的 0.2.24 是两条线, 别混)
- 许可证: Apache-2.0, 见 [LICENSE](LICENSE); 第三方依赖与许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

