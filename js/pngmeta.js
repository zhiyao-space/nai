/* PNG 生成参数元数据: 与 NovelAI 官方一致, 用 tEXt 块内嵌
 *   Software    = "NovelAI"
 *   Title       = "AI generated image"
 *   Description = 正向提示词
 *   Comment     = 参数 JSON (prompt/steps/scale/seed/sampler/uc/...)
 * 写入在 IHDR 之后、IDAT 之前; 读取时兼容 tEXt 与 iTXt。
 */

const PNG_META_CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function pngCrc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = PNG_META_CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function isPngBytes(bytes) {
  return bytes.length > 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
}

function buildTextChunk(keyword, text) {
  const kw = new TextEncoder().encode(keyword);
  const val = new TextEncoder().encode(text);
  const data = new Uint8Array(kw.length + 1 + val.length);
  data.set(kw, 0);
  data[kw.length] = 0;
  data.set(val, kw.length + 1);
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(new TextEncoder().encode("tEXt"), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, pngCrc32(out.subarray(4, 8 + data.length)));
  return out;
}

/* meta -> 官方 Comment JSON。字段结构与官方生成图逐项对齐:
 * V3: params_version=2, 角色不写入 (官方 V3 无角色提示词)
 * V4: params_version=3, v4=true, 角色走 v4_prompt/v4_negative_prompt.char_captions
 * 模型名写进 tEXt "Source" 块 (官方同位置放模型指纹), Comment 内另存 model 便于本站往返。
 */
function isV4Family(model) {
  return /nai-diffusion-4/.test(model || "");
}

function metaToComment(m) {
  const isV4 = isV4Family(m.model);
  const comment = {
    prompt: m.prompt || "",
    steps: m.steps,
    height: m.h,
    width: m.w,
    scale: m.scale,
    uc: m.negative || "",
    sampler: m.sampler,
    seed: m.seed,
    noise_schedule: m.noiseSchedule,
    cfg_rescale: m.cfgRescale,
    skip_cfg_above_sigma: null,
    smea: false,
    smea_dyn: false,
    dynamic_thresholding: false,
    controlnet_strength: 1,
    legacy: false,
    legacy_v3_extend: false,
    add_original_image: m.action !== "generate",
    uncond_scale: 1,
    strength: m.strength,
    noise: m.noise,
    image: "",
    mask: "",
    extra_noise_seed: m.seed,
    variations: [],
    reference_image_multiple: (m.vibes || []).map((v) => v.b64 || ""),
    reference_information_extracted_multiple: (m.vibes || []).map((v) => v.infoExtracted ?? 1),
    reference_strength_multiple: (m.vibes || []).map((v) => v.referenceStrength ?? 0.6),
    use_reference_image: (m.vibes || []).length > 0,
    ucPreset: m.ucpOn ? 0 : 1,
    qualityToggle: !!m.qualityOn,
    params_version: isV4 ? 3 : 2,
    action: m.action || "generate",
    model: m.model
  };
  if (isV4) {
    const chars = m.characters || [];
    comment.deliberate_euler_ancestral_bug = false;
    comment.prefer_brownian = true;
    comment.legacy_uc = false;
    comment.v4 = true;
    comment.v4_prompt = {
      caption: {
        base_caption: m.prompt || "",
        char_captions: chars.map((c) => ({
          char_caption: c.prompt || "",
          centers: [{ x: c.x ?? 0.5, y: c.y ?? 0.5 }]
        }))
      },
      use_coords: !!m.useCoords,
      use_order: m.useOrder !== false
    };
    comment.v4_negative_prompt = {
      caption: {
        base_caption: m.negative || "",
        char_captions: chars
          .filter((c) => c.negative)
          .map((c) => ({
            char_caption: c.negative,
            centers: [{ x: c.x ?? 0.5, y: c.y ?? 0.5 }]
          }))
      },
      legacy_uc: false
    };
  }
  return comment;
}

/* 官方 Comment JSON -> 本站 meta。兼容三类来源:
 * 1. 本站生成 (有 model 键)  2. 官方 V4 图 (v4_prompt 结构, 模型从 Source 推断)
 * 3. 官方 V3 图 (Source 含 XL)
 */
