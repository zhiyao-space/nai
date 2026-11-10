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
  artistBase: "https://danbooru.donmai.us"
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
    if (!$("settingsModal").classList.contains("hidden")) fillApiModelSelect();
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
    msgs.push("当前为 OpenAI 兼容格式，氛围转移将被忽略；请切换为 NovelAI 官方格式");
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
    await dbDelete(rec.id);
    if (objectUrls.has(rec.id)) { URL.revokeObjectURL(objectUrls.get(rec.id)); objectUrls.delete(rec.id); }
    el.remove();
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
  if (action === "inpaint" && modelFamily(model) === 3 && model !== "nai-diffusion-3-inpainting") {
    params.model = "nai-diffusion-3-inpainting";
    settings.model = params.model;
    settings.customModel = "";
    saveSettings();
    updateModelSelectView();
    toast("V3 局部重绘需要 Inpainting 模型，已自动切换", "warn");
  }
  const p = collectParams();
  if (!p.prompt.trim() && !p.characters.some((c) => c.prompt.trim())) {
    toast("请先输入提示词 (Prompt) 或角色提示词", "warn");
    return;
  }
  if (settings.format === "openai" && p.vibes.length) {
    toast("氛围转移仅支持 NovelAI 官方格式，本次已忽略氛围图", "warn", 5000);
  }
  saveSettings();
  setGenerating(true);
  if (isMobileView()) switchView("canvas");
  genAbort = new AbortController();
  genCancelReason = "";
  let timeoutTimer = setTimeout(() => cancelGeneration("timeout"), GEN_TIMEOUT_MS);
  try {
    let blobs = [];
    if (settings.format === "openai" && p.n > 1) {
      for (let i = 0; i < p.n; i++) {
        const pi = { ...p, seed: p.seed + i, n: 1 };
        const part = await requestGeneration(settings, pi, genAbort.signal);
        blobs.push(...part.slice(0, 1));
        clearTimeout(timeoutTimer);
        timeoutTimer = setTimeout(() => cancelGeneration("timeout"), GEN_TIMEOUT_MS);
      }
    } else {
      blobs = await requestGeneration(settings, p, genAbort.signal);
    }
    const now = Date.now();
    for (let i = 0; i < blobs.length; i++) {
      const meta = { ...buildMeta(p), seed: p.seed + i };
      const rec = { id: crypto.randomUUID(), ts: now + i, blob: blobs[i], meta };
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
  bindSizeControls();
  bindSliders();
  bindCountSeg();
  buildStyleGrid();
  bindCanvasActions();
  bindCollapsibles();
  bindClearHistory();
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
