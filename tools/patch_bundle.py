# -*- coding: utf-8 -*-
import io

P = "js/app.js"
s = io.open(P, encoding="utf-8").read()

# ---- 1. bundle export function, placed after exportVibeEncoding ----
anchor = "function vibeBadgeState(v) {"
helper = '''function exportVibeBundle() {
  /* 多张氛围图捆绑导出: 单文件 JSON, vibes[] 每项与 .naiv4vibe 字段一致 */
  if (!vibes.length) { toast("先上传至少一张氛围图", "warn"); return; }
  const items = [];
  let skipped = 0;
  for (const v of vibes) {
    const enc = vibeExportEncoding(v);
    if (!enc) { skipped++; continue; }
    items.push({ prompt: "vibe encoding for NAIV4", information_extracted: Number(v.infoExtracted ?? 1), data: enc, referenceStrength: Number(v.referenceStrength ?? 0.6) });
  }
  if (!items.length) { toast("没有可导出的编码：先用当前参数生成一次完成编码", "warn", 6000); return; }
  const bundle = { format: "nai-vibe-bundle-v1", count: items.length, vibes: items };
  const blob = new Blob([JSON.stringify(bundle)], { type: "application/json" });
  downloadBlob(blob, "vibe_bundle_" + Date.now() + ".json");
  toast(`已导出 ${items.length} 条编码${skipped ? ` (跳过 ${skipped} 条未编码)` : ""}, 单文件即可分享`, "ok", 5000);
}

function vibeBadgeState(v) {'''
assert s.count(anchor) == 1, "anchor"
s = s.replace(anchor, helper, 1)

# ---- 2. import bundle / multi-file: replace the single naiv4vibe branch with a loop-friendly one ----
old_branch = '''    if (/\\.(naiv4vibe|json)$/i.test(file.name)) {'''
assert s.count(old_branch) == 1, "branch"
# bind handler: support multiple files + bundle array. Replace whole bind section instead.
old_bind_head = '''  const file = vibePngInput.files && vibePngInput.files[0];
  vibePngInput.value = "";
  if (!file) return;
  try {'''
new_bind_head = '''  const files = Array.from(vibePngInput.files || []);
  vibePngInput.value = "";
  if (!files.length) return;
  let okCount = 0;
  for (const file of files) {
    try { await importVibeFile(file); okCount++; } catch (e) { toast((file.name || "文件") + " 导入失败: " + e.message, "err", 5000); }
  }
  if (okCount) { renderVibeList(); saveVibes(); }
});

async function importVibeFile(file) {
  {'''
assert s.count(old_bind_head) == 1, "bindhead"
s = s.replace(old_bind_head, new_bind_head, 1)

# ---- 3. inside importVibeFile: bundle branch before single vibe ----
old_import = "    if (/\\.(naiv4vibe|json)$/i.test(file.name)) {"
new_import = '''    if (/\\.json$/i.test(file.name)) {
      const obj = JSON.parse(await file.text());
      if (Array.isArray(obj && obj.vibes)) {
        /* 捆绑文件 (nai-vibe-bundle-v1): 多条编码一次导入 */
        let added = 0;
        for (const item of obj.vibes) {
          const enc = item && (item.data || item.encoded || item.image);
          if (!enc) continue;
          if (vibes.length >= VIBE_LIMIT) { toast(`氛围图最多 ${VIBE_LIMIT} 张, 剩余未导入`, "warn"); break; }
          vibes.push({ id: crypto.randomUUID(), b64: "", dataUrl: "", encoded: String(enc), infoExtracted: Number(item.information_extracted ?? item.infoExtracted ?? 1), referenceStrength: Number(item.strength ?? item.referenceStrength ?? 0.6) });
          added++;
        }
        if (!added) { toast("捆绑文件里没有可用编码", "err"); return; }
        toast(`已从捆绑文件导入 ${added} 条编码 (免费复用)`, "ok");
        return;
      }
    }
    if (/\\.(naiv4vibe|json)$/i.test(file.name)) {'''
assert s.count(old_import) == 1, "import"
s = s.replace(old_import, new_import, 1)

io.open(P, "w", encoding="utf-8").write(s)
print("patch-bundle ok")
