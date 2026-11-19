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
  ucLevel: "heavy",
  smea: false,
  smeaDyn: false,
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
  translateModel: ""
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

const VIBE_LIMIT = 4; /* 空悲切中转站: Vibe Transfer 最多 4 张 (官方 5 张, 以中转站为准) */
const LS_VIBES = "nai_clone_vibes";
const LS_PRECISE = "nai_clone_precise_refs_v1";
const LS_REF_MODE = "nai_ref_mode_v1";
let refMode = "vibe";
let preciseRefs = [];

/* 精准参考 (Precise Reference, 官方 V4.5): 上限 4 张, 与氛围转移互斥 */
const PRECISE_LIMIT = 4;
const PRECISE_TYPES = [
  ["character", "角色 (还原人物长相/服装)"],
  ["style", "风格 (复刻画风)"],
  ["character&style", "角色+风格 (两者兼顾)"]
];

function savePrecise() {
  try { localStorage.setItem(LS_PRECISE, JSON.stringify(preciseRefs)); } catch (e) { /* 超出配额则不持久化 */ }
}

function vibeLimit() {
  return familyOf() === 3 ? 1 : VIBE_LIMIT;
}

function saveVibes() {
  /* encoded (encode-vibe 二进制) 不落盘, 由独立编码缓存管理 */
  const slim = vibes.map((v) => { const { encoded, ...rest } = v; return rest; });
  try { localStorage.setItem(LS_VIBES, JSON.stringify(slim)); } catch (e) { /* 超出配额则不持久化 */ }
}

let vibes = [];

let relayModels = [];
let modelFilterText = "";
let modelImageOnly = false;
let modelSearchTimer = null;
let translateSearchTimer = null;

/* ---------- persistence ---------- */

function loadCachedModels() {
  try {
    const c = JSON.parse(localStorage.getItem(LS_MODELS) || "null");
    if (Array.isArray(c) && c.length) relayModels = c.filter((x) => typeof x === "string" && x.trim());
  } catch (e) {}
}

/* 角色条目规范化: 历史版本可能存入 null/空条目或缺少 prompt/negative 字段的脏数据,
   不清洗会让 collectParams / generate 校验在读 .prompt 时崩溃 */
function normalizeCharacters(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((c) => c && typeof c === "object")
    .map((c) => ({
      id: typeof c.id === "string" && c.id ? c.id : crypto.randomUUID(),
      prompt: typeof c.prompt === "string" ? c.prompt : "",
      negative: typeof c.negative === "string" ? c.negative : "",
      x: Number.isFinite(+c.x) ? +c.x : 0.5,
      y: Number.isFinite(+c.y) ? +c.y : 0.5
    }));
}

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_SETTINGS) || "null");
    if (s) settings = { ...DEFAULT_SETTINGS, ...s };
    const p = JSON.parse(localStorage.getItem(LS_PARAMS) || "null");
    if (p) {
      params = { ...DEFAULT_PARAMS, ...p };
      params.characters = normalizeCharacters(params.characters);
    }
    const v = JSON.parse(localStorage.getItem(LS_VIBES) || "null");
    if (Array.isArray(v)) vibes = v.filter((x) => x && x.b64).slice(0, VIBE_LIMIT);
    const pr = JSON.parse(localStorage.getItem(LS_PRECISE) || "null");
    if (Array.isArray(pr)) preciseRefs = pr.filter((x) => x && x.b64).slice(0, PRECISE_LIMIT)
      .map((x) => ({ ...x, dataUrl: x.dataUrl || ("data:image/png;base64," + x.b64) }));
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
  $("ucLevelSelect").value = params.ucLevel || "heavy";
  $("ucLevelSelect").addEventListener("change", () => {
    params.ucLevel = $("ucLevelSelect").value;
    updateNegativePlaceholder();
    saveParams();
  });
  $("smeaToggle").checked = !!params.smea;
  $("smeaDynToggle").checked = !!params.smeaDyn;
  $("smeaToggle").addEventListener("change", () => {
    params.smea = $("smeaToggle").checked;
    if (!params.smea) { params.smeaDyn = false; $("smeaDynToggle").checked = false; }
    saveParams();
  });
  $("smeaDynToggle").addEventListener("change", () => {
    params.smeaDyn = $("smeaDynToggle").checked;
    saveParams();
  });
  $("clearPromptBtn").addEventListener("click", () => {
    $("promptInput").value = "";
    params.prompt = "";
    updateCounts();
    saveParams();
    toast("已清空画面描述", "ok");
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
    if (!$("settingsModal").classList.contains("hidden")) { fillApiModelSelect(); fillTranslateModelSelect(); }
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
    /* 路由: 精准参考模式下粘贴进精准参考, 否则按原逻辑进氛围图 */
    const inPrecise = document.activeElement && document.activeElement.closest && document.activeElement.closest('[id^="precise"]');
    if (currentAction() === "generate") {
      if (refMode === "precise" || inPrecise) { console.log("[paste] -> precise"); addPreciseFiles([file]); toast("已粘贴到精准参考", "ok"); }
      else { console.log("[paste] -> vibe"); addVibeFiles([file]); }
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

/* 官方行为: 氛围参考图统一转成 PNG 再 base64 提交 (非 PNG 原样提交可能被部分后端拒收) */
function ensurePngDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    if (/^data:image\/png/i.test(dataUrl)) {
      resolve(dataUrl);
      return;
    }
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext("2d").drawImage(img, 0, 0);
      resolve(c.toDataURL("image/png"));
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
    ta.value = c.prompt || "";
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
  $("stableStyleBtn").addEventListener("click", () => {
    if (!vibes.length) {
      toast("先上传至少一张氛围图", "warn");
      return;
    }
    for (const v of vibes) {
      v.infoExtracted = 1;
      v.referenceStrength = 0.9;
    }
    saveVibes();
    renderVibeList();
    toast("已应用稳画风参数：信息提取 1.0 + 参考强度 0.9；建议再固定 Seed 效果最稳", "ok", 5000);
  });
  $("styleOnlyBtn").addEventListener("click", () => {
    if (!vibes.length) {
      toast("先上传至少一张氛围图", "warn");
      return;
    }
    for (const v of vibes) {
      v.infoExtracted = 0.35; /* 低信息提取: 只学画风/构图, 不锁发色眼色服饰等人物细节 */
      v.referenceStrength = 0.7;
    }
    saveVibes();
    renderVibeList();
    toast("已应用只学画风参数：信息提取 0.35 + 参考强度 0.7；建议在负向提示词里写上不想固定的特征（如固定发色、固定服饰）", "ok", 6000);
  });
  $("faceVibeBtn").addEventListener("click", () => {
    if (!vibes.length) {
      toast("先上传至少一张氛围图", "warn");
      return;
    }
    for (const v of vibes) {
      v.infoExtracted = 0.6; /* 中档信息提取: 保留脸部/人物氛围与神态类型, 不钉死发色瞳色服饰发型 */
      v.referenceStrength = 0.75;
    }
    saveVibes();
    renderVibeList();
    toast("已应用脸部氛围参数：信息提取 0.6 + 参考强度 0.75；保留脸部与人物氛围，不锁具体颜色服饰。若仍串色，可在负向提示词加「same hairstyle, same clothing, hair color as reference」类描述", "ok", 7000);
  });
  $("comboVibeBtn").addEventListener("click", () => {
    if (!vibes.length) {
      toast("先上传至少一张氛围图 (推荐两张: 第1张画风图, 第2张脸部图)", "warn");
      return;
    }
    if (vibes.length === 1) {
      /* 单图组合: 中档信息提取, 同时拿到画风 + 脸部氛围, 不锁细节 */
      vibes[0].infoExtracted = 0.5;
      vibes[0].referenceStrength = 0.75;
      saveVibes();
      renderVibeList();
      toast("单图组合模式：信息提取 0.5 + 参考强度 0.75。想更稳推荐传两张图——第1张画风图、第2张脸部图，再按一次本按钮", "ok", 7000);
      return;
    }
    /* 双图组合 (官方多图加权玩法): 第1张只学画风, 第2张保脸部氛围 */
    vibes[0].infoExtracted = 0.35;
    vibes[0].referenceStrength = 0.7;
    vibes[1].infoExtracted = 0.6;
    vibes[1].referenceStrength = 0.75;
    for (let i = 2; i < vibes.length; i++) {
      vibes[i].infoExtracted = 0.5;
      vibes[i].referenceStrength = 0.75;
    }
    saveVibes();
    renderVibeList();
    toast("组合模式已应用：第1张只学画风 (0.35)，第2张保脸部氛围 (0.6)，其余 0.5。可在卡片上单独微调每张", "ok", 7000);
  });
}

function addVibeFromDataUrl(dataUrl, label) {
  const limit = vibeLimit();
  const room = limit - vibes.length;
  if (room <= 0) {
    toast(familyOf() === 3 ? "V3 模型仅支持 1 张氛围图，请先移除现有氛围图" : `氛围图最多 ${limit} 张`, "warn");
    return Promise.resolve(false);
  }
  return (async () => {
    try {
      const scaled = await downscaleToMax(dataUrl, 1024);
      const png = await ensurePngDataUrl(scaled.dataUrl);
      vibes.push({
        id: crypto.randomUUID(),
        b64: png.split(",")[1] || "",
        dataUrl: png,
        infoExtracted: 1,
        referenceStrength: 0.9
      });
      saveVibes();
      renderVibeList();
      toast(`已把${label || "该图"}加入氛围参考 (参考强度 0.9)`, "ok");
      return true;
    } catch (e) {
      toast("图片读取失败", "error");
      return false;
    }
  })();
}

function addVibeFiles(files) {
  const limit = vibeLimit();
  const room = limit - vibes.length;
  if (room <= 0) {
    toast(familyOf() === 3 ? "V3 模型仅支持 1 张氛围图，请先移除现有氛围图" : `氛围图最多 ${limit} 张`, "warn");
    return;
  }
  const list = files.filter(Boolean).slice(0, room);
  if (files.length > room) toast(`氛围图最多 ${limit} 张，已截取前 ${room} 张`, "warn");
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
        const png = await ensurePngDataUrl(scaled.dataUrl);
        vibes.push({
          id: crypto.randomUUID(),
          b64: png.split(",")[1] || "",
          dataUrl: png,
          infoExtracted: 1,
          referenceStrength: 0.6
        });
        saveVibes();
      } catch (e) {
        toast("图片读取失败", "error");
      }
      done();
    };
    reader.onerror = () => { toast("图片读取失败", "error"); done(); };
    reader.readAsDataURL(file);
  }
}

