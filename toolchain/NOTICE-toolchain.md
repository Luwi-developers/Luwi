# 工具链来源与许可 (2.8.1)

这一份讲清楚「安卓开发工具」APK 里那套二进制是从哪来的、谁许可的、怎么复算。
`tools/make-toolchain.ps1` 按这里说的把文件备到仓库根的 `toolchain/`（不进 git），
`devtools` 模块再把它们当 assets 打进 APK。

## 名单

| 件 | 来源 | 许可 | 备注 |
| :-- | :-- | :-- | :-- |
| `jdk/` | Termux `openjdk-21`（`packages.termux.dev`，aarch64；`21.0.13-2`） | GPL-2.0 + Classpath Exception | 只随独立 APK 发，**不合进 Luwi 源码与主包** |
| `build-tools/aapt2` | Termux `aapt2`（`packages.termux.dev`，aarch64；`16.0.0.4-4`） | Apache-2.0 | 与 `d8` 同一版本线最好 |
| `build-tools/lib/d8.jar` | 本机 `Sdk/build-tools/<ver>/lib/d8.jar` | Apache-2.0 | 纯 Java，跑在 JDK 上 |
| `build-tools/lib/apksigner.jar` | 本机 `Sdk/build-tools/<ver>/lib/apksigner.jar` | Apache-2.0 | 纯 Java |
| `sdk/android.jar` | 本机 `Sdk/platforms/android-<ver>/android.jar` | Apache-2.0 | javac 的 bootclasspath |

来源 URL（2026-11-17 实测可达，索引 `…/dists/stable/main/binary-aarch64/Packages`）：

```text
https://packages.termux.dev/apt/termux-main/pool/main/o/openjdk-21/openjdk-21_21.0.13-2_aarch64.deb
https://packages.termux.dev/apt/termux-main/pool/main/a/aapt2/aapt2_16.0.0.4-4_aarch64.deb
```

`zipalign` **不在名单里**：侧载不要求 4 字节对齐，质量由 `aapt2 dump badging` 与 `apksigner verify` 兜
（2.8.1 的拍板，见 `docs/Luwi-2.8.x/20-手机应用工坊.md`）。

## 复算

```powershell
pwsh -File D:\apk\Luwi\tools\make-toolchain.ps1 `
  -JdkArchive D:\downloads\openjdk-android-aarch64.tar.xz `
  -Aapt2 D:\downloads\aapt2 `
  -BuildTools 37.0.0
```

脚本会写 `toolchain/toolchain.json`：

```json
{ "v": 1, "version": "lwforge-jdk21-bt37", "abi": "arm64-v8a", "files": [ { "path": "jdk/bin/java", "sha256": "…", "bytes": 123 } ] }
```

`安卓开发工具` 的 `ToolchainService.stage()` 与 Luwi 特权侧的 `LwForgeExec.stage()` 都按这份清单逐文件复核
sha256；换任何一件都要重新生成它，否则构建会被一句「sha256 对不上」挡住（这是有意的）。

## 为什么单独一件 APK

主 APK 不该为所有人背着 100 MB 级的 JDK：不用工坊的人一个字节都用不上它。这一件是「自行下载」的那一半，
装不装由人在系统安装器那一页点的那一下定。
