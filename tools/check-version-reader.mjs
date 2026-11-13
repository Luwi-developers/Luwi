/**
 * `tools/lib/version.mjs` 自己的判据 (为什么值得单独有这一份)
 *
 * 那一个文件是**唯一**读 `versionName` / `versionCode` 的地方, 四个调用方 (发版闸 / 插件判据 /
 * 随包外观判据 / 落实代码开工闸) 全靠它。它最要紧的行为不是"读对正常文件"—— 那一眼就能看出来 —
 * 而是**遇到第二个 `versionName` 时拒读**: 从前四条正则各取第一个, 谁都不报错, 于是发版闸按 2.8.0
 * 放行、落实代码按 2.8.0-a 拦下, 两边都显示 green
 *
 * 夹具全部内联 (`--file` 那条路只给人工排查用), 因此这个脚本不依赖 .lwtmp 也不改任何文件
 *
 * 跑法: node tools/check-version-reader.mjs
 */

import { readGradleVersions, tryReadGradleVersions } from './lib/version.mjs'

let failures = 0
let checks = 0
function check(name, got, want) {
  checks += 1
  const same = JSON.stringify(got) === JSON.stringify(want)
  if (!same) failures += 1
  console.log(
    `${same ? 'ok  ' : 'FAIL'} ${name}`
      + (same ? '' : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`),
  )
}

/** 正常的 defaultConfig 块 (与真文件同形, 只留这道闸关心的两行) */
const NORMAL = [
  'android {',
  '    defaultConfig {',
  '        versionCode = 19',
  '        versionName = "2.8.0"',
  '    }',
  '}',
].join('\n')

const version = readGradleVersions(NORMAL)
check('正常文件读得出 versionName', version.versionName, '2.8.0')
check('正常文件读得出 versionCode (是数字, 不是字符串)', version.versionCode, 19)
check('行号指到那一条赋值', [version.codeLine, version.line], [3, 4])

/* ── 拒读的三种形态 ─────────────────────────────────────────────────────── */

const singleLineFlavor = [
  'android {',
  '    defaultConfig {',
  '        versionCode = 19',
  '        versionName = "2.8.0"',
  '    }',
  '    flavorA { versionName = "2.8.0-a" }',
  '}',
].join('\n')
const dupFlavor = tryReadGradleVersions(singleLineFlavor)
check('单行块里的第二个 versionName 也算一处 (不许静默取第一个)', dupFlavor.ok, false)
check('拒读时点名两处行号', /第 4 行/.test(dupFlavor.error) && /第 6 行/.test(dupFlavor.error), true)
check('拒读时不回一个猜出来的版本号', dupFlavor.versionName, null)

const twoCodes = [
  'android {',
  '    defaultConfig {',
  '        versionCode = 19',
  '        versionCode = 20',
  '        versionName = "2.8.0"',
  '    }',
  '}',
].join('\n')
check('versionCode 出现两处也拒', tryReadGradleVersions(twoCodes).ok, false)

const commentOnly = [
  'android {',
  '    // versionName = "9.9.9"',
  '    versionCode = 1',
  '}',
].join('\n')
check('注释里的赋值不算数', tryReadGradleVersions(commentOnly).ok, false)

/* ── 别人的同名属性不许冒充 ─────────────────────────────────────────────── */

const foreign = [
  'android {',
  '    defaultConfig {',
  '        versionCode = 19',
  '        versionName = "2.8.0"',
  '    }',
  '    it.versionName = "not-ours"',
  '    config.versionCode = 99',
  '    // versionCode = 98',
  '}',
].join('\n')
const ours = readGradleVersions(foreign)
check('点号后面那个同名属性不算本包的版本', [ours.versionName, ours.versionCode], ['2.8.0', 19])

console.log('')
console.log(`${checks - failures}/${checks} 条过`)
process.exit(failures === 0 ? 0 : 1)
