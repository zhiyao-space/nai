const $ = (id) => document.getElementById(id);

const LS_SETTINGS = "nai_clone_settings";
const LS_PARAMS = "nai_clone_params";
const LS_MODELS = "nai_clone_models";
const GEN_TIMEOUT_MS = 150000;

const SIZE_PRESETS = {
  portrait: { normal: [832, 1216], large: [1024, 1536] },
  landscape: { normal: [1216, 832], large: [1536, 1024] },
  square: { normal: [1024, 1024], large: [1472, 1472] }
};

const STYLES = [
  { id: "none", name: "默认", tags: "" },
  { id: "aesthetic", name: "精致动漫", tags: "very aesthetic, intricate details, beautiful illustration" },
  { id: "impasto", name: "厚涂油画", tags: "impasto, oil painting, painterly, thick brush strokes" },
  { id: "cyberpunk", name: "赛博朋克", tags: "cyberpunk, neon lights, futuristic cityscape, hologram" },
  { id: "watercolor", name: "水彩", tags: "watercolor painting, soft colors, paper texture" },
  { id: "photoreal", name: "写实摄影", tags: "photorealistic, photograph, 8k uhd, dslr" },
  { id: "ink", name: "水墨国风", tags: "ink wash painting, traditional chinese art, brush strokes" },
  { id: "pixel", name: "像素风", tags: "pixel art, 16-bit, retro game sprite" }
];

const DEFAULT_PARAMS = {
  model: "nai-diffusion-4-5-curated",
  sizePreset: "portrait",
  large: false,
  steps: 28,
  scale: 5,
  sampler: "k_euler",
  noiseSchedule: "karras",
  variety: 0,
  cfgRescale: 0,
  seed: "",
  n: 1,
  qualityOn: true,
  ucpOn: true,
  style: "none",
  prompt: "",
  negative: "",
  action: "generate",
  strength: 0.7,
  noise: 0,
  useCoords: false,
  useOrder: true,
  characters: []
};

const DEFAULT_SETTINGS = {
  base: "",
  key: "",
  format: "nai",
  path: "",
  model: "nai-diffusion-4-5-curated",
  customModel: "",
  artistBase: "https://danbooru.donmai.us",
  visionModel: ""
};

let settings = { ...DEFAULT_SETTINGS };
let params = { ...DEFAULT_PARAMS };
let generating = false;
let currentImage = null;
let genAbort = null;
let genCancelReason = "";
const objectUrls = new Map();

let sourceImage = null;
let maskStrokes = [];
let maskMode = "draw";
let maskDirty = false;

const VIBE_LIMIT = 5;
let vibes = [];

let relayModels = [];
let modelFilterText = "";
let modelImageOnly = false;
let modelSearchTimer = null;
let visionSearchTimer = null;

/* ---------- persistence ---------- */

function loadCachedModels() {
  try {
    const c = JSON.parse(localStorage.getItem(LS_MODELS) || "null");
    if (Array.isArray(c) && c.length) relayModels = c.filter((x) => typeof x === "string" && x.trim());
  } catch (e) {}
}

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_SETTINGS) || "null");
    if (s) settings = { ...DEFAULT_SETTINGS, ...s };
    const p = JSON.parse(localStorage.getItem(LS_PARAMS) || "null");
    if (p) params = { ...DEFAULT_PARAMS, ...p };
  } catch (e) {}
}

function saveSettings() {
  localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
}

function saveParams() {
  localStorage.setItem(LS_PARAMS, JSON.stringify(params));
}

/* ---------- mobile view switching ---------- */

function isMobileView() {
  return window.innerWidth < 1000;
}

function switchView(view) {
  document.body.classList.remove("view-creation", "view-canvas", "view-history");
  document.body.classList.add("view-" + view);
  for (const b of $("bottomNav").querySelectorAll(".nav-btn")) {
    b.classList.toggle("active", b.dataset.view === view);
  }
}

function bindBottomNav() {
  for (const b of $("bottomNav").querySelectorAll(".nav-btn")) {
    b.addEventListener("click", () => switchView(b.dataset.view));
  }
  switchView("creation");
}

function updateNavHistoryCount() {
  const n = document.querySelectorAll(".history-item").length;
  $("navHistoryCount").textContent = n ? String(n) : "";
}

/* ---------- toast ---------- */

let toastTimer = null;
function toast(msg, type = "", duration = 3500) {
  const el = $("toast");
  el.textContent = msg;
  el.className = "toast show " + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = "toast"; }, duration);
}

/* ---------- helpers ---------- */

function effectiveModel() {
  const custom = (settings.customModel || "").trim();
  return custom || settings.model || params.model;
}

function familyOf() {
  return modelFamily(effectiveModel());
}

function ucpText() {
  return UCP_PRESETS[familyOf()] || UCP_PRESETS[0];
}

function randomSeed() {
  return Math.floor(Math.random() * 4294967295);
}

/* ---------- left panel binding ---------- */

function bindPrompt() {
  $("promptInput").value = params.prompt;
  $("negativeInput").value = params.negative;
  $("qualityToggle").checked = params.qualityOn;
  $("ucpToggle").checked = params.ucpOn;
  updatePromptCount();
  updateNegativeCount();
  updateNegativePlaceholder();

  $("promptInput").addEventListener("input", () => {
    params.prompt = $("promptInput").value;
    updatePromptCount();
    saveParams();
  });
  $("negativeInput").addEventListener("input", () => {
    params.negative = $("negativeInput").value;
    updateNegativeCount();
    saveParams();
  });
  $("qualityToggle").addEventListener("change", () => {
    params.qualityOn = $("qualityToggle").checked;
    saveParams();
  });
  $("ucpToggle").addEventListener("change", () => {
    params.ucpOn = $("ucpToggle").checked;
    updateNegativePlaceholder();
    saveParams();
  });
  $("clearNegativeBtn").addEventListener("click", () => {
    $("negativeInput").value = "";
    params.negative = "";
    updateNegativeCount();
    saveParams();
  });
}

function updatePromptCount() {
  $("promptCount").textContent = String($("promptInput").value.length);
}

function updateNegativeCount() {
  $("negativeCount").textContent = String($("negativeInput").value.length);
}

function updateNegativePlaceholder() {
  const ta = $("negativeInput");
  if (!ta.value && params.ucpOn) {
    ta.placeholder = "留空就行，会自动排除模糊、低质量、水印等常见瑕疵";
  } else {
    ta.placeholder = "不想出现的东西，用逗号分隔";
  }
}

function relayModelLabel(id) {
  const m = NAI_MODELS.find((x) => x.id === id);
  return m ? m.name : id;
}

function appendModelOptions(sel, ids) {
  for (const id of ids) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = relayModelLabel(id);
    sel.appendChild(opt);
  }
}

function fillModelGroups(sel) {
  if (!relayModels.length) {
    const og = document.createElement("optgroup");
    og.label = "中转站模型";
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "保存设置后自动拉取模型列表";
    og.appendChild(opt);
    sel.appendChild(og);
    return;
  }
  const img = relayModels.filter(looksLikeImageModel);
  if (img.length && img.length < relayModels.length) {
    const og = document.createElement("optgroup");
    og.label = "图像模型";
    appendModelOptions(og, img);
    sel.appendChild(og);
    const og2 = document.createElement("optgroup");
    og2.label = "全部模型";
    appendModelOptions(og2, relayModels);
    sel.appendChild(og2);
  } else {
    const og = document.createElement("optgroup");
    og.label = "中转站模型";
    appendModelOptions(og, relayModels);
    sel.appendChild(og);
  }
}

async function refreshRelayModels(opts = {}) {
  const cfg = opts.cfg || { base: settings.base, key: settings.key };
  if (!(cfg.base || "").trim()) {
    if (opts.manual) toast("请先填写中转站地址", "warn");
    return;
  }
  try {
    const ids = await fetchModelList(cfg);
    relayModels = ids;
    try { localStorage.setItem(LS_MODELS, JSON.stringify(ids)); } catch (e) {}
    buildModelSelect();
    if (!$("settingsModal").classList.contains("hidden")) { fillApiModelSelect(); fillVisionModelSelect(); }
    if (!opts.silent) {
      const imgCount = ids.filter(looksLikeImageModel).length;
      toast(imgCount ? `已拉取 ${ids.length} 个模型，自动识别出 ${imgCount} 个绘画模型` : `已拉取 ${ids.length} 个中转站模型`, "ok");
    }
  } catch (e) {
    if (!opts.silent) toast("拉取模型列表失败: " + (e.message || e), "error", 5000);
  }
}

function bindModelSelectChange() {
  $("modelSelect").addEventListener("change", () => {
    const sel = $("modelSelect");
    if (!sel.value || !relayModels.includes(sel.value)) return;
    params.model = sel.value;
    settings.model = sel.value;
    if (settings.customModel) {
      settings.customModel = "";
      saveSettings();
      updateCustomModelHint();
      toast("已切换为所选模型", "ok");
    }
    populateSamplers(sel.value);
    updateNegativePlaceholder();
    updateVibeHints();
    saveParams();
  });
}

function buildModelSelect() {
  const sel = $("modelSelect");
  sel.innerHTML = "";
  fillModelGroups(sel);
  if (!relayModels.length) {
    const opt = document.createElement("option");
    opt.value = effectiveModel() || "nai-diffusion-4-5-curated";
    opt.textContent = `当前模型: ${effectiveModel() || "nai-diffusion-4-5-curated"}`;
    sel.appendChild(opt);
  }
  updateModelSelectView();
}

function populateSamplers(modelId) {
  const sel = $("samplerSelect");
  const list = samplersFor(settings.customModel && settings.customModel.trim() ? settings.model : modelId);
  sel.innerHTML = "";
  for (const s of list) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.label;
    sel.appendChild(opt);
  }
  if (!list.some((s) => s.id === params.sampler)) {
    params.sampler = list[0].id;
    saveParams();
  }
  sel.value = params.sampler;
}

function updateModelSelectView() {
  const sel = $("modelSelect");
  const custom = (settings.customModel || "").trim();
  let customOpt = sel.querySelector('option[value="__custom__"]');
  if (custom) {
    if (!customOpt) {
      customOpt = document.createElement("option");
      customOpt.value = "__custom__";
      sel.appendChild(customOpt);
    }
    customOpt.textContent = `自定义中转站模型: ${custom}`;
    sel.value = "__custom__";
  } else {
    if (customOpt) customOpt.remove();
    sel.value = params.model;
    if (!sel.value) sel.value = effectiveModel() || "nai-diffusion-4-5-curated";
  }
  updateCustomModelHint();
}

function updateCustomModelHint() {
  const hint = $("customModelHint");
  const custom = (settings.customModel || "").trim();
  if (custom) {
    hint.textContent = `正在使用中转站自定义模型: ${custom} (生成时优先生效)`;
    hint.classList.remove("hidden");
  } else {
    hint.classList.add("hidden");
  }
}