function replaceVibeImage(idx) {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "image/*";
  inp.addEventListener("change", () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const scaled = await downscaleToMax(String(reader.result), 1024);
        const png = await ensurePngDataUrl(scaled.dataUrl);
        vibes[idx].b64 = png.split(",")[1] || "";
        vibes[idx].dataUrl = png;
        renderVibeList();
        saveVibes();
        toast("已替换这张氛围图", "ok");
      } catch (e) {
        toast("图片读取失败", "error");
      }
    };
    reader.onerror = () => toast("图片读取失败", "error");
    reader.readAsDataURL(f);
  });
  inp.click();
}

function buildVibeSlider(vibe, key, label, onChange) {
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
    if (typeof onChange === "function") onChange(+inp.value);
  });
  wrap.appendChild(lab);
  wrap.appendChild(inp);
  return wrap;
}

function vibeExportEncoding(v) {
  /* 取出可导出的编码: 已有 encoded > 编码缓存命中 > null (需先生成一次完成编码) */
  if (v.encoded) return v.encoded;
  if (v.b64 && typeof getCachedVibeEncoded === "function" && getCachedVibeEncoded(v.b64, v.infoExtracted ?? 1, effectiveModel())) {
    return getCachedVibeEncoded(v.b64, v.infoExtracted ?? 1, effectiveModel());
  }
  return null;
}

function exportVibeEncoding(idx) {
  const v = vibes[idx];
  if (!v) return;
  const enc = vibeExportEncoding(v);
  if (!enc) {
    toast("这条氛围图还没有编码数据：先用当前参数生成一次完成编码, 再导出 (或直接导出带编码的 PNG)", "warn", 6000);
    return;
  }
  /* 官方 Export as Encodings 格式: .naiv4vibe JSON, data 字段为编码 base64 */
  const payload = {
    prompt: "vibe encoding for NAIV4",
    information_extracted: Number(v.infoExtracted ?? 1),
    data: enc
  };
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  downloadBlob(blob, "vibe_" + (idx + 1) + "_" + Date.now() + ".naiv4vibe");
  toast("已导出 .naiv4vibe 编码文件 (官方格式, 别人导入可免编码复用)", "ok", 5000);
}

function exportVibeBundle() {
  /* 官方 Export as Encodings 同款: 多张 vibe 打包成一个 ZIP, 每张一个独立 .naiv4vibe */
  const files = [];
  vibes.forEach((v, idx) => {
    const enc = vibeExportEncoding(v);
    if (!enc) return;
    const payload = {
      prompt: "vibe encoding for NAIV4",
      information_extracted: Number(v.infoExtracted ?? 1),
      data: enc
    };
    files.push({ name: "vibe_" + String(idx + 1).padStart(2, "0") + ".naiv4vibe", data: JSON.stringify(payload) });
  });
  if (!files.length) {
    toast("没有可导出的编码：请先用当前参数生成一次完成编码, 或导入带编码的 PNG / 编码文件", "warn", 6000);
    return;
  }
  const blob = buildZipStore(files);
  downloadBlob(blob, "vibe_bundle_" + files.length + "_" + Date.now() + ".zip");
  const skipped = vibes.length - files.length;
  toast(`已导出 ${files.length} 条编码 ZIP 捆绑 (官方 Export as Encodings 格式, 官方界面可直接导入)${skipped ? `, 跳过 ${skipped} 条无编码的` : ""}`, "ok", 6000);
}

