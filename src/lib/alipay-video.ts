/**
 * 此文件由 Meoo 平台维护。Agent 严禁修改、覆盖、删除或重新创建；需要修复时向平台报告。
 * 业务代码通过 src/lib/upload.ts 公共入口使用其能力，业务定制保留在公共入口或业务层。
 *
 * This file is managed by Meoo. DO NOT edit, overwrite, delete, or recreate it.
 * Business code must use the public entry in src/lib/upload.ts.
 */

import Taro from '@tarojs/taro'

// Taro 4.2.0 promisifies chooseVideo without changing Alipay's fields.
// https://github.com/NervJS/taro/blob/v4.2.0/packages/shared/src/native-apis.ts
// https://github.com/AlipayDocs/open-docs/blob/main/mini/api/基础API/多媒体/视频/my.chooseVideo.md
/** Alipay selects one video per call. Cancellation is an empty selection. */
export async function chooseAlipayVideoPath(options: {
  sourceType?: ('album' | 'camera')[]
  maxDuration?: number
  camera?: 'back' | 'front'
}): Promise<string[]> {
  let result: Taro.chooseVideo.SuccessCallbackResult
  try {
    result = await Taro.chooseVideo({
      sourceType: options.sourceType ?? ['album', 'camera'],
      camera: options.camera ?? 'back',
      ...(options.maxDuration === undefined ? {} : { maxDuration: options.maxDuration }),
    })
  } catch (error: unknown) {
    const failure = error as { error?: number; errorMessage?: string } | null
    if (failure?.error === 10 || failure?.error === 11) return []
    if (error instanceof Error) throw error
    throw new Error(failure?.errorMessage || `支付宝选视频失败${typeof failure?.error === 'number' ? `（${failure.error}）` : ''}`)
  }
  if (typeof result.tempFilePath !== 'string' || result.tempFilePath.length === 0) {
    throw new Error('支付宝选视频返回的文件路径无效')
  }
  return [result.tempFilePath]
}

export async function readAlipayVideo(filePath: string): Promise<{
  data: ArrayBuffer; type: string; extension: string
}> {
  // No encoding returns ArrayBuffer. A .video suffix does not identify the format.
  // https://github.com/AlipayDocs/open-docs/blob/main/mini/api/基础API/文件/FileSystemManager/FileSystemManager.readFile.md
  const data = await new Promise<ArrayBuffer>((resolve, reject) => {
    Taro.getFileSystemManager().readFile({
      filePath,
      success: result => {
        if (!(result.data instanceof ArrayBuffer) || result.data.byteLength === 0) {
          reject(new Error('无法读取视频二进制内容'))
          return
        }
        resolve(result.data)
      },
      fail: reject,
    })
  })
  const bytes = new Uint8Array(data)
  const ascii = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4))
  // ISO BMFF ftyp: size, type, major brand, minor version, compatible brands.
  // Registered brands: https://github.com/mp4ra/mp4ra.github.io/blob/main/data/brands.csv
  // This identifies the container, not its codec or playability on a given device.
  if (bytes.length >= 16 && ascii(4) === 'ftyp') {
    const boxSize = new DataView(data).getUint32(0)
    if (boxSize >= 16 && boxSize <= bytes.length && boxSize % 4 === 0) {
      const brand = ascii(8)
      if (brand === 'qt  ') return { data, type: 'video/quicktime', extension: 'mov' }
      if (['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'iso7', 'iso8', 'iso9', 'mp41', 'mp42', 'avc1', 'M4V '].includes(brand)) {
        return { data, type: 'video/mp4', extension: 'mp4' }
      }
    }
  }
  throw new Error('无法识别视频格式，请选择 MP4 或 MOV 视频')
}
