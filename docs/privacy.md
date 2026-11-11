# 隐私说明

一句话：**Luwi 不收集、不上传任何用户数据。** 包里没有统计 SDK、没有崩溃上报、没有安装编号、没有广告 ID。会出网的只有下面这张表里的几件事，而且每一件都由你自己触发，或者你可以在设置里关掉。

## 一、明确不做的

| 不做 | 说明 |
|---|---|
| 不做统计 | 没有埋点、没有会话数上报、没有「用了哪些功能」的计数出网 |
| 不做崩溃上报 | 崩溃只写本机日志，不外发 |
| 不生成设备标识 | 没有 IMEI / ANDROID_ID / 广告 ID / 自造安装编号的采集与上传 |
| 不读你的内容去上传 | 截图、屏幕内容、聊天记录、输入法输入、联系人、文件、相册，都不上传 |
| 不上传账号与密钥 | 你的 API Key 只存在本机 `files/dsh-home/.credentials.yaml`，请求直接发给你填的那个模型服务商 |

「自检」读到的八项（版本、机型/系统、通道、无障碍、虚拟屏、存储）**只在本机显示**；只有你在对话框里点「匿名上报」，才会把那份报告发出去一次。

## 二、出站清单

这是全部。`grep -rn 'https://' app/src/main` 的结果就是它，没有第二份。

| 域名 | 什么时候访问 | 传过去什么 | 怎么关掉 |
|---|---|---|---|
| `api.github.com` | 检查更新、拉技能索引、反馈里选「公开到仓库」时开 issue | 只是一个 GET；开 issue 时带你在对话框里写的内容 | 不检查更新、不点反馈 |
| `luwi.dpdns.org` | 官网登录、酒馆签到、朗读取临时令牌（`/api/edge-token`）、反馈投递（`/feedback`） | 登录令牌 / 朗读的那段文字 / 反馈正文 | 不登录、不用「朗读」、不点反馈 |
| `hf-mirror.com`、`huggingface.co` | 下载语音识别与唤醒词模型 | GET 文件，不带任何标识 | 不下载模型（不使用语音） |
| `api.open-meteo.com`、`geocoding-api.open-meteo.com` | 自动化的「天气」条件 | 城市名或经纬度 | 不做带天气条件的排期 |
| `api.openai.com` | **只有**你自己在设置里填了 OpenAI 的 key，并用它来对话或朗读 | 你的请求正文 | 不填 OpenAI key（DeepSeek 走你自己的 key，直连服务商） |
| `fastly.jsdelivr.net`、`cdn.jsdelivr.net`、`gcore.jsdelivr.net`、`ghfast.top` | 插件索引、应用技能索引、语音模型 release 的镜像 | GET 文件 | 不装插件 / 不下载 |
| `mirrors.aliyun.com` | 内置 Alpine 根文件系统（`lw_linux` 沙盒） | GET 文件 | 不用终端沙盒 |
| `127.0.0.1` | 本机的 dsh 宿主与界面之间的通信 | 不出设备 | — |

三个容易误认的字符串，**不是请求**：

- `www.w3.org` —— SSML 的 XML 命名空间常量（`app/src/main/java/io/github/yuloong07star/luwi/tool/LwEdgeSpeech.kt`）
- `hapjs.org`、`doc.quickapp.cn` —— 快应用的 deeplink 前缀与注释（`channel/QuickAppCapability.kt`）
- `example.com`、`lw.local` —— 示例地址与本地域名（`channel/PrivilegedBridge.kt`、`plugin/PluginBoundaries.kt`）

## 三、权限

`app/src/main/AndroidManifest.xml` 里一共 **62 条**。它们不是开箱就在用，而是「快捷指令能覆盖到哪儿」的边界——哪条你没授，对应的指令就会直接失败并说清原因，不会静默降级。

| 组 | 干什么用 | 谁会用到 |
|---|---|---|
| 无障碍（服务，不是普通权限） | 读控件树、按名字点、读文字 | 所有「帮我点一下 / 看看屏幕上有什么」 |
| 短信、通话记录、联系人、日历 | 查短信、发短信、打电话、看日历 | 你明确要求时，或你建的排期 |
| 位置、相机、麦克风、前台服务 | 定位、拍照、录音、后台常驻 | 同上 |
| 存储、`QUERY_ALL_PACKAGES`、`MANAGE_EXTERNAL_STORAGE` | 读文件、列出已装应用、终端沙盒读写 | 文件类指令、终端、外部工具 |
| 网络与 Wi-Fi 状态 | 上面那张出站表 | — |
| `WRITE_SECURE_SETTINGS` 等系统级 | **只能**通过 Shizuku / root 通道，应用本身拿不到 | 改系统开关（需要你自己装 Shizuku 并授权） |

在系统设置里随时可以收回任意一条；收回后对应能力会报错，不影响其他能力。

## 四、数据存在哪儿

全部在应用私有目录，别的应用读不到：

```
/data/data/io.github.yuloong07star.luwi/
├── files/dsh-home/     会话、记忆库、人格与预设、插件、技能、模型、你的 API Key
├── files/host/         宿主（Node + dsh）本体
└── shared_prefs/       设置项
```

- 没有云同步。会话不上传，除非你自己把某段对话复制出去。
- **卸载即全部删除**。注意：GitHub 上发布的是 debug 签名包，换签名（比如自己重新编译）必须卸载重装，数据会一起没了。
- 「局域网访问」如果打开，只在你自己的 Wi-Fi 内、由你手动开、带一次性令牌；关掉就断。

## 五、你可以自己验

```bash
# 1. 出站清单是不是这一份
grep -rn 'https://' app/src/main

# 2. 包里有没有第三方统计 SDK
grep -rniE 'firebase|bugly|umeng|sentry|appsflyer|adjust|mixpanel|amplitude' app/build.gradle.kts

# 3. 跑起来以后，这个 uid 到底往外发了多少
adb shell dumpsys netstats detail | grep -A2 'io.github.yuloong07star.luwi'

# 4. 签名与可调试位
apksigner verify --print-certs app-debug.apk
aapt2 dump badging app-debug.apk | grep -i debuggable
```

发现和本文不符的地方，直接开 issue 说一声，我们按实际情况改这份文档——**以代码为准，不以说法为准**。

## 变更记录

| 日期 | 改动 |
|---|---|
| 2026-11-12 | 首版：出站清单、权限分组、本机数据位置、自证方法 |
