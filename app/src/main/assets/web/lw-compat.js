/**
 * 老 WebView 的兜底 polyfill (2.7.10) —— 由 host/WebUI 那一侧在**文档开始**时注入
 *
 * 为什么必须有这一段: dsh 的前端产物 (以及它自己往 HTML 里塞的那段
 * `__DSH_BOOT_READY__ ??= Promise.withResolvers()`) 用了 Chrome 119 才有的
 * `Promise.withResolvers`。2022 年前后出厂、WebView 一直没更新过的机器停在 100~116, 那一行在
 * 解析期就抛异常, 于是入口脚本根本没机会跑 —— 屏幕上是永远的"连接中"。国内没有 Play, 更新
 * Android System WebView 还得每个分身用户各装一遍, 所以这里直接把它垫上
 *
 * 纪律三条:
 *   1. **只补缺的**: 每一项都先查原生有没有, 有就一个字节都不动 (新机器上这段等于空跑)
 *   2. **永不抛**: 整段包在 try 里; 任何一项装不上都只是"这一项没补上", 不许把入口脚本带崩
 *   3. **补完报一句**: 还缺什么就通过 `window.LuwiWeb.report(...)` 交给 app 那一侧, 由它决定
 *      要不要弹"去更新 WebView" —— 页面自己不去猜
 *
 * 加新的补丁请把那一行同时写进末尾的 [CRITICAL] 清单与 `tools/check-web-compat.mjs`,
 * 两处漂开的样子是"垫上了但没人验", 而那种事只有真机上的老 WebView 才看得见
 */
