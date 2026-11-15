# 端侧 OCR: 按场景分档校准的多信号路由 (2.8.1 #3)

> 落点: `app/src/main/java/.../channel/OcrRoute.kt` (新) + `LwOcr.kt` + `OcrBoxes.kt` + `PrivilegedBridge.kt`
> 判据: `app/src/test/java/.../channel/OcrRouteTest.kt` (7 条) + `tools/check-ocr-routing.mjs`
> 一句话: 一行 OCR 结果留不留, 不再由一根全局 `score < 0.35` 说了算; 先认这一屏是密集小字 / 常规 /
> 大字, 再按那一档拟合出来的门槛看分数、字数、形状与同列邻居. 旧阈值那条路整条留着, 一次请求就能退回去

## 1. 为什么要换

2.8.0 的判据是逐行的四连: 近方小低分框当图标丢掉 -> 只有符号的丢掉 -> `score < 0.35` 丢掉 -> 单字
`< 0.75` 丢掉. 那条 0.35 是全局的, 而一屏字的分数本来是**整片移动**的:

- 深色主题的正文与值会整体掉到 0.27~0.36, 一刀切下去就是"夜里整列字没了" (代码里那条
  "抬分数线会先误杀夜里的灰字"记的就是这件事)
- 反过来, 游戏 HUD 的 40sp 大字分数天生 0.85 以上, 0.35 那条线对它形同虚设, 而两字招牌 (LV / MP)
  同样 0.55~0.60, 一起留在答案里

抬线丢字, 不抬混垃圾. 根因是"拿一个数去判一件有多种证据的事".

## 2. 换成了什么

三步, 全部是纯函数 (不碰模型, 不碰设备, 所以能拿固定样本在 JVM 上真跑):

1. **认场景**: 取这一帧**中位行高 / 屏长边**. 12sp 的小字约 0.015, 16~20sp 的正文 0.018~0.022,
   24sp 以上的大字 0.03 起. 阈值 `DENSE_UP_TO = 0.017` / `LARGE_FROM = 0.030`, 三档 dense / normal / large.
   用中位数而不是平均数: 一屏里一两行大标题会把平均数拽走, 拽不走中位数
2. **多信号判一行**: 分数之外还看
   - 字数 (图标只有一两个字, 四个字以上的框不可能是图标)
   - 形状 (近方 + 相对屏很小 = 图标; 宽扁 = 文字)
   - 同列邻居 (左边缘对齐 + 行高相近的行有几条)
3. **分档校准**: 每档四个门槛 (tau / single / icon / rescue) 由 `OcrRoute.calibrate` 在三档固定样本上
   网格拟合, 取的目标是**误丢记两分**的那份账 (漏一行真字 = 模型读不到那颗按钮; 多留一行 = 噪音),
   并列时取更严格的那一组. `OcrRouteTest` 每次重拟合并断言与 `OcrRoute.TABLE` 一致

fit 出来的表 (`OcrRoute.TABLE`):

| 档 | tau | single | icon | rescue |
| :-- | :-- | :-- | :-- | :-- |
| dense | 0.66 | 0.90 | 0.85 | 0.26 |
| normal | 0.68 | 0.90 | 0.85 | 0.30 |
| large | 0.66 | 0.90 | 0.85 | 0.62 |

`rescue` 是"分数在 tau 之下还能捞回来"的下限, 条件是: 字数 >= 3 + 同列邻居 >= 2 + 行高在同屏中位数
的 0.7~1.6 倍之内. 深色设置页那一列 0.27~0.33 的值就是这么留下的, 而孤零零一个 0.55 的两字招牌捞不回来.

## 3. 实测读数 (JVM, 固定样本真跑)

样本: `app/src/test/resources/ocr-route/` 5 帧 86 行, 三档各至少一帧

| 帧 | 档 | 行数 |
| :-- | :-- | :-- |
| dense-settings-light | dense | 20 |
| dense-settings-dark | dense | 17 |
| normal-chat | normal | 17 |
| normal-files | normal | 18 |
| large-game | large | 14 |