function commentToMeta(c) {
  if (!c || typeof c !== "object" || (!c.prompt && !c.width)) return null;
  const chars = [];
  const v4p = c.v4_prompt && c.v4_prompt.caption;
  if (v4p && Array.isArray(v4p.char_captions)) {
    const negCaps = (c.v4_negative_prompt && c.v4_negative_prompt.caption
      && c.v4_negative_prompt.caption.char_captions) || [];
    v4p.char_captions.forEach((cc, i) => {
      const center = (cc.centers && cc.centers[0]) || {};
      chars.push({
        prompt: cc.char_caption || "",
        negative: (negCaps[i] && negCaps[i].char_caption) || "",
        x: center.x ?? 0.5,
        y: center.y ?? 0.5
      });
    });
  }
  let action = c.action || "generate";
  if (action === "generate" && c.mask) action = "inpaint";
  else if (action === "generate" && c.image) action = "img2img";
  const source = c.__source || "";
  const refImgs = Array.isArray(c.reference_image_multiple) ? c.reference_image_multiple : [];
  const refInfo = Array.isArray(c.reference_information_extracted_multiple) ? c.reference_information_extracted_multiple : [];
  const refStr = Array.isArray(c.reference_strength_multiple) ? c.reference_strength_multiple : [];
  return {
    prompt: c.prompt ?? "",
    negative: c.uc ?? "",
    steps: c.steps,
    scale: c.scale,
    sampler: c.sampler,
    noiseSchedule: c.noise_schedule,
    cfgRescale: c.cfg_rescale,
    w: c.width,
    h: c.height,
    seed: c.seed,
    qualityOn: !!c.qualityToggle,
    ucpOn: c.ucPreset === 0,
    action,
    strength: c.strength,
    noise: c.noise,
    characters: chars,
    useCoords: !!(c.v4_prompt && c.v4_prompt.use_coords),
    useOrder: c.v4_prompt ? c.v4_prompt.use_order !== false : false,
    vibes: refImgs.filter(Boolean).map((b64, i) => ({
      b64,
      infoExtracted: refInfo[i] ?? 1,
      referenceStrength: refStr[i] ?? 0.6
    })),
    model: c.model || (c.v4 ? "nai-diffusion-4-5-full"
      : /XL/i.test(source) ? "nai-diffusion-3" : undefined)
  };
}

/* ---------- stealth pnginfo: alpha 隐形通道 (官方同款 stealth_pngcomp) ----------
 * 官方把同一份参数 JSON gzip 后写入 alpha 通道最低位 (列优先逐像素):
 *   "stealth_pngcomp"(15字节) + Int32(位数,大端) + gzip(JSON)
 * 另兼容旧版无压缩魔数 "stealth_pnginfo"。转成 JPEG 丢失 tEXt 后仍可读回参数。
 */

const STEALTH_MAGIC_INFO = "stealth_pnginfo";
const STEALTH_MAGIC_COMP = "stealth_pngcomp";

function strToBits(str) {
  const bytes = new TextEncoder().encode(str);
  const bits = [];
  for (const b of bytes) for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1);
  return bits;
}

function int32ToBits(n) {
  const dv = new DataView(new ArrayBuffer(4));
  dv.setInt32(0, n);
  const bits = [];
  for (let i = 0; i < 4; i++) {
    const b = dv.getUint8(i);
    for (let k = 7; k >= 0; k--) bits.push((b >> k) & 1);
  }
  return bits;
}

function bitsToInt32(bits) {
  let v = 0;
  for (let i = 0; i < 32; i++) v = (v << 1) | (bits[i] & 1);
  return v | 0;
}

async function gzipBytes(bytes) {
  if (typeof CompressionStream === "undefined") return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (e) {
    return null;
  }
}

async function gunzipBytes(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* 列优先 (x 外层, y 内层) 把位流写进 alpha 最低位 */
function writeBitsToAlpha(data, width, height, bits) {
  let idx = 0;
  for (let x = 0; x < width && idx < bits.length; x++) {
    for (let y = 0; y < height && idx < bits.length; y++) {
      const p = (y * width + x) * 4 + 3;
      data[p] = bits[idx] ? (data[p] | 1) : (data[p] & 0xfe);
      idx++;
    }
  }
}

function alphaBitReader(data, width, height) {
  let x = 0, y = 0;
  return () => {
    if (y >= height) {
      if (x + 1 >= width) return null;
      x++;
      y = 0;
    }
    const bit = data[(y * width + x) * 4 + 3] & 1;
    y++;
    return bit;
  };
}

async function parseStealthPayload(readBit) {
  const readBits = (n) => {
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const b = readBit();
      if (b === null) return null;
      out[i] = b;
    }
    return out;
  };
  const pack = (bits) => {
    const bytes = new Uint8Array(bits.length / 8);
    for (let i = 0; i < bytes.length; i++) {
      let b = 0;
      for (let k = 0; k < 8; k++) b = (b << 1) | bits[i * 8 + k];
      bytes[i] = b;
    }
    return bytes;
  };
  const magicBits = readBits(STEALTH_MAGIC_COMP.length * 8);
  if (!magicBits) return null;
  const magic = String.fromCharCode(...pack(magicBits));
  const comp = magic === STEALTH_MAGIC_COMP;
  if (!comp && magic !== STEALTH_MAGIC_INFO) return null;
  const lenBits = readBits(32);
  if (!lenBits) return null;
  const len = bitsToInt32(lenBits);
  if (len <= 0 || len % 8 !== 0) return null;
  let bytes = pack(readBits(len) || []);
  if (comp) bytes = await gunzipBytes(bytes);
  return new TextDecoder().decode(bytes);
}

