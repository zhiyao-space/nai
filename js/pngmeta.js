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

function metaToComment(m) {
  return {
    prompt: m.prompt || "",
    steps: m.steps,
    height: m.h,
    width: m.w,
    scale: m.scale,
    seed: m.seed,
    sampler: m.sampler,
    uc: m.negative || "",
    noise_schedule: m.noiseSchedule,
    cfg_rescale: m.cfgRescale,
    qualityToggle: !!m.qualityOn,
    ucPreset: m.ucpOn ? 0 : 1,
    action: m.action || "generate",
    strength: m.strength,
    noise: m.noise,
    characters: m.characters || [],
    use_coords: !!m.useCoords,
    use_order: !!m.useOrder,
    model: m.model
  };
}

function commentToMeta(c) {
  if (!c || typeof c !== "object" || (!c.prompt && !c.width)) return null;
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
    action: c.action || "generate",
    strength: c.strength,
    noise: c.noise,
    characters: Array.isArray(c.characters) ? c.characters : [],
    useCoords: !!c.use_coords,
    useOrder: !!c.use_order,
    model: c.model
  };
}

async function embedPngMetadata(blob, meta) {
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
  if (!texts.Comment) return null;
  try {
    return JSON.parse(texts.Comment);
  } catch (e) {
    return null;
  }
}