命中率 (`OcrRouteTest`, `:app:testDebugUnitTest` 真跑):

```
[ocr-route] tier=dense rows=37 calibrated=1.000 legacy=0.784 falseDrop=0 legacyFalseDrop=6 falseKeep=0 legacyFalseKeep=2
[ocr-route] tier=normal rows=35 calibrated=1.000 legacy=0.886 falseDrop=0 legacyFalseDrop=3 falseKeep=0 legacyFalseKeep=1
[ocr-route] tier=large rows=14 calibrated=1.000 legacy=0.929 falseDrop=0 legacyFalseDrop=0 falseKeep=0 legacyFalseKeep=1
[ocr-route] overall rows=86 calibrated=1.000 legacy=0.849
```

P95 延迟 (`OcrRouteTest` 的 `多信号判一帧的 P95 延迟`, 每档 200 次预热 + 2000 轮 x 5 帧):

```
[ocr-route] p95 legacy=1200ns calibrated=4000ns per frame
```

这一层是纯判定的代价, 不是模型推理: 一次 `lw_ocr` 的 det + rec 实测在 100~300ms 量级, 路由占其中
0.001%~0.004%, 所以"分档路由会不会变慢"这件事的答案是"量不出来". 多次运行的抖动区间: legacy
1.2~2.8us, calibrated 4.0~5.3us (JIT 与机器负载, 与算法无关; 全量跑那一趟是 `legacy=2800ns
calibrated=4900ns`).

样本来源要说清: **不是真机录屏**, 是照 2.8.0 已经落纸的真实读数重构出来的三类失败样本 —— 深色灰字
0.27~0.36, 两字招牌 0.52~0.58, 图标 0.55~0.72 (见 `OcrBoxes` 的注释与 `OcrRouteTest` 的逐行断言).
1.000 说明门槛落在了把这三类分开的区间里, 不等于真机命中率是 100%.

## 4. 回退开关 (不必重装 APK)

- 桥上一次请求带 `route=legacy` 或带 `minScore=<数>` -> `LwOcr.recognize(..., OcrRoute.Mode.LEGACY)`,
  判据链与 2.8.0 逐行一致 (图标 / 只有符号 / `score < minScore` / 单字)
- 插件 `lw_ocr` 的 `route` 参数就是这个开关, `calibrated` 是缺省
- 桥的答案里新增 `scene` 与 `route` 两个字段, 插件那行 `..., dense tier on the calibrated filter` 就是
  这两个字段的可读形态 —— 真机读数一眼看得出走的是哪条路

## 5. 待编排侧读数 (工位不做)

- 真机各跑一次 `lw_ocr`: 设置页 (深色) / 聊天列表 / 游戏 HUD, 看答案里的 `tier` 与行数是否符合
  dense / normal / large, 以及深色那屏右列的值有没有被丢掉
- 同机跑一次 `lw_ocr` 带 `route=legacy` 对照, 确认回退路径真的回到 2.8.0 的行为
- 真机 P95 不在工位量: 路由这一层的代价已在 JVM 上量过, 真机的读屏总耗时由 OCR 推理主导

## 6. 风险与没有做的事

- tau 抬到 0.66~0.68 的代价是**不成列的低分正文**会被丢 (单句提示、居中的暗色说明). 救回只覆盖成列
  的行, 这是有意的取舍: 宁可少留一行噪音, 也别让一整列标签在深色主题下消失; 真机若发现误丢, 先
  `route=legacy` 退回, 再补样本重拟合
- 没有做: 第二识别器 / 云端复核 (2.8.1 #2 已把出网边界钉在本地), 也没有给阈值加设置页 UI —— 分档表
  是拟合出来的, 给用户一个滑杆只会让人手动破坏校准
- 没有动: `OcrDetect` 的检测阈值与 `OcrBoxes.dedupe` 的去重口径
