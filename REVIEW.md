# REVIEW.md

> 给 ship 前的 reviewer（全新上下文）读的短规范。只讲「在这个仓库里，失败长什么样、证据要什么」。
> 项目背景与构建方式见 `AGENTS.md`；本文件不重复。

## 这个仓库里，失败长什么样

- **host 起不来**：`app/src/main/jniLibs` 缺 `libnode.so`，装机后只有开屏；正确读数是 `dsh web:` 行 + `pidof` 非空。
- **判据绿但 PR 是虚的**：判据脚本没真跑（`checkScripts=未指定`），或验收格里的 `node tools/*.mjs` 被跳过。
- **设备读数缺**：行为类改动没有 `[测试环境] 真机 - <型号> / Android <版本>`，只写「单测通过」。
- **diff 夹带**：顺手改别的模块、整文件格式化、`build/` 或截图进 diff。
- **配置漂移**：插件 pin、`host-plugin/`、`presets/` 被改却没有对应读数。

## 要证据，不要形容词

- 每条结论给 `文件:行`；对不上行就退化成正文。
- 命令 + 返回码 + 关键输出一行；截图/logcat 给路径。
- 读数与改动点对得上：改了声音就贴 `pieces=2`，不是「音频正常」。

## 跳过这些路径

`build/`、`node_modules/`、`third_party/`、`shots/`、`logs/`、`.gradle/`、`*.apk`、`*.so`。

## 上限

- nit ≤5 条；findings 总数 ≤12 条；超出先收敛，不交。
- style / diagnostic / cleanup 一律丢，不进结论。

## summary

以计数开头：`0 个需要修的：…` 或 `N 个：…`。没有要修的就明说，别凑。