function bindSizeControls() {
  $("widthInput").value = params.width || SIZE_PRESETS[params.sizePreset].normal[0];
  $("heightInput").value = params.height || SIZE_PRESETS[params.sizePreset].normal[1];
  $("largeToggle").checked = params.large;

  const presetEl = $("sizePreset");
  for (const btn of presetEl.querySelectorAll("button")) {
    btn.classList.toggle("active", btn.dataset.preset === params.sizePreset);
    btn.addEventListener("click", () => {
      if (dimLocked()) {
        toast("照图改 / 局部重绘时尺寸跟随源图，请先移除源图或切回「凭空画」", "warn");
        return;
      }
      params.sizePreset = btn.dataset.preset;
      for (const b of presetEl.querySelectorAll("button")) {
        b.classList.toggle("active", b === btn);
      }
      applySizePreset();
      saveParams();
    });
  }

  $("largeToggle").addEventListener("change", () => {
    if (dimLocked()) {
      toast("照图改 / 局部重绘时尺寸跟随源图，请先移除源图或切回「凭空画」", "warn");
      $("largeToggle").checked = params.large;
      return;
    }
    params.large = $("largeToggle").checked;
    applySizePreset();
    saveParams();
  });

  $("widthInput").addEventListener("input", () => { params.width = clampDim($("widthInput").value); updateDimShow(); saveParams(); });
  $("heightInput").addEventListener("input", () => { params.height = clampDim($("heightInput").value); updateDimShow(); saveParams(); });
  $("swapSizeBtn").addEventListener("click", () => {
    const w = $("widthInput").value;
    $("widthInput").value = $("heightInput").value;
    $("heightInput").value = w;
    params.width = +$("widthInput").value;
    params.height = +$("heightInput").value;
    updateDimShow();
    saveParams();
  });
  updateDimShow();
}

function clampDim(v) {
  let n = Math.round(+v || 0);
  n = Math.max(64, Math.min(3072, n));
  return Math.round(n / 8) * 8;
}

function applySizePreset() {
  const dims = SIZE_PRESETS[params.sizePreset][params.large ? "large" : "normal"];
  params.width = dims[0];
  params.height = dims[1];
  $("widthInput").value = dims[0];
  $("heightInput").value = dims[1];
  updateDimShow();
}

function updateDimShow() {
  $("dimShow").textContent = `${$("widthInput").value || "?"} x ${$("heightInput").value || "?"}`;
}

function bindSliders() {
  const bind = (inputId, outId, key, transform) => {
    const inp = $(inputId);
    inp.value = params[key];
    $(outId).textContent = params[key];
    inp.addEventListener("input", () => {
      const v = transform ? transform(inp.value) : +inp.value;
      params[key] = v;
      $(outId).textContent = v;
      saveParams();
    });
  };
  bind("stepsInput", "stepsVal", "steps");
  bind("scaleInput", "scaleVal", "scale", (v) => +(+v).toFixed(1));
  bind("varietyInput", "varietyVal", "variety");
  bind("rescaleInput", "rescaleVal", "cfgRescale", (v) => +(+v).toFixed(2));

  populateSamplers(effectiveModel());
  $("samplerSelect").addEventListener("change", () => { params.sampler = $("samplerSelect").value; saveParams(); });
  $("noiseSelect").value = params.noiseSchedule;
  $("noiseSelect").addEventListener("change", () => { params.noiseSchedule = $("noiseSelect").value; saveParams(); });

  $("seedInput").value = params.seed ?? "";
  $("seedInput").addEventListener("input", () => { params.seed = $("seedInput").value === "" ? "" : Math.max(0, Math.floor(+$("seedInput").value || 0)); saveParams(); });
  $("diceBtn").addEventListener("click", () => {
    params.seed = randomSeed();
    $("seedInput").value = params.seed;
    saveParams();
  });
}

function bindCountSeg() {
  const seg = $("countSeg");
  for (const btn of seg.querySelectorAll("button")) {
    btn.classList.toggle("active", +btn.dataset.n === params.n);
    btn.addEventListener("click", () => {
      params.n = +btn.dataset.n;
      for (const b of seg.querySelectorAll("button")) {
        b.classList.toggle("active", b === btn);
      }
      updateVibeHints();
      saveParams();
    });
  }
}

function buildStyleGrid() {
  const grid = $("styleGrid");
  grid.innerHTML = "";
  for (const s of STYLES) {
    const el = document.createElement("div");
    el.className = "style-item" + (params.style === s.id ? " active" : "");
    el.textContent = s.name;
    el.title = s.tags || "无额外画风标签";
    el.addEventListener("click", () => {
      params.style = s.id;
      for (const c of grid.children) c.classList.toggle("active", c === el);
      saveParams();
    });
    grid.appendChild(el);
  }
}

function styleTags() {
  const s = STYLES.find((x) => x.id === params.style);
  return s ? s.tags : "";
}

/* ---------- action mode / img2img / inpaint ---------- */

function currentAction() {
  return params.action || "generate";
}

function bindActionSeg() {
  const seg = $("actionSeg");
  for (const btn of seg.querySelectorAll("button")) {
    btn.classList.toggle("active", btn.dataset.action === currentAction());
    btn.addEventListener("click", () => {
      params.action = btn.dataset.action;
      for (const b of seg.querySelectorAll("button")) {
        b.classList.toggle("active", b === btn);
      }
      updateActionPanels();
      saveParams();
    });
  }
  updateActionPanels();
}

function updateActionPanels() {
  const action = currentAction();
  const i2i = action === "img2img";
  const inpaint = action === "inpaint";
  for (const el of document.querySelectorAll(".i2i-panel")) {
    el.classList.toggle("hidden", action === "generate");
  }
  $("noisePanel").classList.toggle("hidden", !i2i);
  $("maskPanel").classList.toggle("hidden", !inpaint);
  updateDimLock();
  if (inpaint && sourceImage) initMaskCanvas();
}

function dimLocked() {
  return currentAction() !== "generate" && !!sourceImage;
}

function updateDimLock() {
  const locked = dimLocked();
  $("widthInput").disabled = locked;
  $("heightInput").disabled = locked;
  $("swapSizeBtn").disabled = locked;
}

function bindImageUpload() {
  const box = $("imageUploadBox");
  const input = $("imageFileInput");
  box.addEventListener("click", (e) => {
    if (e.target.closest("#removeSourceBtn")) return;
    input.click();
  });
  input.addEventListener("change", () => {
    if (input.files && input.files[0]) loadSourceFile(input.files[0]);
    input.value = "";
  });
  box.addEventListener("dragover", (e) => { e.preventDefault(); box.classList.add("dragover"); });
  box.addEventListener("dragleave", () => box.classList.remove("dragover"));
  box.addEventListener("drop", (e) => {
    e.preventDefault();
    box.classList.remove("dragover");
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && f.type.startsWith("image/")) loadSourceFile(f);
  });
  document.addEventListener("paste", (e) => {
    const item = e.clipboardData && Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
    if (!item) return;
    const file = item.getAsFile();
    if (currentAction() === "generate") {
      addVibeFiles([file]);
    } else {
      loadSourceFile(file);
    }
  });
  $("removeSourceBtn").addEventListener("click", () => {
    sourceImage = null;
    maskStrokes = [];
    $("uploadPreview").classList.add("hidden");
    $("uploadEmpty").classList.remove("hidden");
    $("sourcePreviewImg").removeAttribute("src");
    $("maskBaseImg").classList.add("hidden");
    updateDimLock();
    initMaskCanvas();
    toast("已移除源图", "ok");
  });

  $("strengthInput").value = params.strength;
  $("strengthVal").textContent = (+params.strength).toFixed(2);
  $("strengthInput").addEventListener("input", () => {
    params.strength = +$("strengthInput").value;
    $("strengthVal").textContent = params.strength.toFixed(2);
    saveParams();
  });
  $("noiseInput").value = params.noise;
  $("noiseVal").textContent = (+params.noise).toFixed(2);
  $("noiseInput").addEventListener("input", () => {
    params.noise = +$("noiseInput").value;
    $("noiseVal").textContent = params.noise.toFixed(2);
    saveParams();
  });
}

function loadSourceFile(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const scaled = await downscaleToMax(String(reader.result), 1536);
      sourceImage = {
        b64: scaled.dataUrl.split(",")[1] || "",
        dataUrl: scaled.dataUrl,
        w: scaled.w,
        h: scaled.h
      };
      maskStrokes = [];
      $("sourcePreviewImg").src = scaled.dataUrl;
      $("maskBaseImg").src = scaled.dataUrl;
      $("maskBaseImg").classList.remove("hidden");
      $("uploadPreview").classList.remove("hidden");
      $("uploadEmpty").classList.add("hidden");
      params.width = scaled.w;
      params.height = scaled.h;
      $("widthInput").value = scaled.w;
      $("heightInput").value = scaled.h;
      updateDimShow();
      updateDimLock();
      saveParams();
      initMaskCanvas();
      toast(`源图已加载 ${scaled.w}x${scaled.h}，尺寸已同步（大图已自动压缩）`, "ok");
    } catch (e) {
      toast("图片读取失败", "error");
    }
  };
  reader.onerror = () => toast("图片读取失败", "error");
  reader.readAsDataURL(file);
}

function fitDims64(w, h, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  return {
    w: Math.max(64, Math.round((w * scale) / 64) * 64),
    h: Math.max(64, Math.round((h * scale) / 64) * 64)
  };
}

function downscaleToMax(dataUrl, maxSide) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const t = fitDims64(img.naturalWidth, img.naturalHeight, maxSide);
      if (t.w === img.naturalWidth && t.h === img.naturalHeight) {
        resolve({ dataUrl, w: t.w, h: t.h });
        return;
      }
      const off = document.createElement("canvas");
      off.width = t.w;
      off.height = t.h;
      off.getContext("2d").drawImage(img, 0, 0, t.w, t.h);
      resolve({ dataUrl: off.toDataURL("image/png"), w: t.w, h: t.h });
    };
    img.onerror = () => reject(new Error("图片解码失败"));
    img.src = dataUrl;
  });
}

function initMaskCanvas() {
  const base = $("maskBaseImg");
  const canvas = $("maskCanvas");
  if (!base.src) { canvas.width = 0; canvas.height = 0; return; }
  const draw = () => {
    canvas.width = base.clientWidth || 372;
    canvas.height = base.clientHeight || Math.round((372 * base.naturalHeight) / (base.naturalWidth || 1));
    redrawMask();
  };
  if (base.complete && base.naturalWidth) draw();
  else base.onload = draw;
}

