/**
 * 此文件由 Meoo 平台维护。Agent 严禁修改、覆盖、删除或重新创建；需要修复时向平台报告。
 * 业务代码通过 src/lib/measure.ts 公共入口使用其能力，业务定制保留在公共入口或业务层。
 *
 * This file is managed by Meoo. DO NOT edit, overwrite, delete, or recreate it.
 * Business code must use the public entry in src/lib/measure.ts.
 */

import Taro from '@tarojs/taro'

type AlipayRectValue = { left?: unknown; top?: unknown; width?: unknown; height?: unknown }

/** Read the raw exec result; shared normalization and positioning remain in measure.ts. */
export function queryAlipayRectById(id: string): Promise<AlipayRectValue | null | undefined> {
  return new Promise(resolve => {
    // Alipay reports boundingClientRect results through exec, not a per-node callback.
    // https://github.com/AlipayDocs/open-docs/blob/main/mini/api/基础API/界面/节点查询/my.createSelectorQuery.md
    Taro.createSelectorQuery().select(`#${id}`).boundingClientRect().exec(results => {
      resolve(results[0])
    })
  })
}