function vibeBadgeState(v) {
  /* 编码状态: v.encoded 为导入/已注入的编码; 否则查编码缓存 (命中则生成时不重复扣费) */
  if (v.encoded) return { text: "已编码 · 免费复用", cls: "ok" };
  if (v.b64 && typeof getCachedVibeEncoded === "function" && getCachedVibeEncoded(v.b64, v.infoExtracted ?? 1, effectiveModel())) return { text: "已缓存 · 免费复用", cls: "ok" };
  return { text: "生成时编码 · 约 2 Anlas", cls: "" };
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
      saveVibes();
    });
    head.appendChild(label);
    let badge = null;
    if (familyOf() !== 3 && (v.b64 || v.encoded)) {
      badge = document.createElement("span");
      const st = vibeBadgeState(v);
      badge.className = "vibe-enc-badge " + st.cls;
      badge.textContent = st.text;
      head.appendChild(badge);
    }
    let exbtn = null;
    if (familyOf() !== 3 && (v.encoded || vibeExportEncoding(v))) {
      exbtn = document.createElement("button");
      exbtn.className = "mini-btn";
      exbtn.textContent = "导出编码";
      exbtn.title = "导出为官方 .naiv4vibe 编码文件 (Export as Encodings)";
      exbtn.style.marginRight = "6px";
      exbtn.addEventListener("click", (e) => { e.stopPropagation(); exportVibeEncoding(idx); });
      head.appendChild(exbtn);
    }
    head.appendChild(del);
    card.appendChild(head);

    if (v.dataUrl) {
      const thumb = document.createElement("img");
      thumb.className = "vibe-thumb";
      thumb.src = v.dataUrl;
      thumb.alt = "氛围参考图";
      thumb.style.cursor = "pointer";
      thumb.title = "点击替换这张氛围图";
      thumb.addEventListener("click", () => replaceVibeImage(idx));
      card.appendChild(thumb);
    } else {
      /* 官方 PNG 导入的纯编码 Vibe: 无原图数据, 显示占位块 */
      const ph = document.createElement("div");
      ph.className = "vibe-thumb vibe-thumb-ph";
      ph.textContent = "Vibe 编码";
      ph.title = "该条目只有内嵌的 Vibe 编码数据 (来自 PNG 元数据), 无原图预览";
      card.appendChild(ph);
    }

    card.appendChild(buildVibeSlider(v, "infoExtracted", "信息提取 (Information Extracted)", () => {
      /* 改变信息提取强度会使编码缓存失效, 实时刷新徽标 */
      if (badge) { const st = vibeBadgeState(v); badge.className = "vibe-enc-badge " + st.cls; badge.textContent = st.text; }
    }));
    card.appendChild(buildVibeSlider(v, "referenceStrength", "参考强度 (Reference Strength)"));
    list.appendChild(card);
  });
  updateVibeHints();
}

function addPreciseFiles(files) {
 /* 安卓/华为机型 file.type 常为空串且文件名可能是 .heic/无扩展名, 与 addVibeFiles 保持一致: 不过滤, 交给解码失败时报错 */
 const list = Array.from(files || []).filter(Boolean);
 if (!list.length) { toast("没有收到文件, 请重新选择", "warn"); return; }
 console.log("[precise] add files:", list.length, list.map((f) => f.name + "|" + f.type).join(", "));
   if (vibes.length) toast("注意: 精准参考与氛围转移互斥, 生成时只会发送精准参考, 氛围图将被忽略", "warn", 6000);
  if (typeof isV45 === "function" && !isV45(effectiveModel())) toast("精准参考仅 V4.5 系模型生效, 当前模型可能不支持 director_reference 字段", "warn", 6000);
  for (const file of list) {
    if (preciseRefs.length >= PRECISE_LIMIT) { toast(`精准参考最多 ${PRECISE_LIMIT} 张`, "warn"); break; }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const scaled = await downscaleToMax(String(reader.result), 1536);
        const png = await ensurePngDataUrl(scaled.dataUrl);
        preciseRefs.push({ id: uid(), b64: png.split(",")[1] || "", dataUrl: png, type: "character", strength: 1, fidelity: 1 });
        console.log("[precise] added entry:", preciseRefs.length, "/", PRECISE_LIMIT, "size:", Math.round(png.length / 1024), "KB");
        savePrecise();
        renderPreciseList();
      } catch (e) { console.error("[precise] process failed:", e); toast((e && e.message ? e.message : "图片处理失败") + " — 若是手机相机拍的 HEIC/HEIF 格式, 请转成 JPG/PNG 再试 (文件: " + (file.name||"") + ")", "error", 7000); }
    };
    reader.readAsDataURL(file);
  }
}

function removePreciseRef(id) {
  const idx = preciseRefs.findIndex((r) => r.id === id);
  if (idx >= 0) { preciseRefs.splice(idx, 1); savePrecise(); renderPreciseList(); }
}

const PRECISE_PRESETS = { "character": { s: 0.6, f: 0.7 }, "style": { s: 0.8, f: 0.6 }, "character&style": { s: 0.7, f: 0.7 } };
const PRECISE_MODE_DESCS = {
  "character": "角色参考 — 复现参考图角色的脸/发型/服装/体型, 固定原创角色",
  "style": "风格参考 — 锁定整体画风/笔触/色调, 角色可换",
  "character&style": "角色+风格 — 一次性复现「某个角色的某种画风」"
};

function makePrSlider(label, min, max, val, onInput, onCommit) {
  const row = document.createElement("div"); row.className = "pr-slider-row";
  const lab = document.createElement("span"); lab.className = "precise-label"; lab.textContent = label;
  const range = document.createElement("input"); range.type = "range"; range.className = "pr-slider";
  range.min = String(min); range.max = String(max); range.step = "0.05"; range.value = String(val);
  const num = document.createElement("input"); num.type = "number"; num.className = "pr-val";
  num.min = String(min); num.max = String(max); num.step = "0.05"; num.value = String(val);
  range.addEventListener("input", () => { num.value = range.value; onInput(+range.value); });
  range.addEventListener("change", () => onCommit(+range.value));
  num.addEventListener("change", () => { let v = Math.min(max, Math.max(min, +num.value || 0)); num.value = String(v); range.value = String(v); onInput(v); onCommit(v); });
  row.appendChild(lab); row.appendChild(range); row.appendChild(num);
  return { row, range, num };
}