function redrawMask() {
  const canvas = $("maskCanvas");
  if (!canvas.width) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(120, 90, 220, 0.45)";
  for (const s of maskStrokes) {
    ctx.strokeStyle = s.mode === "erase" ? "rgba(0,0,0,1)" : "rgba(141, 123, 245, 0.55)";
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = s.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation = s.mode === "erase" ? "destination-out" : "source-over";
    ctx.beginPath();
    s.points.forEach((pt, i) => {
      const x = pt.x * canvas.width;
      const y = pt.y * canvas.height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    if (s.points.length === 1) {
      ctx.lineTo(s.points[0].x * canvas.width + 0.1, s.points[0].y * canvas.height);
    }
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";
}

function bindMaskEditor() {
  const canvas = $("maskCanvas");
  let drawing = false;
  let current = null;

  const norm = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };

  canvas.addEventListener("pointerdown", (e) => {
    if (currentAction() !== "inpaint" || !sourceImage) return;
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    current = { mode: maskMode, size: +$("brushSizeInput").value, points: [norm(e)], displayWidth: canvas.width };
    maskStrokes.push(current);
    redrawMask();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drawing || !current) return;
    current.points.push(norm(e));
    redrawMask();
  });
  const finish = () => { drawing = false; current = null; };
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointerleave", finish);

  for (const btn of $("maskModeSeg").querySelectorAll("button")) {
    btn.addEventListener("click", () => {
      maskMode = btn.dataset.mode;
      for (const b of $("maskModeSeg").querySelectorAll("button")) {
        b.classList.toggle("active", b === btn);
      }
    });
  }
  $("brushSizeInput").addEventListener("input", () => {
    $("brushVal").textContent = $("brushSizeInput").value;
  });
  $("clearMaskBtn").addEventListener("click", () => {
    maskStrokes = [];
    redrawMask();
  });
  window.addEventListener("resize", () => {
    if (currentAction() === "inpaint") initMaskCanvas();
  });
}

function exportMaskB64() {
  if (!sourceImage || !maskStrokes.length) return null;
  const off = document.createElement("canvas");
  off.width = sourceImage.w;
  off.height = sourceImage.h;
  const ctx = off.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, off.width, off.height);
  ctx.strokeStyle = "#fff";
  ctx.fillStyle = "#fff";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of maskStrokes) {
    if (s.mode === "erase") continue;
    ctx.lineWidth = (s.size / (s.displayWidth || off.width)) * off.width;
    ctx.beginPath();
    s.points.forEach((pt, i) => {
      const x = pt.x * off.width;
      const y = pt.y * off.height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    if (s.points.length === 1) ctx.lineTo(s.points[0].x * off.width + 0.1, s.points[0].y * off.height);
    ctx.stroke();
  }
  return off.toDataURL("image/png").split(",")[1];
}

/* ---------- character prompts ---------- */

function bindCharacterPrompts() {
  $("useCoordsToggle").checked = params.useCoords;
  $("useOrderToggle").checked = params.useOrder;
  $("useCoordsToggle").addEventListener("change", () => { params.useCoords = $("useCoordsToggle").checked; saveParams(); });
  $("useOrderToggle").addEventListener("change", () => { params.useOrder = $("useOrderToggle").checked; saveParams(); });
  $("addCharacterBtn").addEventListener("click", () => {
    params.characters.push({ id: crypto.randomUUID(), prompt: "", negative: "", x: 0.5, y: 0.5 });
    renderCharacterList();
    saveParams();
  });
  renderCharacterList();
}

function renderCharacterList() {
  const list = $("characterList");
  list.innerHTML = "";
  if (!params.characters.length) return;
  params.characters.forEach((c, idx) => {
    const card = document.createElement("div");
    card.className = "char-card";

    const head = document.createElement("div");
    head.className = "char-card-head";
    const label = document.createElement("span");
    label.textContent = `角色 ${idx + 1}`;
    const del = document.createElement("button");
    del.className = "icon-btn sm";
    del.title = "删除角色";
    del.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    del.addEventListener("click", () => {
      params.characters.splice(idx, 1);
      renderCharacterList();
      saveParams();
    });
    head.appendChild(label);
    head.appendChild(del);
    card.appendChild(head);

    const ta = document.createElement("textarea");
    ta.value = c.prompt;
    ta.placeholder = "这个角色长什么样，如: 银发少女，红瞳，JK 制服";
    ta.addEventListener("input", () => { c.prompt = ta.value; saveParams(); });
    card.appendChild(ta);

    const neg = document.createElement("input");
    neg.type = "text";
    neg.className = "char-negative";
    neg.value = c.negative || "";
    neg.placeholder = "这个角色要避免的 (可不填)";
    neg.addEventListener("input", () => { c.negative = neg.value; saveParams(); });
    card.appendChild(neg);

    const coords = document.createElement("div");
    coords.className = "char-coords";
    for (const axis of ["x", "y"]) {
      const wrap = document.createElement("div");
      wrap.className = "coord";
      const lab = document.createElement("label");
      lab.innerHTML = `${axis === "x" ? "左右位置" : "上下位置"} <output>${Math.round((c[axis] ?? 0.5) * 100)}%</output>`;
      const inp = document.createElement("input");
      inp.type = "range";
      inp.min = "0";
      inp.max = "100";
      inp.value = Math.round((c[axis] ?? 0.5) * 100);
      inp.addEventListener("input", () => {
        c[axis] = +inp.value / 100;
        lab.querySelector("output").textContent = `${inp.value}%`;
        saveParams();
      });
      wrap.appendChild(lab);
      wrap.appendChild(inp);
      coords.appendChild(wrap);
    }
    card.appendChild(coords);
    list.appendChild(card);
  });
}

/* ---------- vibe transfer ---------- */

function bindVibeTransfer() {
  const box = $("vibeUploadBox");
  const input = $("vibeFileInput");
  box.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    if (input.files && input.files.length) addVibeFiles(Array.from(input.files));
    input.value = "";
  });
  box.addEventListener("dragover", (e) => { e.preventDefault(); box.classList.add("dragover"); });
  box.addEventListener("dragleave", () => box.classList.remove("dragover"));
  box.addEventListener("drop", (e) => {
    e.preventDefault();
    box.classList.remove("dragover");
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) addVibeFiles(Array.from(files).filter((f) => f.type.startsWith("image/")));
  });
  renderVibeList();
}

function addVibeFiles(files) {
  const room = VIBE_LIMIT - vibes.length;
  if (room <= 0) {
    toast(`氛围图最多 ${VIBE_LIMIT} 张`, "warn");
    return;
  }
  const list = files.filter(Boolean).slice(0, room);
  if (files.length > room) toast(`氛围图最多 ${VIBE_LIMIT} 张，已截取前 ${room} 张`, "warn");
  if (!list.length) return;
  let pending = list.length;
  const done = () => {
    pending--;
    if (pending <= 0) renderVibeList();
  };
  for (const file of list) {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const scaled = await downscaleToMax(String(reader.result), 1024);
        vibes.push({
          id: crypto.randomUUID(),
          b64: scaled.dataUrl.split(",")[1] || "",
          dataUrl: scaled.dataUrl,
          infoExtracted: 1,
          referenceStrength: 0.6
        });
      } catch (e) {
        toast("图片读取失败", "error");
      }
      done();
    };
    reader.onerror = () => { toast("图片读取失败", "error"); done(); };
    reader.readAsDataURL(file);
  }
}

function buildVibeSlider(vibe, key, label) {
  const wrap = document.createElement("div");
  wrap.className = "field slider-field";
  const lab = document.createElement("label");
  const text = document.createElement("span");
  text.textContent = label;
  const out = document.createElement("output");
  out.textContent = (+vibe[key]).toFixed(2);
  lab.appendChild(text);
  lab.appendChild(out);
  const inp = document.createElement("input");
  inp.type = "range";
  inp.min = "0";
  inp.max = "1";
  inp.step = "0.01";
  inp.value = vibe[key];
  inp.addEventListener("input", () => {
    vibe[key] = +inp.value;
    out.textContent = (+inp.value).toFixed(2);
  });
  wrap.appendChild(lab);
  wrap.appendChild(inp);
  return wrap;
}

function renderVibeList() {
  const list = $("vibeList");
  list.innerHTML = "";
  vibes.forEach((v, idx) => {
    const card = document.createElement("div");
    card.className = "vibe-card";

    const head = document.createElement("div");
    head.className = "vibe-card-head";
    const label = document.createElement("span");
    label.textContent = `氛围 ${idx + 1}`;
    const del = document.createElement("button");
    del.className = "icon-btn sm";
    del.title = "移除氛围图";
    del.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    del.addEventListener("click", () => {
      vibes.splice(idx, 1);
      renderVibeList();
    });
    head.appendChild(label);
    head.appendChild(del);
    card.appendChild(head);

    const thumb = document.createElement("img");
    thumb.className = "vibe-thumb";
    thumb.src = v.dataUrl;
    thumb.alt = "氛围参考图";
    card.appendChild(thumb);

    card.appendChild(buildVibeSlider(v, "infoExtracted", "信息提取 (Information Extracted)"));
    card.appendChild(buildVibeSlider(v, "referenceStrength", "参考强度 (Reference Strength)"));
    list.appendChild(card);
  });
  updateVibeHints();
}

function updateVibeHints() {
  const hint = $("vibeHint");
  const msgs = [];
  if (settings.format === "openai" && vibes.length) {
    msgs.push("当前为 OpenAI 兼容格式：生成时自动尝试官方 NAI 通道，不支持则忽略氛围图");
  }
  if (familyOf() === 3 && vibes.length > 1) {
    msgs.push("V3 模型仅支持 1 张氛围图，生成时只使用第 1 张");
  }
  const full = vibes.length >= VIBE_LIMIT;
  $("vibeUploadBox").classList.toggle("hidden", full);
  if (full) msgs.push(`已达上限 ${VIBE_LIMIT} 张，移除一张后可继续添加`);
  hint.textContent = msgs.join(" · ");
  hint.classList.toggle("hidden", !msgs.length);
}

/* ---------- artist library ---------- */

const LS_ARTIST_FAVS = "nai_clone_artist_favs";
let artistFavs = [];
const artistPreviewCache = new Map();
let artistSearchTimer = null;
let artistSearchSeq = 0;

function loadArtistFavs() {
  try {
    const f = JSON.parse(localStorage.getItem(LS_ARTIST_FAVS) || "[]");
    artistFavs = Array.isArray(f) ? f.filter((x) => x && x.name) : [];
  } catch (e) {
    artistFavs = [];
  }
}

function saveArtistFavs() {
  localStorage.setItem(LS_ARTIST_FAVS, JSON.stringify(artistFavs));
}

function formatArtistCount(n) {
  if (n == null) return "≈";
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, "") + "w";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

function insertArtistTag(name) {
  const ta = $("promptInput");
  const parts = ta.value.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.some((p) => p.toLowerCase() === name.toLowerCase())) {
    toast("该画师已在提示词中", "warn");
    return false;
  }
  parts.push(name);
  ta.value = parts.join(", ");
  params.prompt = ta.value;
  updatePromptCount();
  saveParams();
  toast("已插入画师串: " + name, "ok");
  return true;
}

