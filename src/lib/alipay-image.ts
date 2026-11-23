/**
 * 此文件由 Meoo 平台维护。Agent 严禁修改、覆盖、删除或重新创建；需要修复时向平台报告。
 * 业务代码通过 src/lib/upload.ts 公共入口使用其能力，业务定制保留在公共入口或业务层。
 *
 * This file is managed by Meoo. DO NOT edit, overwrite, delete, or recreate it.
 * Business code must use the public entry in src/lib/upload.ts.
 */

import Taro from '@tarojs/taro'

// Taro 4.2.0 maps legacy apFilePaths to tempFilePaths. When Alipay returns
// tempFilePaths without apFilePaths, Taro overwrites it with undefined but
// preserves tempFiles.
// https://github.com/NervJS/taro/blob/v4.2.0/packages/taro-platform-alipay/src/apis.ts
// Recover the current response from its documented tempFiles[].path; all
// platform API calls still go through Taro.
// https://github.com/AlipayDocs/open-docs/blob/main/mini/api/基础API/多媒体/图片/my.chooseImage.md
export async function chooseAlipayImagePaths(count: number, sourceType: ('album' | 'camera')[]): Promise<string[]> {
  let result: Taro.chooseImage.SuccessCallbackResult
  try {
    result = await Taro.chooseImage({ count, sourceType })
  } catch (error: unknown) {
    // Taro's Promise wrapper leaves Alipay failure fields unchanged.
    // https://github.com/NervJS/taro/blob/v4.2.0/packages/shared/src/native-apis.ts
    const failure = error as { error?: number; errorMessage?: string } | null
    if (failure?.error === 11) return []
    if (error instanceof Error) throw error
    throw new Error(failure?.errorMessage || `支付宝选图失败${typeof failure?.error === 'number' ? `（${failure.error}）` : ''}`)
  }
  let paths: unknown
  if (result.tempFilePaths !== undefined) {
    paths = result.tempFilePaths
  } else if (Array.isArray(result.tempFiles)) {
    paths = result.tempFiles.map(file => file?.path)
  }
  if (!Array.isArray(paths) || paths.length === 0 || !paths.every(item => typeof item === 'string' && item.length > 0)) {
    throw new Error('支付宝选图返回的文件路径无效')
  }
  return paths
}

export async function readAlipayImage(filePath: string): Promise<{
  data: ArrayBuffer; type: string; extension: string
}> {
  // No encoding => ArrayBuffer; never use the native .image path as a MIME hint.
  // https://github.com/AlipayDocs/open-docs/blob/main/mini/api/基础API/文件/FileSystemManager/FileSystemManager.readFile.md
  const data = await new Promise<ArrayBuffer>((resolve, reject) => {
    Taro.getFileSystemManager().readFile({
      filePath,
      success: result => {
        if (!(result.data instanceof ArrayBuffer) || result.data.byteLength === 0) {
          reject(new Error('无法读取图片二进制内容'))
          return
        }
        resolve(result.data)
      },
      fail: reject,
    })
  })
  const bytes = new Uint8Array(data)
  const matches = (signature: number[], offset = 0) => signature.every((value, index) => bytes[offset + index] === value)
  let extension: string
  let type: string
  if (matches([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    extension = 'png'; type = 'image/png'
  } else if (matches([0xff, 0xd8, 0xff])) {
    extension = 'jpg'; type = 'image/jpeg'
  } else if (matches([0x47, 0x49, 0x46, 0x38]) && [0x37, 0x39].includes(bytes[4]) && bytes[5] === 0x61) {
    extension = 'gif'; type = 'image/gif'
  } else if (matches([0x52, 0x49, 0x46, 0x46]) && matches([0x57, 0x45, 0x42, 0x50], 8)) {
    extension = 'webp'; type = 'image/webp'
  } else if (matches([0x42, 0x4d])) {
    extension = 'bmp'; type = 'image/bmp'
  } else {
    throw new Error('无法识别图片格式，请选择 PNG、JPEG、GIF、WebP 或 BMP 图片')
  }
  return { data, type, extension }
}
