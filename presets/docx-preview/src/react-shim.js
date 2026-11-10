/**
 * React 的空影子 (**只给 `tools/build-office-lite.mjs` 用**, 别在 dsh 树里引它)
 *
 * 那一包对外的渲染入口 (`renderOffice` / `isOfficeName` / `MAX_BYTES`) 与它那几个 React 组件写在
 * 同一个模块里, 而球上的预览窗**没有 React 模块表** —— 打 lite 包时把 `react` 换成这一份, 于是
 * 组件那几段仍然打得进去 (不执行), 渲染核心照常跑
 *
 * 这里只放"不执行也不会报错"的形状: 顶层没有任何调用, 全是函数
 */

const noop = () => null

const React = {
  createElement: noop,
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, noop],
  useEffect: noop,
  useLayoutEffect: noop,
  useMemo: (factory) => (typeof factory === 'function' ? factory() : undefined),
  useCallback: (callback) => callback,
  useRef: (initial) => ({ current: initial ?? null }),
  forwardRef: (render) => render,
  memo: (component) => component,
  Fragment: 'fragment',
  StrictMode: 'strict',
  createContext: (initial) => ({ Provider: 'provider', Consumer: 'consumer', _current: initial }),
  useContext: () => undefined,
}

export default React
export const createElement = noop
export const Fragment = 'fragment'
