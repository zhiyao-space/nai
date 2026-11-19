import Taro from "@tarojs/taro"
import { supabase, supabaseUrl, supabaseAnonKey } from "@/supabase/client"
import { readAlipayUploadMedia, selectAlipayMediaFiles, uploadAlipayMedia } from '@/lib/alipay-upload'

/**
 * MIME type mappings for common file extensions
 */
export const MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  zip: 'application/zip',
  rar: 'application/x-rar-compressed',
  '7z': 'application/x-7z-compressed',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  avi: 'video/x-msvideo',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  json: 'application/json',
  xml: 'application/xml',
  csv: 'text/csv',
} as const

/**
 * File input type for WeChat MiniProgram
 */
export interface MiniProgramFileInput {
  name: string
  type: string
  size: number
  tempFilePath: string
}

/**
 * Options for selecting media files
 */
export interface SelectMediaOptions {
  /** Maximum number of files to select */
  count?: number
  /** Media types to select */
  mediaType?: ('image' | 'video' | 'mix')[]
  /** Source type for file selection */
  sourceType?: ('album' | 'camera')[]
  /** Maximum video duration in seconds (MiniProgram only) */
  maxDuration?: number
  /** Camera mode (MiniProgram only) */
  camera?: 'back' | 'front'
}

/**
 * Options for selecting message files
 */
export interface SelectMessageFileOptions {
  /** Maximum number of files to select */
  count?: number
  /** File type filter */
  type?: 'all' | 'video' | 'image' | 'file'
  /** File extensions to allow */
  extension?: string[]
}

/** File upload configuration options */
export interface FileInputOptions {
  /** storage.buckets.id, not the bucket name */
  bucketId: string
  userId?: string
}

/** Supported file data types */
export type FileBody =
  | ArrayBuffer
  | ArrayBufferView
  | File
  | string

/** File input type (MiniProgram or Web) */
export type FileInput = MiniProgramFileInput | File

/**
 * Generate unique storage file name
 */
export function generateFileName(ext: string): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  return `${timestamp}-${random}.${ext}`
}

/**
 * Get MIME type for a file extension
 */
export function getMimeType(ext: string): string {
  return MIME_TYPES[ext.toLowerCase()] || 'application/octet-stream'
}

/**
 * Upload file to Supabase Storage
 * Web: use supabase client
 * MiniProgram: use ArrayBuffer + Taro.request
 */
export async function uploadToSupabase(
  file: FileInput,
  options: FileInputOptions
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const { bucketId } = options

    const alipayMedia = Taro.getEnv() === Taro.ENV_TYPE.ALIPAY
      ? await readAlipayUploadMedia(file as MiniProgramFileInput)
      : null

    // Naming and owner paths stay in the public entry; Alipay uses the detected
    // extension. Preserve the existing WeChat/H5 path semantics.
    const ext = alipayMedia ? alipayMedia.extension : file?.name?.split('.')?.pop() || 'file'
    const storageName = generateFileName(ext)
    const storagePath = alipayMedia && options.userId ? `${options.userId}/${storageName}` : storageName

    if (alipayMedia) {
      return { success: true, data: await uploadAlipayMedia(alipayMedia, bucketId, storagePath, supabase.storage) }
    }

    // MiniProgram: read file as ArrayBuffer + Taro.request
    if (Taro.getEnv() === Taro.ENV_TYPE.WEAPP) {
      const tempFilePath = (file as MiniProgramFileInput).tempFilePath

      // Read file as ArrayBuffer directly
      const fs = Taro.getFileSystemManager()
      const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        fs.readFile({
          filePath: tempFilePath,
          success: (res) => resolve(res.data as ArrayBuffer),
          fail: (err) => reject(err),
        })
      })

      // Upload via Taro.request (binary body + 自定义 Content-Type)
      const uploadUrl = `${supabaseUrl}/storage/v1/object/${bucketId}/${storageName}`

      // 优先使用用户 JWT（已登录时），否则回退到 anon key
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      const authHeader = accessToken ? `Bearer ${accessToken}` : `Bearer ${supabaseAnonKey}`

      try {
        const res = await Taro.request({
          url: uploadUrl,
          method: 'POST',
          header: {
            'Authorization': authHeader,
            'Content-Type': file.type || 'application/octet-stream',
            'x-upsert': 'false',
          },
          data: arrayBuffer,
        })
        if (res.statusCode >= 200 && res.statusCode < 300) {
          return { success: true, data: { path: storageName } }
        }
        console.error('Taro.request upload error:', res)
        return { success: false, error: `Upload failed: ${res.statusCode}` }
      } catch (err: any) {
        console.error('Taro.request upload fail:', err)
        return { success: false, error: err?.errMsg || err?.message || 'Upload failed' }
      }
    }

    // Web: read file as ArrayBuffer and upload via supabase client
    const arrayBuffer = await (file as File).arrayBuffer()

    const { data, error } = await supabase.storage
      .from(bucketId)
      .upload(storageName, arrayBuffer, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      })

    if (error) {
      console.error('Supabase upload error:', error)
      throw error
    }

    return { success: true, data }
  } catch (error: any) {
    console.error('Upload error:', error)
    return {
      success: false,
      error: error.message || 'Upload failed',
    }
  }
}

