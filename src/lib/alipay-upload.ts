/**
 * 此文件由 Meoo 平台维护。Agent 严禁修改、覆盖、删除或重新创建；需要修复时向平台报告。
 * 业务代码通过 src/lib/upload.ts 公共入口使用其能力，业务定制保留在公共入口或业务层。
 *
 * This file is managed by Meoo. DO NOT edit, overwrite, delete, or recreate it.
 * Business code must use the public entry in src/lib/upload.ts.
 */

import { chooseAlipayImagePaths, readAlipayImage } from '@/lib/alipay-image'
import { chooseAlipayVideoPath, readAlipayVideo } from '@/lib/alipay-video'

// Platform operations only. Public naming/path rules remain in @/lib/upload.
type MediaOptions = Parameters<typeof chooseAlipayVideoPath>[0] & {
  count?: number
  mediaType?: ('image' | 'video' | 'mix')[]
}

function readAlipayMedia(filePath: string, videoOnly: boolean) {
  return videoOnly ? readAlipayVideo(filePath) : readAlipayImage(filePath)
}

export function readAlipayUploadMedia(file: { type?: string; tempFilePath: string }) {
  return readAlipayMedia(file.tempFilePath, file.type?.startsWith('video/') === true)
}

/** Return actual media metadata; the public entry supplies each file name. */
export async function selectAlipayMediaFiles(options: MediaOptions) {
  const mediaType = options.mediaType ?? ['image']
  const videoOnly = mediaType.length === 1 && mediaType[0] === 'video'
  if (!videoOnly && (mediaType.length !== 1 || mediaType[0] !== 'image')) {
    throw new Error('支付宝请分别选择图片或视频，不支持一次混选')
  }
  const paths = videoOnly
    ? await chooseAlipayVideoPath(options)
    : await chooseAlipayImagePaths(options.count ?? 1, options.sourceType ?? ['album', 'camera'])
  return Promise.all(paths.map(async tempFilePath => {
    const media = await readAlipayMedia(tempFilePath, videoOnly)
    return {
      extension: media.extension, type: media.type,
      size: media.data.byteLength, tempFilePath,
    }
  }))
}

type UploadStorage = {
  from(bucketId: string): {
    upload(path: string, body: ArrayBuffer, options: { contentType: string; upsert: boolean }): Promise<{
      data: unknown
      error: unknown
    }>
  }
}

export async function uploadAlipayMedia(
  media: { data: ArrayBuffer; type: string },
  bucketId: string,
  storagePath: string,
  storage: UploadStorage
) {
  // Official SDK sends bytes through the managed Taro fetch, retaining the
  // project route, current session and HTTP error semantics.
  // https://supabase.com/docs/reference/javascript/storage-from-upload
  const { data, error } = await storage.from(bucketId).upload(storagePath, media.data, {
    contentType: media.type,
    upsert: false,
  })
  if (error) throw error
  return data
}
