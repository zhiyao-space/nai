/**
 * 此文件由 Meoo 平台维护。Agent 严禁修改、覆盖、删除或重新创建；需要修复时向平台报告。
 * 业务代码通过 src/lib/sse.ts 公共入口使用其能力，业务定制保留在公共入口或业务层。
 *
 * This file is managed by Meoo. DO NOT edit, overwrite, delete, or recreate it.
 * Business code must use the public entry in src/lib/sse.ts.
 */

import Taro from '@tarojs/taro'

interface AlipaySseTransportOptions {
  url: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  headers: Record<string, string>
  body: unknown
  onOpen?: (status: number, headers: Record<string, string>) => void
  onError?: (error: unknown) => void
  /** The caller retains SSE parsing and business callbacks, including cancellation during dispatch. */
  onText: (text: string, isAborted: () => boolean) => void
}

/** Alipay whole-response transport; request preparation and event parsing stay in sse.ts. */
export function requestAlipaySse(options: AlipaySseTransportOptions): { abort: () => void } {
  const { url, method, headers, body, onOpen, onError, onText } = options
  let aborted = false
  let settled = false
  const fail = (error: unknown) => {
    if (aborted || settled) return
    settled = true
    // Taro 4.2.0 maps status/headers only on success; fail retains Alipay fields.
    // https://opendocs.alipay.com/mini/api/owycmh
    // https://github.com/NervJS/taro/blob/v4.2.0/packages/taro-platform-alipay/src/apis.ts
    if (typeof error === 'object' && error !== null && 'status' in error &&
        typeof error.status === 'number') {
      onError?.(new Error(`SSE HTTP ${error.status}`))
    } else {
      onError?.(error)
    }
  }
  const task = Taro.request({
    url,
    method,
    header: headers,
    data: body as any,
    dataType: 'text',
    responseType: 'text',
    success: (res) => {
      if (aborted || settled) return
      settled = true
      try {
        if (typeof res.statusCode !== 'number') throw new Error('SSE missing HTTP status')
        onOpen?.(res.statusCode, res.header as Record<string, string>)
        if (aborted) return
        if (res.statusCode < 200 || res.statusCode >= 300) {
          throw new Error(`SSE HTTP ${res.statusCode}`)
        }
        if (typeof res.data !== 'string') throw new Error('SSE expected text response')
        onText(res.data, () => aborted)
      } catch (error) {
        if (!aborted) onError?.(error)
      }
    },
    fail,
  })
  // Taro invokes fail and rejects its Promise; consume both through the same terminal guard.
  task.catch(fail)
  return { abort: () => { aborted = true; task.abort() } }
}