function renderPreciseList() {
  const wrap = $("preciseList");
  wrap.innerHTML = "";
  for (const r of preciseRefs) {
    if (r.styleAware === undefined) r.styleAware = true;
    if (r.manualTuned === undefined) r.manualTuned = false;
    const card = document.createElement("div"); card.className = "precise-card";

    const head = document.createElement("div"); head.className = "pr-head";
    const img = document.createElement("img");
    img.src = r.dataUrl || (r.b64 ? "data:image/png;base64," + r.b64 : "");
    img.className = "precise-thumb"; img.alt = "";
    if (!img.src) console.warn("[precise] entry missing both dataUrl and b64, thumbnail empty:", r.id);
    head.appendChild(img);

    const headRight = document.createElement("div"); headRight.className = "pr-head-right";
    const seg = document.createElement("div"); seg.className = "seg pr-mode-seg";
    for (const [val, label] of PRECISE_TYPES) {
      const b = document.createElement("button"); b.type = "button"; b.className = "seg-btn" + ((r.type || "character") === val ? " active" : "");
      b.textContent = label.split(" ")[0];
      b.addEventListener("click", () => {
        if (r.type === val) return;
        r.type = val;
        if (!r.manualTuned) { const p = PRECISE_PRESETS[val]; r.strength = p.s; r.fidelity = p.f; }
        savePrecise(); renderPreciseList();
      });
      seg.appendChild(b);
    }
    headRight.appendChild(seg);
    const desc = document.createElement("div"); desc.className = "pr-mode-desc";
    desc.textContent = PRECISE_MODE_DESCS[r.type || "character"];
    headRight.appendChild(desc);
    head.appendChild(headRight);

    const del = document.createElement("button");
    del.className = "icon-btn pr-del"; del.textContent = "✕"; del.title = "移除";
    del.addEventListener("click", () => removePreciseRef(r.id));
    head.appendChild(del);
    card.appendChild(head);

    const tune = () => { r.manualTuned = true; savePrecise(); };
    const sRow = makePrSlider("强度", -1, 1, r.strength ?? 1, (v) => { r.strength = v; }, tune);
    const fRow = makePrSlider("保真", 0, 1, r.fidelity ?? 1, (v) => { r.fidelity = v; }, tune);
    const iRow = makePrSlider("信息提取", 0, 1, r.infoExtracted ?? 1, (v) => { r.infoExtracted = v; }, tune);
    sRow.range.addEventListener("input", () => { r.strength = +sRow.range.value; });
    fRow.range.addEventListener("input", () => { r.fidelity = +fRow.range.value; });
    iRow.range.addEventListener("input", () => { r.infoExtracted = +iRow.range.value; });
    sRow.num.addEventListener("change", tune); fRow.num.addEventListener("change", tune); iRow.num.addEventListener("change", tune);
    card.appendChild(sRow.row); card.appendChild(fRow.row); card.appendChild(iRow.row);

    if ((r.type || "character") !== "style") {
      const saRow = document.createElement("div"); saRow.className = "pr-sa-row";
      const saLab = document.createElement("span"); saLab.className = "precise-label"; saLab.textContent = "风格感知 (角色参考同时携带画风)";
      const sw = document.createElement("label"); sw.className = "switch";
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = r.styleAware !== false;
      const dot = document.createElement("span"); dot.className = "slider";
      cb.addEventListener("change", () => { r.styleAware = cb.checked; savePrecise(); });
      sw.appendChild(cb); sw.appendChild(dot);
      saRow.appendChild(saLab); saRow.appendChild(sw);
      card.appendChild(saRow);
    }
    wrap.appendChild(card);
  }
  const box = $("preciseUploadBox");
  if (box) box.classList.toggle("hidden", preciseRefs.length >= PRECISE_LIMIT);
}

function bindPrecise() {
  const box = $("preciseUploadBox");
  const input = $("preciseFileInput");
  if (!box || !input) return;
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("change", () => {
    /* 华为等机型的 DocumentsUI 响应慢, 必须先读 files 再清 value, 否则 FileList 失效变空 */
    if (input.files && input.files.length) addPreciseFiles(Array.from(input.files));
    else toast("选图器没有带回文件, 请重试一次, 或改用 Ctrl+V 粘贴", "warn", 5000);
    input.value = "";
  });
  box.addEventListener("dragover", (e) => { e.preventDefault(); box.classList.add("drag"); });
  box.addEventListener("dragleave", () => box.classList.remove("drag"));
  box.addEventListener("drop", (e) => {
    e.preventDefault(); box.classList.remove("drag");
    addPreciseFiles(e.dataTransfer.files);
  });
  const expBtn = $("exportPreciseBtn");
  if (expBtn) expBtn.addEventListener("click", exportPreciseBundle);
  renderPreciseList();
}

/* 精准参考导出: ZIP 捆绑 = 每张参考 PNG + precise_refs.json (参数清单); 单张 PNG 官方可直接当参考图用 */
function dataUrlToBytes(dataUrl) {
  const b64 = String(dataUrl).split(",")[1] || "";
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToDataUrl(bytes, mime) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return "data:" + (mime || "image/png") + ";base64," + btoa(bin);
}

async function exportPreciseBundle() {
  if (!preciseRefs.length) { toast("还没有精准参考可导出, 先上传几张图", "warn"); return; }
  const files = [];
  const manifest = [];
  for (let i = 0; i < preciseRefs.length; i++) {
    const r = preciseRefs[i];
    const name = "ref_" + String(i + 1).padStart(2, "0") + ".png";
    if (r.dataUrl) {
      try { files.push({ name, data: dataUrlToBytes(r.dataUrl) }); } catch (e) { console.warn("[precise] export skip img:", e); }
    }
    manifest.push({ type: r.type || "character", strength: r.strength ?? 1, fidelity: r.fidelity ?? 1, infoExtracted: r.infoExtracted ?? 1, styleAware: r.styleAware !== false, image: r.dataUrl ? name : null, data: r.dataUrl ? undefined : r.b64 });
  }
  files.push({ name: "precise_refs.json", data: JSON.stringify({ prompt: "precise reference bundle", version: 1, refs: manifest }, null, 2) });
  const zip = buildZipStore(files);
  const url = URL.createObjectURL(zip);
  const a = document.createElement("a");
  a.href = url; a.download = "precise_refs_" + preciseRefs.length + "_" + Date.now() + ".zip";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  toast("已导出 " + preciseRefs.length + " 张参考 (ZIP 捆绑, 含参数)", "ok", 4000);
}

async function importPreciseFiles(fileList) {
  for (const f of fileList) {
    try {
      const lower = (f.name || "").toLowerCase();
      if (lower.endsWith(".zip") || f.type === "application/zip") {
        const buf = await f.arrayBuffer();
        const entries = await extractZipEntries(buf);
        const jsonEntry = entries.find((e) => e.name.toLowerCase().endsWith(".json"));
        let manifest = null;
        if (jsonEntry) { try { manifest = JSON.parse(await jsonEntry.blob.text()).refs || null; } catch (e) { console.warn("[precise] bundle json parse fail:", e); } }
        let idx = 0;
        for (const e of entries) {
          if (e.name.toLowerCase().endsWith(".json")) continue;
          if (!/\.(png|jpe?g|webp)$/i.test(e.name)) continue;
          const dataUrl = await fileToDataUrl(e.blob);
          await addPreciseFromDataUrl(dataUrl, manifest && manifest[idx] ? manifest[idx] : null);
          idx++;
        }
        for (const m of (manifest || [])) if (m && m.data && !m.image) await addPreciseFromDataUrl("data:image/png;base64," + m.data, m);
        toast("已从 ZIP 捆绑导入参考 (含参数)", "ok", 4000);
      } else {
        const dataUrl = await fileToDataUrl(f);
        await addPreciseFromDataUrl(dataUrl, null);
      }
    } catch (e) {
      console.error("[precise] import failed:", e);
      toast("导入失败: " + ((e && e.message) || "文件处理异常"), "error", 6000);
    }
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}

async function addPreciseFromDataUrl(dataUrl, meta) {
  const scaled = await downscaleToMax(dataUrl, 1536);
  const png = await ensurePngDataUrl(scaled.dataUrl);
  const r = { id: uid(), b64: png.split(",")[1], dataUrl: png, type: "character", strength: 1, fidelity: 1, styleAware: true, manualTuned: false };
  if (meta) {
    r.type = meta.type || r.type;
    r.strength = Number(meta.strength ?? r.strength);
    r.fidelity = Number(meta.fidelity ?? r.fidelity);
    r.infoExtracted = Number(meta.infoExtracted ?? 1);
    r.styleAware = meta.styleAware !== false;
    r.manualTuned = true;
  }
  if (preciseRefs.length >= PRECISE_LIMIT) { toast("精准参考最多 " + PRECISE_LIMIT + " 张, 多余的已跳过", "warn", 5000); return; }
  preciseRefs.push(r);
  savePrecise(); renderPreciseList();
  console.log("[precise] imported entry:", r.type, "total:", preciseRefs.length);
}

/* ---------- 参考模式切换 (氛围转移 / 精准参考, 官方互斥) ---------- */
function setRefMode(mode) {
  refMode = (mode === "precise") ? "precise" : "vibe";
  try { localStorage.setItem(LS_REF_MODE, refMode); } catch (e) {}
  const vs = $("vibeSection"), ps = $("preciseSection");
  if (vs) vs.classList.toggle("hidden", refMode !== "vibe");
  if (ps) ps.classList.toggle("hidden", refMode !== "precise");
  document.querySelectorAll("#refModeSwitch .ref-mode-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === refMode);
  });
  console.log("[refmode]", refMode);
}