/**
 * Select media files (images/videos) from device
 */
export async function selectMediaFiles(
  options: SelectMediaOptions = {}
): Promise<(MiniProgramFileInput | File)[]> {
  if (Taro.getEnv() === Taro.ENV_TYPE.ALIPAY) {
    const files = await selectAlipayMediaFiles(options)
    return files.map(({ extension, ...file }) => ({ name: generateFileName(extension), ...file }))
  }
  const {
    count = 1,
    mediaType = ['image', 'video'],
    sourceType = ['album', 'camera'],
    maxDuration,
    camera = 'back',
  } = options

  try {
    const result = await Taro.chooseMedia({
      count,
      mediaType,
      sourceType,
      maxDuration,
      camera,
    })

    if (!result.tempFiles?.length) {
      return []
    }

    return result.tempFiles.map((file: any) => {
      // Web environment: return File object directly
      if (Taro.getEnv() === Taro.ENV_TYPE.WEB) {
        return file.originalFileObj as File
      }

      // MiniProgram environment: construct file metadata
      const tempFilePath = file.tempFilePath
      const ext = tempFilePath.split('.').pop() || 'unknown'
      const name = generateFileName(ext)
      const type = getMimeType(ext)

      return {
        name,
        type,
        size: file.size,
        tempFilePath,
      } as MiniProgramFileInput
    })
  } catch (error: any) {
    console.error('Failed to select media files:', error)
    return []
  }
}

/**
 * Select a message file (document) from WeChat chat or local storage
 */
export async function selectMessageFile(
  options: SelectMessageFileOptions = {}
): Promise<MiniProgramFileInput | File | null> {
  if (Taro.getEnv() === Taro.ENV_TYPE.ALIPAY) {
    throw new Error('支付宝当前不支持通用附件选择，请使用图片或视频选择')
  }
  const {
    count = 1,
    type = 'file',
    extension = ['pdf'],
  } = options

  try {
    // Web environment: use native file input
    if (Taro.getEnv() === Taro.ENV_TYPE.WEB) {
      return new Promise<File | null>((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = extension.map(ext => `.${ext}`).join(',')
        input.onchange = (e: Event) => {
          const target = e.target as HTMLInputElement
          const selectedFile = target.files?.[0]
          input.remove()
          resolve(selectedFile || null)
        }
        // Handle user cancellation
        input.oncancel = () => {
          input.remove()
          resolve(null)
        }
        input.click()
      })
    }

    // MiniProgram environment: use chooseMessageFile API
    const result = await Taro.chooseMessageFile({
      count,
      type,
      extension,
    })
    if (!result.tempFiles?.length) {
      return null
    }
    const file = result.tempFiles[0]
    const ext = file.name?.split('.').pop() || extension[0]
    return {
      name: file.name,
      type: getMimeType(ext),
      size: file.size,
      tempFilePath: file.path,
    } as MiniProgramFileInput
  } catch (error: any) {
    console.error('Failed to select message file:', error)
    return null
  }
}