function bindArtistLibrary() {
  loadArtistFavs();
  renderArtistFavs();

  const input = $("artistSearch");
  input.addEventListener("input", () => {
    const q = input.value.trim();
    clearTimeout(artistSearchTimer);
    artistSearchTimer = setTimeout(() => runArtistSearch(q), 400);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      clearTimeout(artistSearchTimer);
      runArtistSearch(input.value.trim());
    }
  });
  $("clearArtistFavsBtn").addEventListener("click", () => {
    if (!artistFavs.length) return;
    artistFavs = [];
    saveArtistFavs();
    renderArtistFavs();
    toast("已清空收藏", "ok");
  });
}

function runArtistSearch(q) {
  const results = $("artistResults");
  const hint = $("artistHint");
  const seq = ++artistSearchSeq;
  if (!q) {
    results.innerHTML = "";
    hint.classList.add("hidden");
    return;
  }
  results.innerHTML = '<div class="artist-empty">搜索中…</div>';
  hint.classList.add("hidden");
  fetchArtistTags(settings.artistBase, q)
    .catch(() => {
      hint.textContent = "画师库连接失败，已切换到内置离线合集 (可在设置里换画师库地址)";
      hint.classList.remove("hidden");
      return filterOfflineArtists(q);
    })
    .then((list) => {
      if (seq !== artistSearchSeq) return;
      if (!list.length) {
        results.innerHTML = '<div class="artist-empty">没有找到画师，换个关键词试试</div>';
        return;
      }
      results.innerHTML = "";
      for (const a of list) {
        results.appendChild(buildArtistRow(a));
      }
    });
}

function buildArtistRow(a) {
  const row = document.createElement("div");
  row.className = "artist-row";

  const line = document.createElement("div");
  line.className = "artist-row-line";

  const name = document.createElement("button");
  name.className = "artist-name";
  name.textContent = a.name;
  name.title = "插入到主提示词";
  name.addEventListener("click", () => insertArtistTag(a.name));
  line.appendChild(name);

  if (a.note) {
    const note = document.createElement("span");
    note.className = "artist-note";
    note.textContent = a.note;
    line.appendChild(note);
  }

  const count = document.createElement("span");
  count.className = "artist-count";
  count.textContent = formatArtistCount(a.post_count);
  count.title = a.post_count == null ? "离线合集 (无作品计数)" : "Danbooru 作品数 " + a.post_count;
  line.appendChild(count);

  const previewBtn = document.createElement("button");
  previewBtn.className = "icon-btn sm";
  previewBtn.title = "预览代表图";
  previewBtn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  previewBtn.addEventListener("click", () => toggleArtistPreview(a.name));
  line.appendChild(previewBtn);

  const favBtn = document.createElement("button");
  favBtn.className = "icon-btn sm" + (isArtistFav(a.name) ? " fav-on" : "");
  favBtn.title = isArtistFav(a.name) ? "取消收藏" : "收藏画师";
  favBtn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
  favBtn.addEventListener("click", () => toggleArtistFav(a.name, a.post_count, favBtn));
  line.appendChild(favBtn);

  const thumbs = document.createElement("div");
  thumbs.className = "artist-thumbs hidden";
  thumbs.dataset.tag = a.name;

  row.appendChild(line);
  row.appendChild(thumbs);
  return row;
}

function toggleArtistPreview(tag) {
  const thumbs = $("artistResults").querySelector('.artist-thumbs[data-tag="' + CSS.escape(tag) + '"]');
  if (!thumbs) return;
  if (!thumbs.classList.contains("hidden")) {
    thumbs.classList.add("hidden");
    return;
  }
  if (artistPreviewCache.has(tag)) {
    renderArtistThumbs(thumbs, artistPreviewCache.get(tag));
    thumbs.classList.remove("hidden");
    return;
  }
  thumbs.innerHTML = '<div class="artist-thumb-loading">加载代表图…</div>';
  thumbs.classList.remove("hidden");
  fetchArtistPreview(settings.artistBase, tag)
    .then((urls) => {
      artistPreviewCache.set(tag, urls);
      renderArtistThumbs(thumbs, urls);
    })
    .catch(() => {
      thumbs.innerHTML = '<div class="artist-thumb-loading">代表图加载失败</div>';
    });
}

function renderArtistThumbs(el, urls) {
  el.innerHTML = "";
  if (!urls.length) {
    el.innerHTML = '<div class="artist-thumb-loading">没有可用代表图</div>';
    return;
  }
  for (const url of urls) {
    const img = document.createElement("img");
    img.className = "artist-thumb";
    img.src = url;
    img.loading = "lazy";
    img.alt = "代表图";
    img.addEventListener("error", () => img.remove());
    el.appendChild(img);
  }
}

function isArtistFav(name) {
  return artistFavs.some((f) => f.name === name);
}

function toggleArtistFav(name, postCount, btn) {
  if (isArtistFav(name)) {
    artistFavs = artistFavs.filter((f) => f.name !== name);
    toast("已取消收藏: " + name);
  } else {
    artistFavs.unshift({ name, postCount: postCount == null ? null : postCount });
    toast("已收藏画师: " + name, "ok");
  }
  saveArtistFavs();
  renderArtistFavs();
  if (btn) {
    const on = isArtistFav(name);
    btn.classList.toggle("fav-on", on);
    btn.title = on ? "取消收藏" : "收藏画师";
  }
}

function renderArtistFavs() {
  const wrap = $("artistFavs");
  const block = $("artistFavBlock");
  block.classList.toggle("hidden", !artistFavs.length);
  wrap.innerHTML = "";
  for (const f of artistFavs) {
    const chip = document.createElement("div");
    chip.className = "artist-fav-chip";
    const b = document.createElement("button");
    b.className = "artist-fav-name";
    b.textContent = f.name;
    b.title = "插入到主提示词";
    b.addEventListener("click", () => insertArtistTag(f.name));
    const del = document.createElement("button");
    del.className = "icon-btn sm";
    del.title = "移除收藏";
    del.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    del.addEventListener("click", () => {
      artistFavs = artistFavs.filter((x) => x.name !== f.name);
      saveArtistFavs();
      renderArtistFavs();
    });
    chip.appendChild(b);
    chip.appendChild(del);
    wrap.appendChild(chip);
  }
}

/* ---------- canvas ---------- */