function bindRefMode() {
  try { refMode = localStorage.getItem(LS_REF_MODE) === "precise" ? "precise" : "vibe"; } catch (e) {}
  const sw = $("refModeSwitch");
  if (sw) {
    sw.addEventListener("click", (e) => {
      const btn = e.target.closest(".ref-mode-btn");
      if (!btn) return;
      const next = btn.dataset.mode;
      if (next !== refMode) {
        setRefMode(next);
        toast(next === "precise" ? "已切换到精准参考 (V4.5): 生成时只发送精准参考图" : "已切换到氛围转移: 生成时只发送氛围图", "ok");
      }
    });
  }
  setRefMode(refMode);
}

function updateVibeHints() {
  const hint = $("vibeHint");
  const msgs = [];
  if (settings.format === "openai" && vibes.length) {
    msgs.push("当前为 OpenAI 兼容格式：生成时自动尝试官方 NAI 通道，不支持则忽略氛围图");
  }
  const limit = vibeLimit();
  if (familyOf() === 3 && vibes.length) {
    msgs.push("V3 模型仅支持 1 张氛围图，生成时只使用第 1 张");
  }
  const full = vibes.length >= limit;
  $("vibeUploadBox").classList.toggle("hidden", full);
  if (full) msgs.push(`已达上限 ${limit} 张，移除一张后可继续添加`);
  hint.textContent = msgs.join(" · ");
  hint.classList.toggle("hidden", !msgs.length);
  /* V3 专属: SMEA / SMEA-DYN 开关仅 V3 家族显示 */
  $("smeaRow").classList.toggle("hidden", familyOf() !== 3);
}

