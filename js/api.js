const NAI_MODELS = [
  { id: "nai-diffusion-4-5-curated", name: "NAI Diffusion V4.5 Curated", family: 4 },
  { id: "nai-diffusion-4-5-full", name: "NAI Diffusion V4.5 Full", family: 4 },
  { id: "nai-diffusion-4-full", name: "NAI Diffusion V4 Full", family: 4 },
  { id: "nai-diffusion-4-curated-preview", name: "NAI Diffusion V4 Curated (Preview)", family: 4 },
  { id: "nai-diffusion-3", name: "NAI Diffusion V3", family: 3 },
  { id: "nai-diffusion-3-inpainting", name: "NAI Diffusion V3 Inpainting", family: 3 }
];

const QUALITY_TAGS = {
  3: "masterpiece, best quality, amazing quality",
  4: "very aesthetic, location, masterpiece, no text",
  0: "masterpiece, best quality"
};

const UCP_PRESETS = {
  3: "nsfw, lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract]",
  4: "blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, multiple views, logo, too many watermarks",
  0: "lowres, bad quality, watermark, jpeg artifacts, worst quality"
};

const SAMPLERS_V45 = [
  { id: "k_euler", label: "标准 Euler" },
  { id: "k_euler_a", label: "多变 Euler A" },
  { id: "k_dpmpp_2m", label: "均衡 DPM++ 2M" },
  { id: "k_dpmpp_2m_sde", label: "细腻 DPM++ 2M SDE" },
  { id: "k_dpmpp_sde", label: "高细节 DPM++ SDE" }
];

const SAMPLERS_V3 = [
  { id: "k_euler", label: "标准 Euler" },
  { id: "k_euler_ancestral", label: "多变 Euler Ancestral" },
  { id: "k_heun", label: "慢速 Heun" },
  { id: "k_dpmpp_2s_ancestral", label: "随机 DPM++ 2S A" },
  { id: "k_dpmpp_2m", label: "均衡 DPM++ 2M" },
  { id: "k_dpmpp_sde", label: "高细节 DPM++ SDE" },
  { id: "ddim", label: "经典 DDIM" }
];

const NAI_DEFAULT_PATH = "/ai/generate-image";
const OPENAI_DEFAULT_PATH = "/v1/images/generations";
const REFERENCE_PIXEL_COUNT = 1011712;
const SIGMA_MAGIC_V45 = 58;
const SIGMA_MAGIC = 19;

