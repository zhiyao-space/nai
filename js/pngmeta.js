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
    reference_image_multiple: [],
    reference_information_extracted_multiple: [],
    reference_strength_multiple: [],
    use_reference_image: false,
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
    model: c.model || (c.v4 ? "nai-diffusion-4-5-full"
      : /XL/i.test(source) ? "nai-diffusion-3" : undefined)
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
  if (!texts.Comment) return null;
  try {
    const parsed = JSON.parse(texts.Comment);
    if (parsed && typeof parsed === "object") parsed.__source = texts.Source || "";
    return parsed;
  } catch (e) {
    return null;
  }
}