function showImage(rec) {
  let url = objectUrls.get(rec.id);
  if (!url) {
    url = URL.createObjectURL(rec.blob);
    objectUrls.set(rec.id, url);
  }
  currentImage = rec;
  const img = $("mainImage");
  img.src = url;
  img.classList.remove("hidden");
  $("canvasEmpty").classList.add("hidden");
  $("canvasBar").classList.remove("hidden");
  const m = rec.meta || {};
  const actionLabel = m.action === "img2img" ? "照图改" : m.action === "inpaint" ? "局部重绘" : "";
  $("imageMeta").textContent = [
    actionLabel,
    m.w && m.h ? `${m.w} x ${m.h}` : "",
    m.model || "",
    m.steps ? `步数 ${m.steps}` : "",
    m.scale != null ? `引导 ${m.scale}` : "",
    m.seed != null ? `编号 ${m.seed}` : ""
  ].filter(Boolean).join(" · ");
  for (const el of document.querySelectorAll(".history-item")) {
    el.classList.toggle("active", el.dataset.id === rec.id);
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- history ---------- */

async function loadHistory() {
  try {
    const all = await dbAll();
    all.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    const grid = $("historyGrid");
    grid.innerHTML = "";
    if (!all.length) {
      grid.innerHTML = '<div class="history-empty">暂无历史记录</div>';
      $("historyCount").textContent = "";
      return;
    }
    for (const rec of all.slice(0, 100)) {
      grid.appendChild(buildHistoryItem(rec));
    }
    $("historyCount").textContent = `(${all.length})`;
    if (all.length > 100) {
      for (const old of all.slice(100)) dbDelete(old.id).catch(() => {});
    }
    updateNavHistoryCount();
  } catch (e) {
    console.error(e);
  }
}

async function removeRecord(rec, el) {
  await dbDelete(rec.id);
  if (objectUrls.has(rec.id)) { URL.revokeObjectURL(objectUrls.get(rec.id)); objectUrls.delete(rec.id); }
  if (el) el.remove();
  if (currentImage && currentImage.id === rec.id) {
    $("mainImage").classList.add("hidden");
    $("canvasBar").classList.add("hidden");
    $("canvasEmpty").classList.remove("hidden");
    currentImage = null;
  }
  const remaining = $("historyGrid").querySelectorAll(".history-item").length;
  $("historyCount").textContent = remaining ? `(${remaining})` : "";
  updateNavHistoryCount();
  if (!remaining) $("historyGrid").innerHTML = '<div class="history-empty">暂无历史记录</div>';
}

function buildHistoryItem(rec) {
  const el = document.createElement("div");
  el.className = "history-item" + (currentImage && currentImage.id === rec.id ? " active" : "");
  el.dataset.id = rec.id;
  const img = document.createElement("img");
  let url = objectUrls.get(rec.id);
  if (!url) {
    url = URL.createObjectURL(rec.blob);
    objectUrls.set(rec.id, url);
  }
  img.src = url;
  img.loading = "lazy";
  el.appendChild(img);

  const actions = document.createElement("div");
  actions.className = "hover-actions";

  const reuse = document.createElement("button");
  reuse.className = "icon-btn";
  reuse.title = "复用参数";
  reuse.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>';
  reuse.addEventListener("click", (e) => { e.stopPropagation(); reuseParams(rec.meta); });

  const dl = document.createElement("button");
  dl.className = "icon-btn";
  dl.title = "下载";
  dl.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
  dl.addEventListener("click", (e) => { e.stopPropagation(); downloadImage(rec); });

  const del = document.createElement("button");
  del.className = "icon-btn";
  del.title = "删除";
  del.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
  del.addEventListener("click", async (e) => {
    e.stopPropagation();
    await removeRecord(rec, el);
  });

  actions.appendChild(reuse);
  actions.appendChild(dl);
  actions.appendChild(del);
  el.appendChild(actions);

  el.addEventListener("click", () => {
    showImage(rec);
    if (isMobileView()) switchView("canvas");
  });
  return el;
}

function reuseParams(meta) {
  if (!meta) { toast("该记录缺少参数信息", "warn"); return; }
  if (meta.prompt != null) { params.prompt = meta.prompt; $("promptInput").value = meta.prompt; updatePromptCount(); }
  if (meta.negative != null) { params.negative = meta.negative; $("negativeInput").value = meta.negative; }
  if (meta.steps) { params.steps = meta.steps; $("stepsInput").value = meta.steps; $("stepsVal").textContent = meta.steps; }
  if (meta.scale != null) { params.scale = meta.scale; $("scaleInput").value = meta.scale; $("scaleVal").textContent = meta.scale; }
  if (meta.sampler) { params.sampler = meta.sampler; $("samplerSelect").value = meta.sampler; }
  if (meta.noiseSchedule) { params.noiseSchedule = meta.noiseSchedule; $("noiseSelect").value = meta.noiseSchedule; }
  if (meta.w && meta.h) {
    params.width = meta.w;
    params.height = meta.h;
    $("widthInput").value = meta.w;
    $("heightInput").value = meta.h;
    updateDimShow();
  }
  if (meta.seed != null && meta.seed !== "") { params.seed = meta.seed; $("seedInput").value = meta.seed; }
  if (meta.qualityOn != null) { params.qualityOn = meta.qualityOn; $("qualityToggle").checked = meta.qualityOn; }
  if (meta.ucpOn != null) { params.ucpOn = meta.ucpOn; $("ucpToggle").checked = meta.ucpOn; }
  if (meta.model) {
    const known = relayModels.includes(meta.model) || NAI_MODELS.some((m) => m.id === meta.model);
    if (known) {
      params.model = meta.model;
      settings.model = meta.model;
      settings.customModel = "";
      populateSamplers(meta.model);
      updateModelSelectView();
    } else {
      settings.customModel = meta.model;
      settings.model = meta.model;
      updateModelSelectView();
    }
    saveSettings();
    updateNegativePlaceholder();
  }
  if (meta.action) {
    params.action = meta.action;
    for (const b of $("actionSeg").querySelectorAll("button")) {
      b.classList.toggle("active", b.dataset.action === meta.action);
    }
    updateActionPanels();
  }
  if (meta.strength != null) {
    params.strength = meta.strength;
    $("strengthInput").value = meta.strength;
    $("strengthVal").textContent = meta.strength.toFixed(2);
  }
  if (meta.noise != null) {
    params.noise = meta.noise;
    $("noiseInput").value = meta.noise;
    $("noiseVal").textContent = meta.noise.toFixed(2);
  }
  if (Array.isArray(meta.characters) && meta.characters.length) {
    params.characters = meta.characters.map((c) => ({
      id: crypto.randomUUID(),
      prompt: c.prompt || "",
      negative: c.negative || "",
      x: c.x ?? 0.5,
      y: c.y ?? 0.5
    }));
    renderCharacterList();
  }
  if (meta.useCoords != null) {
    params.useCoords = meta.useCoords;
    $("useCoordsToggle").checked = meta.useCoords;
  }
  if (meta.useOrder != null) {
    params.useOrder = meta.useOrder;
    $("useOrderToggle").checked = meta.useOrder;
  }
  if (Array.isArray(meta.vibes) && meta.vibes.length) {
    vibes = meta.vibes
      .filter((v) => v.b64)
      .map((v) => ({
        id: crypto.randomUUID(),
        b64: v.b64,
        dataUrl: "data:image/png;base64," + v.b64,
        infoExtracted: v.infoExtracted ?? 1,
        referenceStrength: v.referenceStrength ?? 0.6
      }));
    renderVibeList();
  }
  updateVibeHints();
  saveParams();
  if (isMobileView()) switchView("creation");
  toast(meta.action && meta.action !== "generate" ? "已复用该图的生成参数 (源图未保留，请重新上传)" : "已复用该图的生成参数", "ok");
}

function downloadImage(rec) {
  const m = rec.meta || {};
  const seedPart = m.seed != null ? `_${m.seed}` : "";
  const sizePart = m.w && m.h ? `_${m.w}x${m.h}` : "";
  downloadBlob(rec.blob, `NovelAI${sizePart}${seedPart}.png`);
}

/* ---------- generation ---------- */

function collectParams() {
  const model = effectiveModel();
  const seed = params.seed === "" || params.seed == null ? randomSeed() : params.seed;
  const action = currentAction();
  return {
    prompt: params.prompt,
    negative: params.negative,
    model,
    width: +$("widthInput").value,
    height: +$("heightInput").value,
    steps: params.steps,
    scale: params.scale,
    sampler: params.sampler,
    noiseSchedule: params.noiseSchedule,
    variety: params.variety,
    cfgRescale: params.cfgRescale,
    seed,
    n: params.n,
    qualityOn: params.qualityOn,
    ucpOn: params.ucpOn,
    styleTags: styleTags(),
    action,
    strength: params.strength,
    noise: params.noise,
    imageB64: sourceImage ? sourceImage.b64 : null,
    maskB64: action === "inpaint" ? exportMaskB64() : null,
    characters: params.characters.map((c) => ({
      prompt: c.prompt,
      negative: c.negative,
      x: c.x ?? 0.5,
      y: c.y ?? 0.5
    })),
    useCoords: params.useCoords,
    useOrder: params.useOrder,
    vibes: vibes.map((v) => ({
      b64: v.b64,
      infoExtracted: v.infoExtracted,
      referenceStrength: v.referenceStrength
    }))
  };
}

function setGenerating(on) {
  generating = on;
  $("generateBtn").disabled = on;
  $("generateLabel").textContent = on ? "生成中…" : "生成图像";
  $("generatingOverlay").classList.toggle("hidden", !on);
}

function buildMeta(p) {
  return {
    prompt: p.prompt,
    negative: p.negative,
    model: p.model,
    w: p.width,
    h: p.height,
    steps: p.steps,
    scale: p.scale,
    sampler: p.sampler,
    stylePreset: p.stylePresetName || null,
    noiseSchedule: p.noiseSchedule,
    seed: p.seed,
    qualityOn: p.qualityOn,
    ucpOn: p.ucpOn,
    format: settings.format,
    action: p.action,
    strength: p.strength,
    noise: p.noise,
    characters: p.characters,
    useCoords: p.useCoords,
    useOrder: p.useOrder
  };
}

async function generate() {
  if (generating) return;
  if (!settings.base.trim()) {
    openSettings();
    toast("请先配置中转站 API 地址与密钥", "warn");
    return;
  }
  const action = currentAction();
  if ((action === "img2img" || action === "inpaint") && !sourceImage) {
    toast("请先上传源图像 (点击源图像框 / 拖拽 / Ctrl+V 粘贴)", "warn");
    return;
  }
  if (action === "inpaint" && !maskStrokes.length) {
    toast("请先在蒙版画布上涂抹需要重绘的区域", "warn");
    return;
  }
  const model = effectiveModel();
  if (action === "inpaint") {
    if (modelFamily(model) === 3 && model !== "nai-diffusion-3-inpainting") {
      params.model = "nai-diffusion-3-inpainting";
      settings.model = params.model;
      settings.customModel = "";
      saveSettings();
      updateModelSelectView();
      toast("V3 局部重绘需要 Inpainting 模型，已自动切换", "warn");
    } else if (isV45(model) && !model.includes("inpainting")) {
      params.model = "nai-diffusion-4-5-inpainting";
      settings.model = params.model;
      settings.customModel = "";
      saveSettings();
      updateModelSelectView();
      toast("已自动切换为 V4.5 Inpainting 重绘模型", "warn");
    }
  }
  const p = collectParams();
  const activePreset = getActiveStylePreset();
  if (activePreset) applyStylePreset(p, activePreset);
  if (!p.prompt.trim() && !p.characters.some((c) => c.prompt.trim())) {
    toast("请先输入提示词 (Prompt) 或角色提示词", "warn");
    return;
  }
  saveSettings();
  setGenerating(true);
  if (isMobileView()) switchView("canvas");
  genAbort = new AbortController();
  genCancelReason = "";
  let timeoutTimer = setTimeout(() => cancelGeneration("timeout"), GEN_TIMEOUT_MS);
  const runBatch = async (cfg) => {
    const out = [];
    for (let i = 0; i < p.n; i++) {
      const part = await requestGeneration(cfg, { ...p, seed: p.seed + i, n: 1 }, genAbort.signal);
      out.push(...part.slice(0, 1));
      clearTimeout(timeoutTimer);
      timeoutTimer = setTimeout(() => cancelGeneration("timeout"), GEN_TIMEOUT_MS);
    }
    return out;
  };
  try {
    let blobs = [];
    if (settings.format === "openai" && p.vibes.length) {
      // OpenAI 协议没有氛围字段: 先试官方 NAI 通道让氛围图生效, 不可用再回退
      toast("检测到氛围图：正在尝试中转站的官方 NAI 通道…", "info", 4000);
      try {
        blobs = p.n > 1 ? await runBatch({ ...settings, format: "nai" }) : await requestGeneration({ ...settings, format: "nai" }, p, genAbort.signal);
        toast("已通过官方 NAI 通道生成，氛围转移生效", "ok", 4000);
      } catch (e2) {
        if (genAbort.signal.aborted) throw e2;
        console.warn("官方 NAI 通道不可用，回退 OpenAI 格式:", e2);
        toast("中转站无官方 NAI 通道，已回退 OpenAI 格式（氛围图本次忽略）", "warn", 5000);
        blobs = p.n > 1 ? await runBatch(settings) : await requestGeneration(settings, p, genAbort.signal);
      }
    } else if (settings.format === "openai" && p.n > 1) {
      blobs = await runBatch(settings);
    } else {
      blobs = await requestGeneration(settings, p, genAbort.signal);
    }
    const now = Date.now();
    for (let i = 0; i < blobs.length; i++) {
      const meta = { ...buildMeta(p), seed: p.seed + i };
      let blob = blobs[i];
      try { blob = await embedPngMetadata(blob, meta); } catch (e) {}
      const rec = { id: crypto.randomUUID(), ts: now + i, blob, meta };
      await dbAdd(rec);
      prependHistoryItem(rec);
      showImage(rec);
    }
    toast(`生成完成，共 ${blobs.length} 张图像`, "ok");
  } catch (e) {
    if (genAbort && genAbort.signal.aborted) {
      toast(genCancelReason === "timeout" ? "生成超时，已自动取消（中转站长时间无响应）" : "已取消本次生成", "warn");
    } else {
      console.error(e);
      toast("生成失败: " + (e.message || e), "error", 6500);
    }
  } finally {
    clearTimeout(timeoutTimer);
    genAbort = null;
    setGenerating(false);
  }
}

function cancelGeneration(reason) {
  if (!genAbort) return;
  genCancelReason = reason;
  genAbort.abort();
}

function prependHistoryItem(rec) {
  const grid = $("historyGrid");
  const empty = $("historyEmpty");
  if (empty) empty.remove();
  grid.insertBefore(buildHistoryItem(rec), grid.firstChild);
  const count = grid.querySelectorAll(".history-item").length;
  $("historyCount").textContent = `(${count})`;
  updateNavHistoryCount();
}

/* ---------- meta import ---------- */

function bindMetaImport() {
  const input = $("metaFileInput");
  $("importMetaBtn").addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    input.value = "";
    if (!file) return;
    try {
      const meta = commentToMeta(await readPngMetadata(file));
      if (!meta) {
        toast("这张图片没有内嵌生成参数", "warn");
        return;
      }
      reuseParams(meta);
      showImage({ id: "import-" + Date.now(), ts: Date.now(), blob: file, meta });
      if (isMobileView()) switchView("canvas");
      toast("已从图片导入生成参数", "ok");
    } catch (e) {
      toast("读取图片失败: " + (e.message || e), "error");
    }
  });
}

/* ---------- settings modal ---------- */