async function loadPngPixels(blob) {
  if (typeof document === "undefined" || typeof Image === "undefined") return null;
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("图片解码失败"));
      im.src = url;
    });
    const cv = document.createElement("canvas");
    cv.width = img.naturalWidth;
    cv.height = img.naturalHeight;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, cv.width, cv.height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function embedStealthPngInfo(blob, jsonString) {
  try {
    const raw = new TextEncoder().encode(jsonString);
    const gz = await gzipBytes(raw);
    const useComp = gz && gz.length < raw.length;
    const payload = useComp ? gz : raw;
    const bits = [
      ...strToBits(useComp ? STEALTH_MAGIC_COMP : STEALTH_MAGIC_INFO),
      ...int32ToBits(payload.length * 8)
    ];
    for (const b of payload) for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1);
    const imageData = await loadPngPixels(blob);
    if (!imageData) return blob;
    // 容量保护: alpha 每像素只能藏 1 位, 装不下时跳过隐形通道 (tEXt 仍完整携带参数)
    if (bits.length > imageData.width * imageData.height) return blob;
    writeBitsToAlpha(imageData.data, imageData.width, imageData.height, bits);
    const cv = document.createElement("canvas");
    cv.width = imageData.width;
    cv.height = imageData.height;
    cv.getContext("2d").putImageData(imageData, 0, 0);
    const out = await new Promise((resolve) => cv.toBlob(resolve, "image/png"));
    return out || blob;
  } catch (e) {
    return blob;
  }
}

async function readStealthPngInfo(blob) {
  try {
    const imageData = await loadPngPixels(blob);
    if (!imageData) return null;
    const json = await parseStealthPayload(
      alphaBitReader(imageData.data, imageData.width, imageData.height)
    );
    if (!json) return null;
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

async function embedPngMetadata(blob, meta) {
  const json = JSON.stringify(metaToComment(meta));
  // canvas 重编码会丢掉 tEXt, 所以先写隐形通道, 再二进制插入 tEXt
  const stealthed = await embedStealthPngInfo(blob, json);
  return insertTextChunks(stealthed, meta);
}

async function insertTextChunks(blob, meta) {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (!isPngBytes(bytes) || bytes.length < 16) return blob;
  const dv = new DataView(buf);
  const ihdrLen = dv.getUint32(8);
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) return blob;
  const insertAt = 8 + 12 + ihdrLen;
  const chunks = [
    buildTextChunk("Software", "NovelAI"),
    buildTextChunk("Title", "AI generated image"),
    buildTextChunk("Source", meta.model || "NovelAI"),
    buildTextChunk("Description", meta.prompt || ""),
    buildTextChunk("Comment", JSON.stringify(metaToComment(meta)))
  ];
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(bytes.length + total);
  out.set(bytes.subarray(0, insertAt), 0);
  let off = insertAt;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  out.set(bytes.subarray(insertAt), off);
  return new Blob([out], { type: "image/png" });
}

async function readPngMetadata(blob) {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (!isPngBytes(bytes)) return null;
  const dv = new DataView(buf);
  const texts = {};
  let p = 8;
  while (p + 12 <= bytes.length) {
    const len = dv.getUint32(p);
    if (p + 12 + len > bytes.length) break;
    const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    if (type === "tEXt") {
      const data = bytes.subarray(p + 8, p + 8 + len);
      const z = data.indexOf(0);
      if (z > 0) {
        texts[new TextDecoder().decode(data.subarray(0, z))] = new TextDecoder().decode(data.subarray(z + 1));
      }
    } else if (type === "iTXt") {
      const data = bytes.subarray(p + 8, p + 8 + len);
      const z1 = data.indexOf(0);
      if (z1 > 0) {
        let q = z1 + 3; // 跳过压缩标志 + 压缩方法
        const z2 = data.indexOf(0, q);
        if (z2 >= 0) {
          q = z2 + 1;
          const z3 = data.indexOf(0, q);
          if (z3 >= 0) {
            texts[new TextDecoder().decode(data.subarray(0, z1))] = new TextDecoder().decode(data.subarray(z3 + 1));
          }
        }
      }
    }
    if (type === "IEND") break;
    p += 12 + len;
  }
  if (texts.Comment) {
    try {
      const parsed = JSON.parse(texts.Comment);
      if (parsed && typeof parsed === "object") parsed.__source = texts.Source || "";
      return parsed;
    } catch (e) {}
  }
  // tEXt 没有 Comment 时回退读 alpha 隐形通道 (官方 ZIP 直出的图只有隐形通道)
  return readStealthPngInfo(blob);
}
