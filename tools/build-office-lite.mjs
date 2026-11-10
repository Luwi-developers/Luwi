/**
 * 把那一包打一份**球上的预览窗**能直接装的 lite bundle (2026-11-10)
 *
 * 为什么要第二份产物: dsh 树里那份 `presets/docx-preview/lib/client.js` 是
 * `window.__ModuleLoader__.load({...})` 的形状 (要 dsh 的模块表, 还要 `require('react')`), 而球上
 * 那张预览窗是一个**裸 WebView** —— 没有模块表, 也没有 React。它要的只是那一个函数:
 * `window.__LW_OFFICE__.renderOffice(bytes, name) -> { style, body }`
 *
 * 所以这一份:
 *
 * - 形状是 IIFE (顶层直接执行, 没有 `export`, 也没有 loader)
 * - `react` 换成 `src/react-shim.js` (组件那几段打得进去但不执行)
 * - 产物进 `app/src/main/assets/web/lw-office.js` (随包, 球那张窗内联引用)
 *
 * **两份产物必须同源**: 都从 `presets/docx-preview/src/index.js` 打, 改渲染行为只改 src;
 * `tools/check-lw-out.mjs` 钉着"lite 产物里带着 renderOffice"与"src 只有一份"
 *
 * 用法: node tools/build-office-lite.mjs [--install]
 */

import { createRequire } from 'node:module'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = fileURLToPath(new URL('../', import.meta.url))
const packageDir = join(root, 'presets', 'docx-preview')
const deps = join(packageDir, '.deps')
const entry = join(packageDir, 'src', 'index.js')
const shim = join(packageDir, 'src', 'react-shim.js')
const out = join(root, 'app', 'src', 'main', 'assets', 'web', 'lw-office.js')

const requireFromDeps = createRequire(join(deps, 'noop.cjs'))

if (process.argv.includes('--install') || !existsSync(join(deps, 'node_modules', 'esbuild'))) {
  console.log('office-lite: 先装一次构建依赖 (esbuild 与它那几个包)')
  mkdirSync(deps, { recursive: true })
  execFileSync('npm', [
      'install', '--prefix', deps, '--no-audit', '--no-fund', '--no-save',
      'docx-preview@0.4.1', 'dompurify@3.2.6', 'jszip@3.10.1', 'esbuild@0.28.2',
    ], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
}

const esbuild = requireFromDeps('esbuild')

const result = await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome88'],
  minify: true,
  legalComments: 'none',
  // react 换成空影子 (组件那几段打得进去但不执行); 其余全打进来
  alias: { react: shim },
  // 依赖装在 `.deps/` 里, 不在 src 的解析链上 —— 与 tools/build-docx-preview.mjs 同一个写法
  nodePaths: [join(deps, 'node_modules')],
  define: { 'process.env.NODE_ENV': '"production"' },
  outfile: out,
  metafile: true,
})

const bytes = statSync(out).size
console.log(`office-lite: ${out}`)
console.log(`office-lite: ${(bytes / 1024).toFixed(0)} KB (${Object.keys(result.metafile.inputs).length} 个输入)`)
console.log('office-lite: 装进 assets 之后由球那张预览窗内联引用 (window.__LW_OFFICE__)')