function openSettings() {
  modelFilterText = "";
  modelImageOnly = false;
  $("apiModelSearch").value = "";
  $("imageModelFilterBtn").classList.remove("active");
  $("apiBase").value = settings.base;
  $("apiKey").value = settings.key;
  $("apiFormat").value = settings.format;
  $("apiPath").value = settings.path;
  $("apiModelCustom").value = settings.customModel;
  $("artistBase").value = settings.artistBase || "";
  $("visionModelSearch").value = "";
  fillVisionModelSelect();
  fillApiModelSelect();
  $("settingsModal").classList.remove("hidden");
}

function closeSettings() {
  $("settingsModal").classList.add("hidden");
}

function filteredRelayModels() {
  let list = relayModels;
  if (modelImageOnly) list = list.filter(looksLikeImageModel);
  const q = modelFilterText.toLowerCase();
  if (q) list = list.filter((id) => id.toLowerCase().includes(q));
  return list;
}

function fillApiModelSelect() {
  const sel = $("apiModelSelect");
  sel.innerHTML = "";
  const current = settings.model;
  if (!relayModels.length) {
    const og = document.createElement("optgroup");
    og.label = "中转站模型";
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "保存设置后自动拉取模型列表";
    og.appendChild(opt);
    sel.appendChild(og);
  } else {
    const list = filteredRelayModels();
    if (!list.length) {
      const og = document.createElement("optgroup");
      og.label = "搜索结果";
      const opt = document.createElement("option");
      opt.value = "";
      opt.disabled = true;
      opt.textContent = "没有匹配的模型，换个关键词试试";
      og.appendChild(opt);
      sel.appendChild(og);
    } else if (modelFilterText || modelImageOnly) {
      const og = document.createElement("optgroup");
      og.label = `匹配结果 (${list.length})`;
      appendModelOptions(og, list);
      sel.appendChild(og);
    } else {
      fillModelGroups(sel);
    }
  }
  if (current && !sel.querySelector(`option[value="${CSS.escape(current)}"]`)) {
    const opt = document.createElement("option");
    opt.value = current;
    opt.textContent = `当前: ${current}`;
    sel.insertBefore(opt, sel.firstChild);
  }
  if (current) sel.value = current;
  const count = $("apiModelCount");
  if (count) {
    count.textContent = relayModels.length
      ? `共 ${relayModels.length} 个${modelFilterText || modelImageOnly ? `，匹配 ${filteredRelayModels().length} 个` : ""}`
      : "";
  }
}

function fillVisionModelSelect() {
  const sel = $("visionModelSelect");
  if (!sel) return;
  const rawQ = ($("visionModelSearch").value || "").trim();
  const q = rawQ.toLowerCase();
  const current = settings.visionModel || "";
  sel.innerHTML = "";
  if (!relayModels.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "保存设置后自动拉取模型列表";
    sel.appendChild(opt);
  } else {
    const list = q ? relayModels.filter((id) => id.toLowerCase().includes(q)) : relayModels;
    if (!list.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.disabled = true;
      opt.textContent = "没有匹配的模型";
      sel.appendChild(opt);
    } else {
      for (const id of list) {
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = id;
        sel.appendChild(opt);
      }
    }
    if (rawQ && !relayModels.includes(rawQ)) {
      const opt = document.createElement("option");
      opt.value = rawQ;
      opt.textContent = "自定义: " + rawQ;
      sel.appendChild(opt);
    }
  }
  if (current && !sel.querySelector(`option[value="${CSS.escape(current)}"]`)) {
    const opt = document.createElement("option");
    opt.value = current;
    opt.textContent = "当前: " + current;
    sel.insertBefore(opt, sel.firstChild);
  }
  if (current) sel.value = current;
}

function bindSettingsModal() {
  $("settingsBtn").addEventListener("click", openSettings);
  $("closeSettingsBtn").addEventListener("click", closeSettings);
  $("cancelSettingsBtn").addEventListener("click", closeSettings);
  $("settingsModal").addEventListener("click", (e) => {
    if (e.target === $("settingsModal")) closeSettings();
  });
  $("saveSettingsBtn").addEventListener("click", () => {
    settings.base = $("apiBase").value.trim();
    settings.key = $("apiKey").value.trim();
    settings.format = $("apiFormat").value;
    settings.path = $("apiPath").value.trim();
    settings.customModel = $("apiModelCustom").value.trim();
    settings.model = $("apiModelSelect").value || settings.model;
    settings.artistBase = $("artistBase").value.trim() || "https://danbooru.donmai.us";
    settings.visionModel = $("visionModelSelect").value.trim();
    params.model = settings.model;
    saveSettings();
    saveParams();
    updateModelSelectView();
    updateNegativePlaceholder();
    updateVibeHints();
    closeSettings();
    toast(settings.base ? "API 设置已保存" : "已保存，但中转站地址为空", settings.base ? "ok" : "warn");
    refreshRelayModels();
  });
  $("fetchModelsBtn").addEventListener("click", async () => {
    const btn = $("fetchModelsBtn");
    btn.disabled = true;
    btn.textContent = "获取中…";
    await refreshRelayModels({
      manual: true,
      cfg: { base: $("apiBase").value.trim(), key: $("apiKey").value.trim() }
    });
    btn.disabled = false;
    btn.textContent = "重新拉取模型列表";
  });
  $("apiModelSearch").addEventListener("input", () => {
    clearTimeout(modelSearchTimer);
    modelSearchTimer = setTimeout(() => {
      modelFilterText = $("apiModelSearch").value.trim();
      fillApiModelSelect();
    }, 150);
  });
  $("imageModelFilterBtn").addEventListener("click", () => {
    modelImageOnly = !modelImageOnly;
    $("imageModelFilterBtn").classList.toggle("active", modelImageOnly);
    fillApiModelSelect();
  });
  $("visionModelSearch").addEventListener("input", () => {
    clearTimeout(visionSearchTimer);
    visionSearchTimer = setTimeout(fillVisionModelSelect, 150);
  });
}

function bindHints() {
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".hint-btn");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const scope = btn.closest(".field") || btn.closest(".card");
    const hint = scope && scope.querySelector(":scope > .hint-text");
    if (hint) hint.classList.toggle("hidden");
  }, true);
}

/* ---------- global bindings ---------- */

function bindCanvasActions() {
  $("reuseBtn").addEventListener("click", () => {
    if (currentImage) reuseParams(currentImage.meta);
  });
  $("downloadBtn").addEventListener("click", () => {
    if (currentImage) downloadImage(currentImage);
  });
  $("deleteBtn").addEventListener("click", async () => {
    if (!currentImage) return;
    const el = document.querySelector(`.history-item[data-id="${currentImage.id}"]`);
    await removeRecord(currentImage, el);
    toast("已删除该图像", "ok");
  });
  $("generateBtn").addEventListener("click", generate);
  $("cancelGenBtn").addEventListener("click", () => cancelGeneration("user"));
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      generate();
    }
  });
}

function bindCollapsibles() {
  for (const card of document.querySelectorAll("[data-collapsible]")) {
    const title = card.querySelector("[data-collapse-toggle]");
    title.addEventListener("click", () => card.classList.toggle("open"));
  }
}

function bindClearHistory() {
  $("clearHistoryBtn").addEventListener("click", async () => {
    if (!confirm("确定清空全部生成历史吗？此操作不可恢复。")) return;
    await dbClear();
    for (const url of objectUrls.values()) URL.revokeObjectURL(url);
    objectUrls.clear();
    currentImage = null;
    $("historyGrid").innerHTML = '<div class="history-empty">暂无历史记录</div>';
    $("historyCount").textContent = "";
    updateNavHistoryCount();
    $("mainImage").classList.add("hidden");
    $("canvasBar").classList.add("hidden");
    $("canvasEmpty").classList.remove("hidden");
    toast("历史已清空", "ok");
  });
}

/* ---------- init ---------- */

/* ---------- style presets (画风预设) ---------- */

const LS_PRESETS = "nai_style_presets_v1";
let stylePresets = [];
let editingStylePresetId = null;