function uid() {
  return (crypto.randomUUID && crypto.randomUUID()) || "id-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

/* ---------- 氛围转移: 画风预设 (PNG 元数据方案) ---------- */

const LS_VIBE_PRESETS = "nai_vibe_presets_v1";
const LS_VIBE_ACTIVE = "nai_vibe_active_id";
let vibePresets = [];
let lastVibeExtract = null;

function loadVibePresets() {
  try {
    const a = JSON.parse(localStorage.getItem(LS_VIBE_PRESETS) || "null");
    if (Array.isArray(a)) vibePresets = a.filter((x) => x && x.name);
  } catch (e) { vibePresets = []; }
}

function saveVibePresets() {
  try { localStorage.setItem(LS_VIBE_PRESETS, JSON.stringify(vibePresets)); } catch (e) {}
}

function getActiveVibePreset() {
  const id = localStorage.getItem(LS_VIBE_ACTIVE);
  if (!id) return null;
  return vibePresets.find((s) => s.id === id) || null;
}

function extractArtistsFromPrompt(prompt) {
  return (((prompt || "").match(/artist:[^\s,，]+/gi)) || []).join(", ");
}

function activeVibeName() {
  const vp = getActiveVibePreset();
  return vp ? vp.name : "";
}

async function handleVibePresetFile(file) {
  if (!file) return;
  try {
    const meta = commentToMeta(await readPngMetadata(file));
    if (!meta || (!meta.prompt && meta.seed == null)) {
      toast("这张图片没有内嵌 NAI 生成参数。只有 NAI 出的 PNG 带元数据，可在下方「手动微调」里手动填写画师串", "warn", 6000);
      return;
    }
    lastVibeExtract = {
      artists: extractArtistsFromPrompt(meta.prompt),
      styleTags: "",
      negative: meta.negative || "",
      seed: meta.seed != null ? String(meta.seed) : "",
      scale: meta.scale != null ? String(meta.scale) : "",
      steps: meta.steps != null ? String(meta.steps) : "",
      cfgRescale: meta.cfgRescale != null ? String(meta.cfgRescale) : "",
      sampler: meta.sampler || ""
    };
    renderVibeExtractResult();
    fillVibeTweakForm(lastVibeExtract);
    toast("已提取内嵌画风参数，可保存为画风预设", "ok", 4500);
  } catch (e) {
    toast("读取图片失败: " + (e.message || e), "error");
  }
}

function renderVibeExtractResult() {
  const box = $("vibeExtractResult");
  if (!lastVibeExtract) {
    box.classList.add("hidden");
    return;
  }
  $("vveArtists").textContent = lastVibeExtract.artists || "（未检测到画师串）";
  $("vveNegative").textContent = lastVibeExtract.negative ? lastVibeExtract.negative.slice(0, 60) + (lastVibeExtract.negative.length > 60 ? "…" : "") : "（无）";
  $("vveSeed").textContent = lastVibeExtract.seed || "（无）";
  $("vveScale").textContent = lastVibeExtract.scale || "（无）";
  $("vveSteps").textContent = lastVibeExtract.steps || "（无）";
  $("vveSampler").textContent = lastVibeExtract.sampler || "（无）";
  box.classList.remove("hidden");
}

function fillVibeTweakForm(vp) {
  $("vibeArtists").value = vp.artists || "";
  $("vibeStyleTags").value = vp.styleTags || "";
  $("vibeNegative").value = vp.negative || "";
  $("vibeSeed").value = vp.seed || "";
  $("vibeScale").value = vp.scale || "";
  $("vibeSteps").value = vp.steps || "";
  $("vibeCfg").value = vp.cfgRescale || "";
  $("vibeSampler").value = vp.sampler || "";
}

function readVibeTweakForm() {
  return {
    artists: $("vibeArtists").value.trim(),
    styleTags: $("vibeStyleTags").value.trim(),
    negative: $("vibeNegative").value.trim(),
    seed: $("vibeSeed").value.trim(),
    scale: $("vibeScale").value.trim(),
    steps: $("vibeSteps").value.trim(),
    cfgRescale: $("vibeCfg").value.trim(),
    sampler: $("vibeSampler").value.trim()
  };
}

function saveVibePresetFromForm() {
  const name = $("vibePresetName").value.trim();
  if (!name) {
    toast("请先填写预设名称", "warn");
    return;
  }
  const vp = { id: uid(), name, createdAt: Date.now(), ...readVibeTweakForm() };
  vibePresets.unshift(vp);
  saveVibePresets();
  localStorage.setItem(LS_VIBE_ACTIVE, vp.id);
  renderVibePresets();
  toast(`画风预设「${name}」已保存并启用`, "ok");
}

function deleteVibePreset(id) {
  const vp = vibePresets.find((s) => s.id === id);
  if (!vp) return;
  if (!confirm(`删除画风预设「${vp.name}」？`)) return;
  vibePresets = vibePresets.filter((s) => s.id !== id);
  saveVibePresets();
  if (localStorage.getItem(LS_VIBE_ACTIVE) === id) localStorage.removeItem(LS_VIBE_ACTIVE);
  renderVibePresets();
}

function renameVibePreset(id) {
  const vp = vibePresets.find((s) => s.id === id);
  if (!vp) return;
  const name = prompt("重命名画风预设", vp.name);
  if (!name || !name.trim() || name.trim() === vp.name) return;
  vp.name = name.trim();
  saveVibePresets();
  renderVibePresets();
}

function toggleVibePreset(id) {
  if (localStorage.getItem(LS_VIBE_ACTIVE) === id) {
    localStorage.removeItem(LS_VIBE_ACTIVE);
    toast("已停用画风预设", "ok");
  } else {
    localStorage.setItem(LS_VIBE_ACTIVE, id);
    const vp = getActiveVibePreset();
    toast(vp ? `已启用画风预设「${vp.name}」，生成时自动注入画风参数` : "已启用画风预设", "ok");
  }
  renderVibePresets();
}

function renderVibePresets() {
  const list = $("vibePresetList");
  const status = $("vibePresetStatus");
  const active = getActiveVibePreset();
  list.innerHTML = "";
  status.textContent = active ? `启用中：${active.name}` : "";
  status.classList.toggle("hidden", !active);
  if (!vibePresets.length) {
    list.innerHTML = '<div class="vibe-preset-empty">还没有预设：上传 NAI 的 PNG 提取，或手动微调后保存</div>';
    return;
  }
  vibePresets.forEach((vp) => {
    const card = document.createElement("div");
    card.className = "vibe-preset-card" + (active && active.id === vp.id ? " active" : "");

    const name = document.createElement("span");
    name.className = "vibe-preset-name";
    name.textContent = vp.name;
    name.title = "点击启用 / 停用该预设";
    name.addEventListener("click", () => toggleVibePreset(vp.id));
    card.appendChild(name);

    const desc = document.createElement("span");
    desc.className = "vibe-preset-desc";
    desc.textContent = [vp.artists, vp.styleTags].filter(Boolean).join(", ").slice(0, 40) || "纯参数预设";
    desc.title = desc.textContent;
    card.appendChild(desc);

    const rn = document.createElement("button");
    rn.className = "icon-btn sm";
    rn.title = "重命名";
    rn.textContent = "✎";
    rn.addEventListener("click", (e) => { e.stopPropagation(); renameVibePreset(vp.id); });
    card.appendChild(rn);

    const del = document.createElement("button");
    del.className = "icon-btn sm";
    del.title = "删除";
    del.textContent = "✕";
    del.addEventListener("click", (e) => { e.stopPropagation(); deleteVibePreset(vp.id); });
    card.appendChild(del);

    list.appendChild(card);
  });
}

function applyVibePreset(p) {
  const vp = getActiveVibePreset();
  if (!vp) return;
  const front = [vp.artists, vp.styleTags].filter((x) => x && x.trim()).join(", ");
  if (front) p.prompt = [front, p.prompt.trim()].filter(Boolean).join(", ");
  if (vp.negative && vp.negative.trim() && !p.negative.trim()) p.negative = vp.negative.trim();
  if (vp.seed !== "" && vp.seed != null && !isNaN(+vp.seed)) p.seed = +vp.seed;
  if (vp.scale && !isNaN(+vp.scale)) p.scale = +vp.scale;
  if (vp.steps && !isNaN(+vp.steps)) p.steps = +vp.steps;
  if (vp.cfgRescale && !isNaN(+vp.cfgRescale)) p.cfgRescale = +vp.cfgRescale;
  if (vp.sampler && vp.sampler.trim()) p.sampler = vp.sampler.trim();
}

function exportVibePresets() {
  if (!vibePresets.length) {
    toast("还没有可导出的画风预设", "warn");
    return;
  }
  const blob = new Blob([JSON.stringify({ type: "nai-vibe-presets", version: 1, presets: vibePresets }, null, 2)], { type: "application/json" });
  downloadBlob(blob, "nai-style-presets.json");
  toast(`已导出 ${vibePresets.length} 个画风预设`, "ok");
}

function importVibePresetFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result));
      const list = Array.isArray(data) ? data : (data && Array.isArray(data.presets) ? data.presets : null);
      if (!list) {
        toast("文件格式不对：需要本站导出的画风预设 JSON", "error");
        return;
      }
      let added = 0;
      let skipped = 0;
      for (const sp of list) {
        if (!sp || !sp.name) continue;
        const dup = vibePresets.some((s) => s.id === sp.id || (s.name === sp.name && s.artists === sp.artists && s.seed === sp.seed));
        if (dup) { skipped++; continue; }
        vibePresets.push({
          id: sp.id || uid(),
          name: sp.name,
          createdAt: sp.createdAt || Date.now(),
          artists: sp.artists || "",
          styleTags: sp.styleTags || "",
          negative: sp.negative || "",
          seed: sp.seed != null ? String(sp.seed) : "",
          scale: sp.scale != null ? String(sp.scale) : "",
          steps: sp.steps != null ? String(sp.steps) : "",
          cfgRescale: sp.cfgRescale != null ? String(sp.cfgRescale) : "",
          sampler: sp.sampler || ""
        });
        added++;
      }
      saveVibePresets();
      renderVibePresets();
      toast(added ? `已导入 ${added} 个画风预设${skipped ? `，跳过 ${skipped} 个重复` : ""}` : "文件里的预设都已存在，未新增", "ok", 5000);
    } catch (e) {
      toast("导入失败: " + (e.message || e), "error");
    }
  };
  reader.onerror = () => toast("读取文件失败", "error");
  reader.readAsText(file);
}

function bindVibePresets() {
  loadVibePresets();
  const box = $("vibePresetUpload");
  const input = $("vibePresetFile");
  box.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    const f = input.files && input.files[0];
    input.value = "";
    if (f) handleVibePresetFile(f);
  });
  box.addEventListener("dragover", (e) => { e.preventDefault(); box.classList.add("dragover"); });
  box.addEventListener("dragleave", () => box.classList.remove("dragover"));
  box.addEventListener("drop", (e) => {
    e.preventDefault();
    box.classList.remove("dragover");
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && f.type === "image/png") handleVibePresetFile(f);
    else if (f) toast("请上传 PNG 图片", "warn");
  });
  $("vibeSavePresetBtn").addEventListener("click", () => {
    if (!lastVibeExtract) {
      toast("先上传一张 NAI 的 PNG 提取画风参数", "warn");
      return;
    }
    $("vibePresetName").value = "画风 " + new Date().toLocaleDateString("zh-CN");
    $("vibeTweakPanel").classList.remove("hidden");
    $("vibePresetName").focus();
  });
  $("vibeTweakBtn").addEventListener("click", () => {
    if (!lastVibeExtract) fillVibeTweakForm({ artists: "", styleTags: "", negative: "", seed: "", scale: "", steps: "", cfgRescale: "", sampler: "" });
    $("vibeTweakPanel").classList.remove("hidden");
  });
  $("vibeTweakResetBtn").addEventListener("click", () => {
    if (lastVibeExtract) fillVibeTweakForm(lastVibeExtract);
  });
  $("vibeSaveTweakedBtn").addEventListener("click", saveVibePresetFromForm);
  $("vibeExportBtn").addEventListener("click", exportVibePresets);
  $("vibeImportBtn").addEventListener("click", () => $("vibeImportFile").click());
  $("vibeImportFile").addEventListener("change", () => {
    const f = $("vibeImportFile").files && $("vibeImportFile").files[0];
    $("vibeImportFile").value = "";
    if (f) importVibePresetFile(f);
  });
  renderVibeExtractResult();
  renderVibePresets();
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

  const toVibe = document.createElement("button");
  toVibe.className = "icon-btn";
  toVibe.title = "转为氛围图 (训练新画风)";
  toVibe.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/></svg>';
  toVibe.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      const url = objectUrls.get(rec.id) || URL.createObjectURL(rec.blob);
      const dataUrl = await new Promise((res, rej) => { const i = new Image(); i.onload = () => { const c = document.createElement("canvas"); c.width = i.naturalWidth; c.height = i.naturalHeight; c.getContext("2d").drawImage(i, 0, 0); res(c.toDataURL("image/png")); }; i.onerror = rej; i.src = url; });
      await addVibeFromDataUrl(dataUrl, "历史图像");
    } catch (err) {
      toast("图片读取失败", "error");
    }
  });

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
 actions.appendChild(toVibe);
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
  /* 官方逻辑: 下载时把完整参数 (含编码后的 Vibe 数据 / 精准参考) 写进 PNG,
     tEXt Comment + alpha 隐形通道双通道嵌入, 官网与第三方工具导入即可复刻画风 */
  embedPngMetadata(rec.blob, m).then((embedded) => {
    downloadBlob(embedded, `NovelAI${sizePart}${seedPart}.png`);
    if (m.vibes && m.vibes.length) toast("已嵌入 Vibe 编码与生成参数, 可在官方/第三方工具导入复用", "ok", 5000);
  }).catch(() => downloadBlob(rec.blob, `NovelAI${sizePart}${seedPart}.png`));
}