function resolveApiUrl(base, format, pathOverride) {
  let b = (base || "").trim().replace(/\/+$/, "");
  let path = (pathOverride || "").trim();
  if (!path) path = format === "nai" ? NAI_DEFAULT_PATH : OPENAI_DEFAULT_PATH;
  if (!/^https?:\/\//i.test(b) && b) b = "https://" + b;
  if (!b) throw new Error("请先在设置中填写中转站地址");
  path = "/" + path.replace(/^\/+/, "").replace(/\/+$/, "");
  if (b.includes("/ai/generate-image") && path === NAI_DEFAULT_PATH) return b;
  if (/\/v1$/.test(b) && path.startsWith("/v1/")) path = path.slice(3);
  return b + path;
}

function modelFamily(modelId) {
  const m = NAI_MODELS.find((x) => x.id === modelId);
  if (m) return m.family;
  if (/-4(-|\b)|v4/.test(modelId)) return 4;
  if (/-3(-|\b)|v3/.test(modelId)) return 3;
  return 0;
}

const IMAGE_MODEL_PATTERN = /(nai|diffusion|dall-?e|flux|stable|sd[0-9]|sdxl|seedream|kolors|cogview|gpt-image|image)/i;

function looksLikeImageModel(modelId) {
  return IMAGE_MODEL_PATTERN.test(String(modelId || ""));
}

function isV45(modelId) {
  return String(modelId).includes("nai-diffusion-4-5");
}

function samplersFor(modelId) {
  return isV45(modelId) || modelFamily(modelId) === 4 ? SAMPLERS_V45 : SAMPLERS_V3;
}

function composePrompt(rawPrompt, family, qualityOn, styleTags) {
  const parts = [rawPrompt.trim()];
  if (styleTags) parts.push(styleTags.trim());
  if (qualityOn && QUALITY_TAGS[family]) parts.push(QUALITY_TAGS[family]);
  return parts.filter(Boolean).join(", ");
}

function computeSkipCfgAboveSigma(width, height, modelId) {
  const magic = isV45(modelId) ? SIGMA_MAGIC_V45 : SIGMA_MAGIC;
  const ratio = (width * height) / REFERENCE_PIXEL_COUNT;
  return +(Math.pow(ratio, 0.5) * magic).toFixed(3);
}

function buildNaiPayload(p) {
  const family = modelFamily(p.model);
  const isV4 = family === 4;
  const finalPrompt = composePrompt(p.prompt, family, p.qualityOn, p.styleTags);
  const ucp = p.ucpOn && !p.negative.trim() ? UCP_PRESETS[family] : p.negative.trim();
  const action = p.action || "generate";
  const i2i = action === "img2img" || action === "inpaint";

  const params = {
    params_version: isV4 ? 3 : 2,
    width: p.width,
    height: p.height,
    scale: p.scale,
    sampler: p.sampler,
    steps: p.steps,
    seed: p.seed,
    n_samples: p.n,
    ucPreset: p.ucpOn ? 0 : 1,
    qualityToggle: p.qualityOn,
    autoSmea: false,
    dynamic_thresholding: false,
    controlnet_strength: 1,
    legacy: false,
    add_original_image: action !== "generate",
    cfg_rescale: p.cfgRescale,
    noise_schedule: p.noiseSchedule,
    legacy_v3_extend: false,
    skip_cfg_above_sigma: p.variety > 0 ? computeSkipCfgAboveSigma(p.width, p.height, p.model) : null,
    uncond_scale: 1,
    inpaintImg2ImgStrength: action === "inpaint" ? p.strength : 0
  };

  if (i2i) {
    params.image = p.imageB64;
    params.strength = p.strength;
    params.noise = action === "img2img" ? p.noise : 0;
    params.extra_noise_seed = Math.max(0, p.seed - 1);
    params.color_correct = false;
  }
  if (action === "inpaint") {
    params.mask = p.maskB64;
  }

  if (isV4) {
    params.deliberate_euler_ancestral_bug = false;
    params.prefer_brownian = true;
    const chars = (p.characters || []).filter((c) => c.prompt && c.prompt.trim());
    const useCoords = !!p.useCoords && chars.length > 0;
    const vibes = (p.vibes || []).filter((v) => v.b64);

    params.negative_prompt = ucp;
    params.use_coords = useCoords;
    params.normalize_reference_strength_multiple = false;
    params.legacy_uc = false;
    params.image_format = "png";
    params.reference_image_multiple = vibes.map((v) => v.b64);
    params.reference_information_extracted_multiple = vibes.map((v) => Number(v.infoExtracted ?? 1));
    params.reference_strength_multiple = vibes.map((v) => Number(v.referenceStrength ?? 0.6));

    params.characterPrompts = chars.map((c) => ({
      prompt: c.prompt.trim(),
      uc: (c.negative || "").trim(),
      center: { x: c.x, y: c.y },
      enabled: true
    }));

    params.v4_prompt = {
      caption: {
        base_caption: finalPrompt,
        char_captions: chars.map((c) => ({
          char_caption: c.prompt.trim(),
          centers: [{ x: c.x, y: c.y }]
        }))
      },
      use_coords: useCoords,
      use_order: !!p.useOrder
    };

    params.v4_negative_prompt = {
      caption: {
        base_caption: ucp,
        char_captions: chars.map((c) => ({
          char_caption: (c.negative || "").trim(),
          centers: [{ x: c.x, y: c.y }]
        }))
      },
      legacy_uc: false
    };
  } else {
    params.uc = ucp;
    params.sm = false;
    params.sm_dyn = false;
    const vibes = (p.vibes || []).filter((v) => v.b64);
    if (vibes.length) {
      params.reference_image = vibes[0].b64;
      params.reference_information_extracted = Number(vibes[0].infoExtracted ?? 1);
      params.reference_strength = Number(vibes[0].referenceStrength ?? 0.6);
    }
    const merged = (p.characters || [])
      .filter((c) => c.prompt && c.prompt.trim())
      .map((c) => c.prompt.trim());
    if (merged.length) {
      params.input = [finalPrompt].concat(merged).join(" | ");
    }
  }

  return {
    input: params.input || finalPrompt,
    model: p.model,
    action,
    parameters: params
  };
}

function buildOpenAiPayload(p) {
  const finalPrompt = composePrompt(p.prompt, 0, p.qualityOn, p.styleTags);
  const chars = (p.characters || []).filter((c) => c.prompt && c.prompt.trim());
  const promptText = chars.length
    ? [finalPrompt].concat(chars.map((c) => c.prompt.trim())).join(" | ")
    : finalPrompt;

  const ucp = p.ucpOn && !p.negative.trim() ? UCP_PRESETS[0] : p.negative.trim();
  const negChars = chars.map((c) => (c.negative || "").trim()).filter(Boolean);
  const negativeText = negChars.length
    ? [ucp].concat(negChars).join(" | ")
    : ucp;

  const body = {
    model: p.model,
    prompt: promptText,
    n: 1,
    size: `${p.width}x${p.height}`,
    response_format: "b64_json",
    steps: p.steps,
    guidance_scale: p.scale,
    seed: p.seed
  };
  if (negativeText) body.negative_prompt = negativeText;

  const action = p.action || "generate";
  if (action === "img2img" || action === "inpaint") {
    body.image = p.imageB64;
    body.strength = p.strength;
    if (action === "img2img") body.noise = p.noise;
    if (action === "inpaint" && p.maskB64) body.mask = p.maskB64;
  }
  return body;
}

async function readErrorResponse(res) {
  let detail = "";
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      detail = json.message || json.error && (json.error.message || json.error) || json.detail || text;
    } catch (e) {
      detail = text;
    }
  } catch (e) {}
  detail = String(detail || "").slice(0, 300);
  const statusMap = {
    400: "请求被拒绝 (400)",
    401: "API Key 无效或未授权 (401)",
    402: "余额不足，请检查中转站账户 (402)",
    403: "无权限访问该资源 (403)",
    404: "接口路径不存在 (404)，请检查 Base URL 与请求路径",
    429: "请求过于频繁或配额用尽 (429)"
  };
  const prefix = statusMap[res.status] || `请求失败 (${res.status})`;
  throw new Error(detail ? `${prefix}: ${detail}` : prefix);
}