function loadStylePresets() {
  try {
    const a = JSON.parse(localStorage.getItem(LS_PRESETS) || "[]");
    if (Array.isArray(a)) stylePresets = a.filter((x) => x && x.name);
  } catch (e) { stylePresets = []; }
}
function saveStylePresets() {
  localStorage.setItem(LS_PRESETS, JSON.stringify(stylePresets));
}
function getActiveStylePreset() {
  if (!settings.activeStylePreset) return null;
  return stylePresets.find((s) => s.id === settings.activeStylePreset) || null;
}
function joinTags(...parts) {
  return parts
    .map((s) => (s || "").trim().replace(/^,+|,+$/g, "").replace(/,\s*,/g, ","))
    .filter(Boolean)
    .join(", ");
}
function applyStylePreset(p, sp) {
  const front = joinTags(sp.artistString, sp.styleTags);
  if (front) p.prompt = front + (p.prompt.trim() ? ", " + p.prompt.trim() : "");
  if ((sp.ucExtra || "").trim()) p.negative = joinTags(p.negative, sp.ucExtra);
  const pv = sp.params || {};
  if (pv.model) p.model = pv.model;
  if (pv.sampler) p.sampler = pv.sampler;
  if (pv.steps !== "" && pv.steps != null) p.steps = +pv.steps;
  if (pv.scale !== "" && pv.scale != null) p.scale = +pv.scale;
  if (pv.cfgRescale !== "" && pv.cfgRescale != null) p.cfgRescale = +pv.cfgRescale;
  if (pv.variety !== "" && pv.variety != null) p.variety = +pv.variety;
  p.stylePresetName = sp.name;
}
function toggleStylePreset(id) {
  settings.activeStylePreset = settings.activeStylePreset === id ? null : id;
  saveSettings();
  renderStylePresets();
  const sp = getActiveStylePreset();
  toast(sp ? `画风预设「${sp.name}」已启用，生成时自动附加` : "已停用画风预设", "ok");
}
function deleteStylePreset(id) {
  const sp = stylePresets.find((s) => s.id === id);
  if (!confirm(`删除预设「${sp ? sp.name : ""}」？`)) return;
  stylePresets = stylePresets.filter((s) => s.id !== id);
  if (settings.activeStylePreset === id) {
    settings.activeStylePreset = null;
    saveSettings();
  }
  saveStylePresets();
  renderStylePresets();
}
function renderStylePresets() {
  const list = $("stylePresetList");
  const status = $("stylePresetStatus");
  const active = getActiveStylePreset();
  list.innerHTML = "";
  if (!stylePresets.length) {
    const hint = document.createElement("p");
    hint.className = "field-hint";
    hint.textContent = "还没有预设。点「用当前设置建预设」一键捕获现在的参数，或「新建预设」手动填写。";
    list.appendChild(hint);
  }
  stylePresets.forEach((sp) => {
    const row = document.createElement("div");
    row.className = "preset-item" + (active && active.id === sp.id ? " active" : "");
    const name = document.createElement("button");
    name.type = "button";
    name.className = "preset-name";
    name.textContent = (active && active.id === sp.id ? "● " : "○ ") + sp.name;
    name.title = "点击启用 / 停用";
    name.addEventListener("click", () => toggleStylePreset(sp.id));
    const desc = document.createElement("span");
    desc.className = "preset-desc";
    desc.textContent = joinTags(sp.artistString, sp.styleTags).slice(0, 40) || "纯参数预设";
    const ops = document.createElement("span");
    ops.className = "preset-ops";
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "mini-btn";
    editBtn.textContent = "编辑";
    editBtn.addEventListener("click", () => openStylePresetForm(sp));
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "mini-btn danger";
    delBtn.textContent = "删";
    delBtn.addEventListener("click", () => deleteStylePreset(sp.id));
    ops.append(editBtn, delBtn);
    row.append(name, desc, ops);
    list.appendChild(row);
  });
  if (active) {
    status.textContent = `启用中：${active.name}（每次生成自动附加画风参数）`;
    status.classList.remove("hidden");
  } else {
    status.textContent = "";
    status.classList.add("hidden");
  }
}
function fillSamplerOptions(select, chosen) {
  select.innerHTML = '<option value="">跟随当前</option>';
  const src = $("samplerSelect");
  for (const opt of src.options) {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.textContent;
    select.appendChild(o);
  }
  select.value = chosen || "";
}
function openStylePresetForm(sp) {
  editingStylePresetId = sp ? sp.id : null;
  $("spName").value = sp ? sp.name : "";
  $("spArtist").value = sp ? sp.artistString || "" : "";
  $("spTags").value = sp ? sp.styleTags || "" : "";
  $("spUc").value = sp ? sp.ucExtra || "" : "";
  const pv = (sp && sp.params) || {};
  $("spModel").value = pv.model || "";
  fillSamplerOptions($("spSampler"), pv.sampler || "");
  $("spSteps").value = pv.steps ?? "";
  $("spScale").value = pv.scale ?? "";
  $("spCfg").value = pv.cfgRescale ?? "";
  $("spVariety").value = pv.variety ?? "";
  refreshTagChipStates();
  $("stylePresetForm").classList.remove("hidden");
  $("spName").focus();
}
function closeStylePresetForm() {
  editingStylePresetId = null;
  $("stylePresetForm").classList.add("hidden");
}
function captureStylePresetParams() {
  const p = collectParams();
  $("spModel").value = p.model || "";
  fillSamplerOptions($("spSampler"), p.sampler || "");
  $("spSteps").value = p.steps ?? "";
  $("spScale").value = p.scale ?? "";
  $("spCfg").value = p.cfgRescale ?? "";
  $("spVariety").value = p.variety ?? "";
  toast("已捕获当前模型与参数，继续填写画师串和名称", "ok");
}
function uid() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}
function saveStylePresetForm() {
  const name = $("spName").value.trim();
  if (!name) {
    toast("请先给预设起个名字", "warn");
    return;
  }
  const obj = {
    id: editingStylePresetId || uid(),
    name,
    artistString: $("spArtist").value.trim(),
    styleTags: $("spTags").value.trim(),
    ucExtra: $("spUc").value.trim(),
    params: {
      model: $("spModel").value.trim(),
      sampler: $("spSampler").value,
      steps: $("spSteps").value,
      scale: $("spScale").value,
      cfgRescale: $("spCfg").value,
      variety: $("spVariety").value
    }
  };
  if (editingStylePresetId) {
    const i = stylePresets.findIndex((s) => s.id === editingStylePresetId);
    if (i >= 0) stylePresets[i] = obj;
  } else {
    stylePresets.push(obj);
  }
  saveStylePresets();
  closeStylePresetForm();
  renderStylePresets();
  toast(`预设「${name}」已保存，点它即可启用`, "ok");
}
function exportStylePresets() {
  if (!stylePresets.length) {
    toast("还没有可导出的预设", "warn");
    return;
  }
  const blob = new Blob([JSON.stringify({ type: "nai-style-presets", presets: stylePresets }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "nai-style-presets.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
function importStylePresets(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const arr = Array.isArray(data) ? data : data && Array.isArray(data.presets) ? data.presets : null;
      if (!arr) throw new Error("文件里没有预设数组");
      let added = 0;
      for (const sp of arr) {
        if (!sp || !sp.name) continue;
        if (stylePresets.some((s) => s.id === sp.id)) continue;
        stylePresets.push({ ...sp, id: sp.id || uid() });
        added++;
      }
      saveStylePresets();
      renderStylePresets();
      toast(added ? `已导入 ${added} 个预设` : "没有新增预设（可能已存在）", "ok");
    } catch (e) {
      toast("导入失败: " + (e.message || e), "error");
    }
  };
  reader.readAsText(file);
}
/* ---------- style tag picker (画风标签细化) ---------- */

const STYLE_TAG_GROUPS = [
  { label: "线条笔触", tags: ["thick lineart", "thin lineart", "clean lineart", "sketch", "rough sketch", "crosshatching", "painterly brushwork", "no lineart"] },
  { label: "上色方式", tags: ["flat color", "cel shading", "soft shading", "gradient shading", "watercolor (medium)", "digital painting", "impasto", "airbrushed"] },
  { label: "光影", tags: ["soft lighting", "dramatic lighting", "backlighting", "rim lighting", "dappled sunlight", "cinematic lighting", "golden hour", "studio lighting"] },
  { label: "配色", tags: ["muted colors", "vibrant colors", "pastel colors", "limited palette", "monochrome", "dark palette", "high contrast", "low contrast"] },
  { label: "质感氛围", tags: ["film grain", "matte texture", "glossy", "dreamy atmosphere", "ethereal", "gritty", "retro artstyle", "vintage"] },
  { label: "构图景深", tags: ["close-up", "dynamic angle", "depth of field", "blurry background", "wide shot", "from above", "dutch angle", "portrait view"] }
];

function toggleTagInTextarea(ta, tag) {
  const parts = ta.value.split(",").map((s) => s.trim()).filter(Boolean);
  const i = parts.indexOf(tag);
  if (i >= 0) parts.splice(i, 1);
  else parts.push(tag);
  ta.value = parts.join(", ");
  refreshTagChipStates();
}
function refreshTagChipStates() {
  const parts = $("spTags").value.split(",").map((s) => s.trim());
  document.querySelectorAll("#spTagPicker .tag-chip").forEach((c) => {
    c.classList.toggle("on", parts.includes(c.textContent));
  });
}
function buildStyleTagPicker() {
  const box = $("spTagPicker");
  box.innerHTML = "";
  STYLE_TAG_GROUPS.forEach((g) => {
    const row = document.createElement("div");
    row.className = "tag-group";
    const lbl = document.createElement("span");
    lbl.className = "tag-group-label";
    lbl.textContent = g.label;
    const chips = document.createElement("div");
    chips.className = "tag-chips";
    g.tags.forEach((t) => {
      const c = document.createElement("button");
      c.type = "button";
      c.className = "tag-chip";
      c.textContent = t;
      c.addEventListener("click", () => toggleTagInTextarea($("spTags"), t));
      chips.appendChild(c);
    });
    row.append(lbl, chips);
    box.appendChild(row);
  });
}
function wrapArtist(left, right) {
  const ta = $("spArtist");
  const cur = ta.value.trim();
  if (!cur) {
    toast("先填画师串再加权", "warn");
    return;
  }
  if (cur.startsWith(left) && cur.endsWith(right)) {
    toast("已经包裹过了，再点一次会叠加权重", "warn");
    return;
  }
  ta.value = left + cur + right;
}

function bindStylePresets() {
  loadStylePresets();
  buildStyleTagPicker();
  $("spArtistUp").addEventListener("click", () => wrapArtist("{", "}"));
  $("spArtistDown").addEventListener("click", () => wrapArtist("[", "]"));
  $("newStylePresetBtn").addEventListener("click", () => openStylePresetForm(null));
  $("captureStylePresetBtn").addEventListener("click", () => {
    openStylePresetForm(null);
    captureStylePresetParams();
  });
  $("exportStylePresetsBtn").addEventListener("click", exportStylePresets);
  $("importStylePresetsBtn").addEventListener("click", () => $("stylePresetFileInput").click());
  $("stylePresetFileInput").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) importStylePresets(f);
    e.target.value = "";
  });
  $("saveStylePresetBtn").addEventListener("click", saveStylePresetForm);
  $("cancelStylePresetBtn").addEventListener("click", closeStylePresetForm);
  $("abTestBtn").addEventListener("click", () =>
    runAbTest().catch((e) => toast("A/B 验证失败: " + (e.message || e), "error", 6000))
  );
  renderStylePresets();
}

/* ---------- style extraction (画风提取 - 氛围转移替代方案) ---------- */

let lastStyleExtract = null;
const STYLE_HUE_NAMES = ["red", "orange", "yellow", "lime", "green", "teal", "cyan", "azure", "blue", "purple", "magenta", "pink"];