/* ---------- generation ---------- */

function collectParams() {
  const model = effectiveModel();
  const seed = params.seed === "" || params.seed == null ? randomSeed() : params.seed;
  const action = currentAction();
  const p = {
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
    ucLevel: params.ucLevel,
    smea: params.smea,
    smeaDyn: params.smeaDyn,
    action,
    strength: params.strength,
    noise: params.noise,
    imageB64: sourceImage ? sourceImage.b64 : null,
    maskB64: action === "inpaint" ? exportMaskB64() : null,
    characters: params.characters.filter((c) => c && typeof c === "object").map((c) => ({
      prompt: c.prompt || "",
      negative: c.negative || "",
      x: c.x ?? 0.5,
      y: c.y ?? 0.5
    })),
    useCoords: params.useCoords,
    useOrder: params.useOrder,
    vibes: vibes.map((v) => ({
      b64: v.b64,
      encoded: v.encoded || "",
      infoExtracted: v.infoExtracted,
      referenceStrength: v.referenceStrength
    })),
    preciseRefs: preciseRefs.map((r) => ({
      b64: r.b64,
      type: r.type,
      strength: r.strength,
      fidelity: r.fidelity,
      infoExtracted: r.infoExtracted,
      styleAware: r.styleAware
    }))
  };
  return p;
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
    ucLevel: p.ucLevel,
    smea: p.smea,
    smeaDyn: p.smeaDyn,
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
  /* 兜底: 运行期间任何途径写入的脏角色条目在这里最后清洗一次 */
  params.characters = normalizeCharacters(params.characters);
  let p;
  try {
    p = collectParams();
    if (!p.prompt.trim() && !p.characters.some((c) => (c.prompt || "").trim())) {
      toast("请先输入提示词 (Prompt) 或角色提示词", "warn");
      return;
    }
    applyVibePreset(p);
  } catch (err) {
    console.error("[generate] params error:", err);
    saveParams();
    const st = (err && err.stack || "").split("\n").slice(0, 3).join(" | ");
    toast("生成参数存在异常数据，已自动清理，请重新点击生成 (" + (err && err.message || err) + ") [" + st + "]", "error", 12000);
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
    if (settings.format === "kbq") {
      blobs = p.n > 1 ? await runBatch(settings) : await requestGeneration(settings, p, genAbort.signal);
    } else if (settings.format === "openai" && p.vibes.length) {
      // OpenAI 协议没有氛围字段: 先试官方 NAI 通道让氛围图生效, 不可用再回退
      toast("检测到氛围图：正在尝试中转站的官方 NAI 通道…", "info", 4000);
      try {
        blobs = p.n > 1 ? await runBatch({ ...settings, format: "nai" }) : await requestGeneration({ ...settings, format: "nai" }, p, genAbort.signal);
        toast("已通过官方 NAI 通道生成，氛围转移生效", "ok", 4000);
      } catch (e2) {
        if (genAbort.signal.aborted) throw e2;
        console.warn("官方 NAI 通道不可用，回退 OpenAI 格式:", e2);
        toast(p.preciseRefs && p.preciseRefs.length
          ? "中转站官方 NAI 通道生成失败，已回退 OpenAI 格式；精准参考仅官方通道支持，本次将被忽略"
          : "中转站无官方 NAI 通道，已回退 OpenAI 格式（氛围图本次忽略）", "warn", 6000);
        blobs = p.n > 1 ? await runBatch(settings) : await requestGeneration(settings, p, genAbort.signal);
      }
    } else if ((settings.format === "openai" || settings.format === "kbq") && p.n > 1) {
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

function bindVibePngImport() {
  const input = $("vibePngInput");
  if (!input) return;
  $("importVibePngBtn").addEventListener("click", () => input.click());
  const bundleBtn = $("exportVibeBundleBtn");
  if (bundleBtn) bundleBtn.addEventListener("click", exportVibeBundle);
  input.addEventListener("change", async () => {
    const files = Array.from(input.files || []);
    input.value = "";
    if (!files.length) return;
    let added = 0, free = false;
    for (const file of files) {
      try {
        if (/\.zip$/i.test(file.name) || file.type === "application/zip" || file.type === "application/x-zip-compressed") {
          /* 官方 Export as Encodings 的 ZIP 捆绑: 解包逐条导入 .naiv4vibe */
          const entries = await extractZipEntries(await file.arrayBuffer());
          let zipAdded = 0;
          for (const en of entries) {
            if (!/\.naiv4vibe$/i.test(en.name)) continue;
            let obj = null;
            try { obj = JSON.parse(await en.blob.text()); } catch (e) { continue; }
            const enc = obj && (obj.data || obj.encoded || obj.image);
            if (!enc) continue;
            if (vibes.length >= vibeLimit()) { toast(`氛围图最多 ${vibeLimit()} 张`, "warn"); break; }
            vibes.push({ id: crypto.randomUUID(), b64: "", dataUrl: "", encoded: String(enc), infoExtracted: Number(obj.information_extracted ?? obj.infoExtracted ?? 1), referenceStrength: Number(obj.strength ?? obj.referenceStrength ?? 0.6) });
            free = true; zipAdded++; added++;
          }
          if (!zipAdded) toast(file.name + ": ZIP 里没有找到 .naiv4vibe 编码文件", "warn");
          continue;
        }
        if (/\.naiv4vibebundle$|bundle/i.test(file.name) || file.type === "application/json") {
          /* 本站捆绑文件: { vibes: [ {information_extracted, strength, data}, ... ] } */
          const obj = JSON.parse(await file.text());
          const list = Array.isArray(obj && obj.vibes) ? obj.vibes : (obj && (obj.data || obj.encoded || obj.image) ? [obj] : []);
          if (!list.length) { toast(file.name + ": 没有可导入的编码条目", "warn"); continue; }
          for (const v of list) {
            const enc = v && (v.data || v.encoded || v.image);
            if (!enc) continue;
            if (vibes.length >= vibeLimit()) { toast(`氛围图最多 ${vibeLimit()} 张`, "warn"); break; }
            vibes.push({ id: crypto.randomUUID(), b64: "", dataUrl: "", encoded: String(enc), infoExtracted: Number(v.information_extracted ?? v.infoExtracted ?? 1), referenceStrength: Number(v.strength ?? v.referenceStrength ?? 0.6) });
            free = true; added++;
          }
          continue;
        }
        if (/\.naiv4vibe$/i.test(file.name)) {
          /* 官方单条编码文件 */
          const obj = JSON.parse(await file.text());
          const enc = obj && (obj.data || obj.encoded || obj.image);
          if (!enc) { toast(file.name + ": 编码文件里没有 data 字段", "warn"); continue; }
          if (vibes.length >= vibeLimit()) { toast(`氛围图最多 ${vibeLimit()} 张`, "warn"); break; }
          vibes.push({ id: crypto.randomUUID(), b64: "", dataUrl: "", encoded: String(enc), infoExtracted: Number(obj.information_extracted ?? obj.infoExtracted ?? 1), referenceStrength: Number(obj.strength ?? obj.referenceStrength ?? 0.6) });
          free = true; added++;
          continue;
        }
        const meta = commentToMeta(await readPngMetadata(file));
        const list = (meta && Array.isArray(meta.vibes)) ? meta.vibes.filter((v) => v.b64 || v.encoded) : [];
        if (!list.length) {
          if (meta && (meta.prompt || meta.width)) {
            toast(file.name + ": 有生成参数但没内嵌 Vibe 数据 (生成它之前氛围面板是空的)", "warn", 6500);
          } else {
            toast(file.name + ": 未内嵌生成参数和 Vibe 数据 (可能被微信/QQ/截图二次压缩破坏)", "warn", 6500);
          }
          continue;
        }
        for (const v of list) {
          if (vibes.length >= vibeLimit()) { toast(`氛围图最多 ${vibeLimit()} 张`, "warn"); break; }
          vibes.push({
            id: crypto.randomUUID(),
            b64: v.b64 || "",
            dataUrl: v.b64 ? "data:image/png;base64," + v.b64 : "",
            encoded: v.encoded || undefined,
            infoExtracted: v.infoExtracted ?? 1,
            referenceStrength: v.referenceStrength ?? 0.6
          });
          if (v.encoded) free = true;
          added++;
        }
      } catch (e) {
        toast("读取 " + file.name + " 失败: " + (e.message || e), "error");
      }
    }
    if (added) {
      renderVibeList();
      saveVibes();
      toast(`已导入 ${added} 条 Vibe${free ? " (含编码, 免费复用无需重新编码)" : ""}`, "ok");
    }
  });
}

function bindMetaImport() {
  const input = $("metaFileInput");
  $("importMetaBtn").addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    input.value = "";
    if (!file) return;
    try {
      if (/\.(naiv4vibe|json)$/i.test(file.name)) {
      /* 官方 Export as Encodings 导出的 .naiv4vibe 编码文件 */
      const obj = JSON.parse(await file.text());
      const enc = obj && (obj.data || obj.encoded || obj.image);
      if (!enc) { toast("编码文件里没有 data 字段", "err"); return; }
      if (vibes.length >= VIBE_LIMIT) { toast(`氛围图最多 ${VIBE_LIMIT} 张`, "warn"); return; }
      vibes.push({ id: crypto.randomUUID(), b64: "", dataUrl: "", encoded: String(enc), infoExtracted: Number(obj.information_extracted ?? obj.infoExtracted ?? 1), referenceStrength: Number(obj.strength ?? obj.referenceStrength ?? 0.6) });
      renderVibeList(); saveVibes();
      toast("已导入 .naiv4vibe 编码文件 (免费复用, 无需重新编码)", "ok");
      return;
    }
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
  $("translateModelSearch").value = "";
  fillTranslateModelSelect();
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

function fillRelaySearchSelect(searchId, selId, current) {
  const sel = $(selId);
  if (!sel) return;
  const searchEl = $(searchId);
  const rawQ = ((searchEl && searchEl.value) || "").trim();
  const q = rawQ.toLowerCase();
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

function fillTranslateModelSelect() {
  fillRelaySearchSelect("translateModelSearch", "translateModelSelect", settings.translateModel || "");
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
    settings.translateModel = $("translateModelSelect").value.trim();
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
  $("translateModelSearch").addEventListener("input", () => {
    clearTimeout(translateSearchTimer);
    translateSearchTimer = setTimeout(fillTranslateModelSelect, 150);
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
  bindGlobalErrorReport();
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
const TRANSLATE_SYSTEM =
  "You are a translator for NovelAI image prompts. Translate the user's Chinese prompt into concise English danbooru-style tags. " +
  "Rules: keep weight syntax such as {…} and […] wrapping the translated content, keep artist:xxx tags and any already-English words unchanged, " +
  "separate tags with commas, no sentences or explanations, output ONLY the translated prompt.";

async function translatePromptText(text) {
  return await requestChatText(
    { base: settings.base, key: settings.key },
    settings.translateModel,
    TRANSLATE_SYSTEM,
    text,
    900
  );
}

function wireTranslateButton(btnId, taId) {
  const btn = $(btnId);
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const ta = $(taId);
    const text = (ta.value || "").trim();
    if (!text) {
      toast("内容为空，无需翻译", "warn");
      return;
    }
    if (!settings.translateModel) {
      toast("先在设置里选「翻译模型」再翻译", "warn");
      openSettings();
      return;
    }
    if (!/[\u4e00-\u9fff]/.test(text)) {
      toast("没有检测到中文，无需翻译", "ok");
      return;
    }
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = "翻译中…";
    try {
      const out = (await translatePromptText(text)).trim();
      if (!out) throw new Error("模型返回为空");
      ta.value = out;
      ta.dispatchEvent(new Event("input"));
      toast("已翻译为英文", "ok");
    } catch (e) {
      toast("翻译失败: " + (e.message || e), "error", 5000);
    }
    btn.disabled = false;
    btn.textContent = old;
  });
}

function bindTranslateButtons() {
  wireTranslateButton("translatePromptBtn", "promptInput");
  wireTranslateButton("translateNegativeBtn", "negativeInput");
}

/* 全局错误捕捉: 真机上任何脚本错误都可视化, 避免按钮没反应却查不到原因 */
function bindGlobalErrorReport() {
  window.addEventListener("error", (e) => {
    const msg = (e && e.message) || "未知脚本错误";
    toast("脚本错误: " + msg, "error", 9000);
    console.error("[global]", e && e.error || e);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e && e.reason;
    toast("异步错误: " + ((r && (r.message || r)) || "未知"), "error", 9000);
    console.error("[unhandled]", r);
  });
}

/* 自救: 若按钮卡在禁用但没有进行中的请求, 回到页面时自动恢复 */
window.addEventListener("pageshow", () => {
  if (!generating && $("generateBtn") && $("generateBtn").disabled) setGenerating(false);
});

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
  bindPrecise();
  bindRefMode();
  bindVibePresets();
  bindTranslateButtons();
  bindSizeControls();
  bindSliders();
  bindCountSeg();
  bindCanvasActions();
  bindCollapsibles();
  bindClearHistory();
  bindMetaImport();
  bindVibePngImport();
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