function friendlyNetworkError(e) {
  if (e && e.name === "AbortError") return e;
  if (e instanceof TypeError) {
    return new Error("无法连接中转站：请检查地址拼写和网络；地址没错的话，通常是中转站未开启跨域 (CORS)，需联系服务商处理");
  }
  return e;
}

async function generateNai(cfg, payload, signal) {
  const url = resolveApiUrl(cfg.base, "nai", cfg.path);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${cfg.key}`,
        "accept": "application/x-zip-compressed, application/zip, application/json"
      },
      body: JSON.stringify(payload),
      signal
    });
  } catch (e) {
    throw friendlyNetworkError(e);
  }

  const ctype = res.headers.get("content-type") || "";
  if (!res.ok) {
    if (ctype.includes("application/json") || ctype.includes("text/plain") || ctype.includes("text/html")) {
      await readErrorResponse(res);
    }
    throw new Error(`请求失败 (${res.status})`);
  }
  if (ctype.includes("application/json")) {
    const json = await res.json();
    throw new Error(json.message || json.detail || "中转站返回了 JSON 而非图像数据，请确认接口格式选择正确");
  }

  const buffer = await res.arrayBuffer();
  const blobs = await extractPngsFromZip(buffer);
  if (!blobs.length) throw new Error("未能从响应中提取到 PNG 图像");
  return blobs;
}

async function generateOpenai(cfg, payload, signal) {
  const url = resolveApiUrl(cfg.base, "openai", cfg.path);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${cfg.key}`
      },
      body: JSON.stringify(payload),
      signal
    });
  } catch (e) {
    throw friendlyNetworkError(e);
  }

  const ctype = res.headers.get("content-type") || "";
  if (!res.ok && ctype.includes("json")) await readErrorResponse(res);
  if (!res.ok) throw new Error(`请求失败 (${res.status})`);
  if (!ctype.includes("json")) throw new Error("中转站返回了非 JSON 响应，请确认接口格式选择正确");

  const json = await res.json();
  const data = json.data || [];
  if (!data.length) throw new Error(json.error && json.error.message || "响应中没有图像数据");

  const blobs = [];
  for (const item of data) {
    if (item.b64_json) {
      const bin = atob(item.b64_json);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      blobs.push(new Blob([bytes], { type: "image/png" }));
    } else if (item.url) {
      let r;
      try {
        r = await fetch(item.url);
        if (!r.ok) r = await fetch(item.url, { headers: { "Authorization": `Bearer ${cfg.key}` } });
      } catch (e) {
        throw friendlyNetworkError(e);
      }
      if (!r.ok) throw new Error(`下载图像失败 (${r.status})`);
      blobs.push(await r.blob());
    }
  }
  if (!blobs.length) throw new Error("响应格式无法识别，缺少 b64_json 或 url 字段");
  return blobs;
}

async function requestGeneration(cfg, params, signal) {
  const payload = cfg.format === "openai" ? buildOpenAiPayload(params) : buildNaiPayload(params);
  return cfg.format === "openai" ? generateOpenai(cfg, payload, signal) : generateNai(cfg, payload, signal);
}

async function fetchModelList(cfg) {
  let b = (cfg.base || "").trim().replace(/\/+$/, "");
  if (!b) throw new Error("请先填写中转站地址");
  if (!/^https?:\/\//i.test(b)) b = "https://" + b;
  const url = /\/v1$/.test(b) ? b + "/models" : b + "/v1/models";
  let res;
  try {
    res = await fetch(url, { headers: { "Authorization": `Bearer ${cfg.key}` } });
  } catch (e) {
    throw friendlyNetworkError(e);
  }
  if (!res.ok) await readErrorResponse(res);
  const json = await res.json();
  const ids = (json.data || []).map((m) => m.id).filter(Boolean).sort();
  return ids;
}