function blobToB64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(new Error("读取图片失败"));
    r.readAsDataURL(blob);
  });
}
function loadImageEl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片解码失败"));
    img.src = url;
  });
}
function rgbToHsl(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 510;
  if (mx === mn) return { h: 0, s: 0, l };
  const d = mx - mn;
  const s = d / (l > 0.5 ? 510 - mx - mn : mx + mn);
  let h;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (mx === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s, l };
}
function analyzeImageStyle(blob) {
  return blobToB64(blob).then((b64) => {
    const url = URL.createObjectURL(blob);
    return loadImageEl(url).then((img) => {
      URL.revokeObjectURL(url);
      const N = 64;
      const c = document.createElement("canvas");
      c.width = N; c.height = N;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      const s = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, N, N);
      const px = ctx.getImageData(0, 0, N, N).data;
      const hueHist = new Array(12).fill(0);
      const bins = new Map();
      let satSum = 0, lumSum = 0, lumSqSum = 0, chroma = 0;
      const gray = new Float32Array(N * N);
      for (let i = 0, p = 0; i < px.length; i += 4, p++) {
        const r = px[i], g = px[i + 1], b = px[i + 2];
        gray[p] = 0.299 * r + 0.587 * g + 0.114 * b;
        const { h, s, l } = rgbToHsl(r, g, b);
        satSum += s; lumSum += l; lumSqSum += l * l;
        if (s > 0.15 && l > 0.08 && l < 0.92) {
          chroma++;
          hueHist[Math.min(11, Math.floor(h / 30))] += 1;
        }
        if (l > 0.1) {
          const key = (Math.round(r / 64) << 4) | (Math.round(g / 64) << 2) | Math.round(b / 64);
          const e = bins.get(key);
          if (e) { e.n++; e.r += r; e.g += g; e.b += b; }
          else bins.set(key, { n: 1, r, g, b });
        }
      }
      const total = N * N;
      const avgSat = satSum / total;
      const avgLum = lumSum / total;
      const lumStd = Math.sqrt(Math.max(0, lumSqSum / total - avgLum * avgLum)) * 255;
      const chromaRatio = chroma / total;
      let edge = 0;
      for (let y = 0; y < N - 1; y++)
        for (let x = 0; x < N - 1; x++) {
          const i = y * N + x;
          edge += Math.abs(gray[i] - gray[i + 1]) + Math.abs(gray[i] - gray[i + N]);
        }
      const edgeDensity = edge / ((N - 1) * (N - 1) * 2 * 255);
      const tags = [];
      if (chromaRatio < 0.06) tags.push("monochrome");
      else if (chromaRatio < 0.2) tags.push("limited palette");
      else if (avgSat >= 0.62) tags.push("vibrant colors");
      else if (avgSat >= 0.3) tags.push("muted colors");
      else tags.push("pastel colors");
      if (avgLum <= 0.32) tags.push("dark palette");
      else if (avgLum >= 0.68) tags.push("bright");
      if (lumStd >= 64) tags.push("high contrast");
      else if (lumStd <= 28) tags.push("low contrast");
      if (edgeDensity >= 0.15) tags.push("detailed");
      else if (edgeDensity <= 0.05) tags.push("flat color");
      const sortedHues = hueHist.map((n, i) => ({ i, n })).sort((a, b) => b.n - a.n);
      if (chroma > 0 && sortedHues[0].n / chroma > 0.3)
        tags.push(STYLE_HUE_NAMES[sortedHues[0].i] + " theme");
      const palette = [...bins.values()]
        .sort((a, b) => b.n - a.n).slice(0, 5)
        .map((e) => "#" + [e.r / e.n, e.g / e.n, e.b / e.n].map((v) => Math.round(v).toString(16).padStart(2, "0")).join(""))
        .map((h) => (h.length === 4 ? h + h.slice(1) : h));
      return { tags, palette, b64 };
    });
  });
}
function showStyleExtractResult(res) {
  $("styleMetaResult").classList.add("hidden");
  const box = $("styleExtractResult");
  $("styleSwatches").innerHTML = res.palette
    .map((hex) => `<span class="swatch" style="background:${hex}" title="${hex}"></span>`)
    .join("");
  $("styleExtractTags").textContent = res.tags.join(", ") || "（未得出明显特征）";
  box.classList.remove("hidden");
}
async function extractStyleFromBlob(blob) {
  if (!blob) {
    toast("没有可分析的图片", "warn");
    return;
  }
  // 优先读内嵌官方生成参数 (NAI 图 = 100% 精确配方)
  try {
    const meta = commentToMeta(await readPngMetadata(blob));
    if (meta && (meta.prompt || meta.model)) {
      lastStyleExtract = { tags: [], palette: [], b64: await blobToB64(blob), meta };
      showMetaExtractResult(meta);
      return;
    }
  } catch (e) { /* 非 PNG 或无参数 → 本地分析兜底 */ }
  toast("正在分析画风…", "ok");
  const res = await analyzeImageStyle(blob);
  lastStyleExtract = res;
  showStyleExtractResult(res);
}
function metaSummaryText(meta) {
  const artists = (meta.prompt || "").match(/artist:[^\s,，]+/gi) || [];
  const bits = [];
  if (meta.model) bits.push("模型 " + meta.model);
  if (meta.steps != null) bits.push("步数 " + meta.steps);
  if (meta.scale != null) bits.push("Scale " + meta.scale);
  if (meta.sampler) bits.push(meta.sampler);
  if (artists.length) bits.push("画师 " + artists.join(" / "));
  return bits.join(" · ");
}
function showMetaExtractResult(meta) {
  $("styleExtractResult").classList.add("hidden");
  $("styleMetaSummary").textContent = metaSummaryText(meta);
  $("styleMetaResult").classList.remove("hidden");
  toast("检测到内嵌生成参数，官方精确配方可直接使用", "ok", 4500);
}
function metaToStylePresetForm(meta) {
  openStylePresetForm(null);
  $("spName").value = "配方 " + new Date().toLocaleDateString("zh-CN");
  $("spArtist").value = ((meta.prompt || "").match(/artist:[^\s,，]+/gi) || []).join(", ");
  $("spTags").value = "";
  $("spUc").value = "";
  $("spModel").value = meta.model || "";
  $("spSampler").value = meta.sampler || "";
  $("spSteps").value = meta.steps != null ? meta.steps : "";
  $("spScale").value = meta.scale != null ? meta.scale : "";
  $("spCfg").value = meta.cfgRescale != null ? meta.cfgRescale : "";
  $("spVariety").value = meta.variety != null ? meta.variety : "";
  toast("官方配方已填入预设表单，保存即用", "ok");
}
async function aiStyleAnalyze() {
  if (!lastStyleExtract || !lastStyleExtract.b64) {
    toast("先从图片做一次本地提取，再进行 AI 深度分析", "warn");
    return;
  }
  const vm = settings.visionModel;
  if (!vm) {
    toast("先在设置里填「视觉分析模型」才能 AI 深度分析", "warn");
    openSettings();
    return;
  }
  toast(`正在用 ${vm} 深度分析画风…`, "ok");
  const text = await requestVisionAnalysis(settings, vm, lastStyleExtract.b64);
  let aiTags = [];
  let summary = "";
  try {
    const m = text.match(/\{[\s\S]*\}/);
    const j = JSON.parse(m ? m[0] : text);
    aiTags = Array.isArray(j.tags) ? j.tags : Array.isArray(j.styleTags) ? j.styleTags : [];
    summary = j.summary || "";
  } catch (e) {
    aiTags = text.split(/[，,\n]/).map((s) => s.trim()).filter((s) => s && s.length < 40).slice(0, 22);
  }
  const merged = [...new Set([...lastStyleExtract.tags, ...aiTags.map((t) => String(t).trim().toLowerCase()).filter(Boolean)])];
  lastStyleExtract = { ...lastStyleExtract, tags: merged, summary };
  showStyleExtractResult(lastStyleExtract);
  toast(summary ? `AI 分析完成：${summary.slice(0, 60)}` : `AI 分析完成，共 ${merged.length} 个风格标签`, "ok");
}
function bindStyleExtraction() {
  $("extractFromFileBtn").addEventListener("click", () => $("styleExtractFileInput").click());
  $("styleExtractFileInput").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) extractStyleFromBlob(f).catch((err) => toast("提取失败: " + (err.message || err), "error"));
    e.target.value = "";
  });
  $("extractFromCanvasBtn").addEventListener("click", async () => {
    try {
      if (!currentImage || !currentImage.blob) {
        toast("画布上还没有图片，先生成或在历史里点一张图", "warn");
        return;
      }
      await extractStyleFromBlob(currentImage.blob);
    } catch (err) {
      toast("提取失败: " + (err.message || err), "error");
    }
  });
  $("aiStyleAnalyzeBtn").addEventListener("click", () =>
    aiStyleAnalyze().catch((err) => toast("AI 分析失败: " + (err.message || err), "error"))
  );
  $("useExtractedStyleBtn").addEventListener("click", () => {
    if (!lastStyleExtract) return;
    openStylePresetForm(null);
    $("spName").value = "提取画风 " + new Date().toLocaleDateString("zh-CN");
    $("spTags").value = lastStyleExtract.tags.join(", ");
    refreshTagChipStates();
    toast("已填入预设表单，可继续补充画师串后保存", "ok");
  });
  $("useMetaAsPresetBtn").addEventListener("click", () => {
    if (lastStyleExtract && lastStyleExtract.meta) metaToStylePresetForm(lastStyleExtract.meta);
  });
  $("applyMetaParamsBtn").addEventListener("click", () => {
    if (!(lastStyleExtract && lastStyleExtract.meta)) return;
    reuseParams(lastStyleExtract.meta);
    if (isMobileView()) switchView("create");
    toast("已从图片还原全部生成参数", "ok");
  });
}

/* ---------- A/B preset verification (画风预设 A/B 验证) ---------- */

let abUrls = [];
function showAbResult(aBlob, bBlob, presetName) {
  abUrls.forEach((u) => URL.revokeObjectURL(u));
  abUrls = [URL.createObjectURL(aBlob), URL.createObjectURL(bBlob)];
  $("abImgA").src = abUrls[0];
  $("abImgB").src = abUrls[1];
  $("abPresetName").textContent = presetName;
  $("abSummary").textContent = "相同 Seed、相同提示词，唯一区别是有没有预设。两张图差多少 = 预设对画风的控制力。";
  $("abResult").classList.remove("hidden");
}
async function runAbTest() {
  const active = getActiveStylePreset();
  if (!active) {
    toast("先启用一个画风预设再验证（点预设名启用）", "warn");
    return;
  }
  if (generating) {
    toast("正在生成中，请稍后再试", "warn");
    return;
  }
  if (!settings.base) {
    toast("先在设置里配置中转站", "warn");
    openSettings();
    return;
  }
  if (!confirm("A/B 验证将连续生成 2 张图（相同 Seed，带/不带预设各一张），消耗 2 张额度。继续？")) return;
  const savedSeed = params.seed;
  const savedN = params.n;
  const savedActive = settings.activeStylePreset;
  params.seed = (savedSeed !== "" && savedSeed != null && +savedSeed >= 0) ? +savedSeed : Math.floor(Math.random() * 2147483647);
  $("seedInput").value = params.seed;
  params.n = 1;
  saveParams();
  try {
    toast(`A/B 验证 Seed=${params.seed}：A（带预设「${active.name}」）生成中…`, "info", 5000);
    await generate();
    if (genCancelReason) {
      toast("A/B 验证已中断", "warn");
      return;
    }
    const aBlob = currentImage && currentImage.blob;
    settings.activeStylePreset = null;
    toast("A/B 验证：B（不带预设）生成中…", "info", 5000);
    await generate();
    if (genCancelReason) {
      toast("A/B 验证已中断", "warn");
      return;
    }
    const bBlob = currentImage && currentImage.blob;
    settings.activeStylePreset = savedActive;
    if (aBlob && bBlob) {
      showAbResult(aBlob, bBlob, active.name);
      toast("A/B 验证完成，两张图差异 = 预设的画风控制力", "ok");
    } else {
      toast("A/B 验证未取到图像", "warn");
    }
  } finally {
    settings.activeStylePreset = savedActive;
    params.seed = savedSeed;
    params.n = savedN;
    $("seedInput").value = savedSeed === "" ? "" : savedSeed;
    saveParams();
    saveSettings();
    renderStylePresets();
  }
}

function init() {
  loadState();
  loadCachedModels();
  buildModelSelect();
  bindBottomNav();
  bindPrompt();
  bindCharacterPrompts();
  bindActionSeg();
  bindImageUpload();
  bindMaskEditor();
  bindVibeTransfer();
  bindArtistLibrary();
  bindStylePresets();
  bindStyleExtraction();
  bindSizeControls();
  bindSliders();
  bindCountSeg();
  buildStyleGrid();
  bindCanvasActions();
  bindCollapsibles();
  bindClearHistory();
  bindMetaImport();
  bindSettingsModal();
  bindHints();
  bindModelSelectChange();
  refreshRelayModels({ silent: true });
  loadHistory();
  if (!settings.base) {
    setTimeout(() => {
      openSettings();
      toast("欢迎使用，请先配置中转站 API 地址与密钥", "", 5000);
    }, 400);
  }
}

init();