(function () {
  'use strict'

  var fixed = []

  /** 只在这个对象/原型上还没有这一项时才装 (与原生那一条同名同形); [label] 是报给 app 的名字 */
  function patch(target, name, value, label) {
    if (!target) return false
    try {
      if (typeof target[name] === 'function') return false
      Object.defineProperty(target, name, {
        value: value,
        writable: true,
        configurable: true,
        enumerable: false,
      })
      fixed.push(label || name)
      return true
    } catch (error) {
      return false
    }
  }

  function patchProto(proto, owner, name, value) {
    return patch(proto, name, value, owner + '.prototype.' + name)
  }

  try {
    /* ── 1. 两件最要紧的 (入口脚本与前端产物都在用) ───────────────────── */

    // Promise.withResolvers —— Chrome 119。**这一条就是"永远连接中"的病根**
    patch(Promise, 'withResolvers', function withResolvers() {
      var resolve, reject
      var promise = new Promise(function (res, rej) {
        resolve = res
        reject = rej
      })
      return { promise: promise, resolve: resolve, reject: reject }
    }, 'Promise.withResolvers')

    // AggregateError —— Chrome 85, Promise.any 的一半
    if (typeof AggregateError !== 'function') {
      var Aggregate = function AggregateError(errors, message) {
        var error = new Error(message === undefined ? 'All promises were rejected' : String(message))
        error.name = 'AggregateError'
        error.errors = Array.prototype.slice.call(errors || [])
        return error
      }
      Aggregate.prototype = Error.prototype
      try {
        globalThis.AggregateError = Aggregate
        fixed.push('AggregateError')
      } catch (error) {
        /* 装不上就算了, Promise.any 那条会退化成"抛第一个错" */
      }
    }

    // Promise.any —— Chrome 85
    patch(Promise, 'any', function any(items) {      var self = this
      return new Promise(function (resolve, reject) {
        var list
        try {
          list = Array.from(items === undefined || items === null ? [] : items)
        } catch (error) {
          reject(error)
          return
        }
        var pending = list.length
        var errors = new Array(pending)
        if (pending === 0) {
          reject(new (typeof AggregateError === 'function' ? AggregateError : Error)(errors, 'All promises were rejected'))
          return
        }
        list.forEach(function (item, index) {
          self.resolve(item).then(resolve, function (reason) {
            errors[index] = reason
            pending -= 1
            if (pending === 0) {
              var failed = typeof AggregateError === 'function' ? new AggregateError(errors, 'All promises were rejected')
                : new Error('All promises were rejected')
              reject(failed)
            }
          })
        })
      })
    }, 'Promise.any')

    // Promise.try —— Chrome 128
    patch(Promise, 'try', function tryFn(callback) {
      var rest = Array.prototype.slice.call(arguments, 1)
      var self = this
      return new self(function (resolve) {
        resolve(callback.apply(undefined, rest))
      })
    }, 'Promise.try')

    /* ── 2. 同一批老 WebView 也缺的这些 (每一条都只有几行) ──────────────── */

    // Array.prototype.at / String.prototype.at —— Chrome 92
    patchProto(Array.prototype, 'Array', 'at', function at(index) {
      if (index < 0) index += this.length
      return index < 0 || index >= this.length ? undefined : this[index]
    })
    patchProto(String.prototype, 'String', 'at', function at(index) {
      var text = String(this)
      if (index < 0) index += text.length
      return index < 0 || index >= text.length ? undefined : text.charAt(index)
    })

    // String.prototype.replaceAll —— Chrome 85
    patchProto(String.prototype, 'String', 'replaceAll', function replaceAll(search, replacement) {
      var text = String(this)
      if (search instanceof RegExp) {
        if (!search.global) throw new TypeError('replaceAll must be called with a global RegExp')
        return text.replace(search, replacement)
      }
      var target = String(search)
      if (target === '') {
        var empty = ''
        for (var at = 0; at <= text.length; at += 1) {
          empty += String(typeof replacement === 'function' ? replacement('', at, text) : replacement) + text.charAt(at)
        }
        return empty
      }
      if (typeof replacement !== 'function') return text.split(target).join(String(replacement))
      var out = ''
      var from = 0
      var hit = text.indexOf(target, from)
      while (hit >= 0) {
        out += text.slice(from, hit) + String(replacement(target, hit, text))
        from = hit + target.length
        hit = text.indexOf(target, from)
      }
      return out + text.slice(from)
    })

    // Object.hasOwn —— Chrome 93
    patch(Object, 'hasOwn', function hasOwn(object, key) {
      return Object.prototype.hasOwnProperty.call(Object(object), key)
    })

    // Array.prototype.findLast / findLastIndex —— Chrome 97
    patchProto(Array.prototype, 'Array', 'findLast', function findLast(callback, thisArg) {
      for (var index = this.length - 1; index >= 0; index -= 1) {
        if (callback.call(thisArg, this[index], index, this)) return this[index]
      }
      return undefined
    })
    patchProto(Array.prototype, 'Array', 'findLastIndex', function findLastIndex(callback, thisArg) {
      for (var index = this.length - 1; index >= 0; index -= 1) {
        if (callback.call(thisArg, this[index], index, this)) return index
      }
      return -1
    })

    // Array.prototype.toSorted / toReversed / with —— Chrome 110
    patchProto(Array.prototype, 'Array', 'toSorted', function toSorted(compare) {
      return Array.prototype.slice.call(this).sort(compare)
    })
    patchProto(Array.prototype, 'Array', 'toReversed', function toReversed() {
      return Array.prototype.slice.call(this).reverse()
    })
    patchProto(Array.prototype, 'Array', 'with', function withAt(index, value) {
      var copy = Array.prototype.slice.call(this)
      var at = index < 0 ? copy.length + index : index
      if (at < 0 || at >= copy.length) throw new RangeError('Invalid index: ' + index)
      copy[at] = value
      return copy
    })

    // Object.groupBy / Map.groupBy —— Chrome 117
    function groupBy(factory) {
      return function (items, callback) {
        var out = factory()
        var index = 0
        for (var item of items) {
          var key = callback(item, index)
          index += 1
          if (out instanceof Map) {
            var bucket = out.get(key)
            if (bucket === undefined) out.set(key, [item])
            else bucket.push(item)
          } else {
            if (!Object.prototype.hasOwnProperty.call(out, key)) out[key] = []
            out[key].push(item)
          }
        }
        return out
      }
    }
    patch(Object, 'groupBy', groupBy(function () { return Object.create(null) }))
    patch(Map, 'groupBy', groupBy(function () { return new Map() }))

    // structuredClone —— Chrome 98 (只做"深拷一份", 不接 transfer 那个参数)
    if (typeof globalThis.structuredClone !== 'function') {
      var cloneOf = function structuredClone(value, seen) {
        if (value === null || typeof value !== 'object') return value
        seen = seen || new WeakMap()
        if (seen.has(value)) return seen.get(value)
        var out
        if (value instanceof Date) return new Date(value.getTime())
        if (value instanceof RegExp) return new RegExp(value.source, value.flags)
        if (value instanceof ArrayBuffer) return value.slice(0)
        if (ArrayBuffer.isView(value)) {
          if (value instanceof DataView) return new DataView(value.buffer.slice(0), value.byteOffset, value.byteLength)
          return new value.constructor(value)
        }
        if (value instanceof Map) {
          out = new Map()
          seen.set(value, out)
          value.forEach(function (item, key) { out.set(cloneOf(key, seen), cloneOf(item, seen)) })
          return out
        }
        if (value instanceof Set) {
          out = new Set()
          seen.set(value, out)
          value.forEach(function (item) { out.add(cloneOf(item, seen)) })
          return out
        }
        if (value instanceof Error) {
          out = new value.constructor(value.message)
          seen.set(value, out)
          Object.keys(value).forEach(function (key) { out[key] = cloneOf(value[key], seen) })
          return out
        }
        out = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value))
        seen.set(value, out)
        Object.keys(value).forEach(function (key) { out[key] = cloneOf(value[key], seen) })
        return out
      }
      patch(globalThis, 'structuredClone', cloneOf)
    }

    // crypto.randomUUID —— Chrome 92 (localhost 是安全上下文, getRandomValues 一定在)
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID !== 'function' && crypto.getRandomValues) {
      try {
        Object.defineProperty(crypto, 'randomUUID', {
          value: function randomUUID() {
            var bytes = crypto.getRandomValues(new Uint8Array(16))
            bytes[6] = (bytes[6] & 0x0f) | 0x40
            bytes[8] = (bytes[8] & 0x3f) | 0x80
            var hex = Array.prototype.map.call(bytes, function (byte) {
              return byte.toString(16).padStart(2, '0')
            }).join('')
            return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-'
              + hex.slice(16, 20) + '-' + hex.slice(20)
          },
          writable: true,
          configurable: true,
        })
        fixed.push('crypto.randomUUID')
      } catch (error) {
        /* ignore */
      }
    }

    // AbortSignal.timeout / abort —— Chrome 103 / 93
    if (typeof AbortSignal !== 'undefined') {
      if (typeof AbortSignal.timeout !== 'function') {
        patch(AbortSignal, 'timeout', function timeout(ms) {
          var controller = new AbortController()
          setTimeout(function () {
            var error = new Error('signal timed out')
            error.name = 'TimeoutError'
            controller.abort(error)
          }, Number(ms) || 0)
          return controller.signal
        })
      }
      if (typeof AbortSignal.abort !== 'function') {
        patch(AbortSignal, 'abort', function abort(reason) {
          var controller = new AbortController()
          controller.abort(reason)
          return controller.signal
        })
      }

      // AbortSignal.any —— Chrome 116 (**vivo Y77 那一批就是缺这一条**): dsh 的
      // `dsh-api-gateway` client 在开 SSE 流、每帧投递、每代连接生命周期三处都调它, 缺了
      // 连接层整条起不来, 界面永远"重新连接中"。它藏在**按插件单独加载的 client chunk** 里,
      // 当初只扫主产物 (`dsh-web-frontend/dist`) 就漏掉了 —— 补 polyfill 要扫 host 树里所有
      // client bundle
      patch(AbortSignal, 'any', function any(signals) {
        var controller = new AbortController()
        var list
        try {
          list = Array.from(signals === undefined || signals === null ? [] : signals)
        } catch (error) {
          throw new TypeError('AbortSignal.any needs an iterable of signals')
        }
        for (var index = 0; index < list.length; index += 1) {
          var item = list[index]
          if (!item) continue
          if (item.aborted) {
            controller.abort(item.reason)
            return controller.signal
          }
          item.addEventListener('abort', function (event) {
            controller.abort(event.target.reason)
          }, { once: true })
        }
        return controller.signal
      }, 'AbortSignal.any')
    }

    // URL.canParse —— Chrome 117 (dsh 的插件市场 UI 在用; new URL 包一层就够)
    if (typeof URL !== 'undefined' && typeof URL.canParse !== 'function') {
      patch(URL, 'canParse', function canParse(url, base) {
        try {
          new URL(url, base)
          return true
        } catch (error) {
          return false
        }
      }, 'URL.canParse')
    }
  } catch (error) {
    /* 整段都不许把入口脚本带崩: 剩下什么没补上, 下面照实报 */
  }

  /* ── 3. 还缺什么就说出去 (app 那一侧据此弹"去更新 WebView") ─────────── */

  /** 前端真的会用到的那些; 一条都没有就说明这段 polyfill 也得跟着改 */
  var CRITICAL = [
    ['Promise.withResolvers', function () { return typeof Promise.withResolvers === 'function' }],
    ['Promise.any', function () { return typeof Promise.any === 'function' }],
    ['Array.prototype.at', function () { return typeof [].at === 'function' }],
    ['Object.hasOwn', function () { return typeof Object.hasOwn === 'function' }],
    ['String.prototype.replaceAll', function () { return typeof ''.replaceAll === 'function' }],
    ['Array.prototype.findLast', function () { return typeof [].findLast === 'function' }],
    ['structuredClone', function () { return typeof globalThis.structuredClone === 'function' }],
    ['crypto.randomUUID', function () {
      return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    }],
  ]

  var missing = []
  for (var index = 0; index < CRITICAL.length; index += 1) {
    try {
      if (!CRITICAL[index][1]()) missing.push(CRITICAL[index][0])
    } catch (error) {
      missing.push(CRITICAL[index][0])
    }
  }

  try {
    if (window.LuwiWeb && typeof window.LuwiWeb.report === 'function') {
      window.LuwiWeb.report(JSON.stringify({
        ua: String(navigator.userAgent || ''),
        fixed: fixed,
        missing: missing,
      }))
    }
  } catch (error) {
    /* 桥不在 (比如用桌面的浏览器打开) 就什么都不做 */
  }
})()
