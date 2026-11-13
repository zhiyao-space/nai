import re, sys

def load(p):
    with open(p, encoding="utf-8") as f:
        return f.readlines()

def save(p, lines):
    with open(p, "w", encoding="utf-8") as f:
        f.writelines(lines)

def cut_sections(lines, specs):
    """specs: list of (start_marker, end_marker_exclusive) delete [start, end)"""
    remove = set()
    for start_m, end_m in specs:
        s = e = None
        for i, ln in enumerate(lines):
            if s is None and re.search(start_m, ln):
                s = i
            elif s is not None and re.search(end_m, ln):
                e = i
                break
        if s is None or e is None:
            print("MISS:", start_m, "->", end_m); sys.exit(1)
        for i in range(s, e):
            remove.add(i)
    return [ln for i, ln in enumerate(lines) if i not in remove]

def drop_lines(lines, pat):
    out = [ln for ln in lines if not re.search(pat, ln)]
    if len(out) == len(lines):
        print("NODROP:", pat); sys.exit(1)
    return out

def sub(lines, old, new, count=1):
    text = "".join(lines)
    if text.count(old) < count:
        print("NOSUB:", old[:60]); sys.exit(1)
    return (text.replace(old, new, count)).splitlines(keepends=True)

# ---------- app.js ----------
a = load("/home/project/js/app.js")
a = cut_sections(a, [
    (r"^const STYLES", r"^const DEFAULT_PARAMS"),
    (r"^function buildStyleGrid", r"^/\* ---------- action mode"),
    (r"^/\* ---------- artist library", r"^/\* ---------- canvas"),
    (r"^/\* ---------- style presets", r"^/\* ---------- style tag picker"),
    (r"^/\* ---------- style tag picker", r"^function blobToB64"),
    (r"^function fillVisionModelSelect", r"^function fillTranslateModelSelect"),
    (r'\$\("visionModelSearch"\)\.addEventListener', r'\$\("translateModelSearch"\)\.addEventListener'),
    (r"^function rgbToHsl", r"^const TRANSLATE_SYSTEM"),
    (r"^function bindStyleExtraction", r"^/\* ---------- A/B preset verification"),
    (r"^/\* ---------- A/B preset verification", r"^function init\(\)"),
])
a = drop_lines(a, r"visionSearchTimer|const timerKey|settings\.artistBase|settings\.visionModel|settings\.activeStylePreset")
a = drop_lines(a, r"style: \"none\",")
a = drop_lines(a, r'styleTags: styleTags\(\),')
a = drop_lines(a, r"stylePreset: p\.stylePresetName \|\| null,")
a = drop_lines(a, r"bindArtistLibrary\(\);|bindStylePresets\(\);|bindStyleExtraction\(\);|buildStyleGrid\(\);")
a = drop_lines(a, r'\s*artistBase: "https://danbooru\.donmai\.us",')
a = drop_lines(a, r'\s*visionModel: "",')
a = drop_lines(a, r'\$\("visionModelSearch"\)\.value = "";')
# settingsModal refresh line: strip only the vision call
a = sub(a, "fillApiModelSelect(); fillVisionModelSelect(); fillTranslateModelSelect();",
           "fillApiModelSelect(); fillTranslateModelSelect();")
# remove applyStylePreset call block in generate()
text = "".join(a)
m = re.search(r"\n  const activePreset = getActiveStylePreset\(\);\n  if \(activePreset\) applyStylePreset\(p, activePreset\);\n", text)
if m:
    text = text.replace(m.group(0), "\n")
else:
    print("MISS applyStylePreset block"); sys.exit(1)
# openSettings: remove artistBase / vision lines
text = re.sub(r"\n\s*\$(\"artistBase\")\.value = settings\.artistBase \|\| \"\";", "", text)
text = re.sub(r"\n\s*\$(\"visionModelSearch\")\.value = \"\";", "", text)
text = re.sub(r"\n\s*settings\.artistBase = \$\(\"artistBase\"\)\.value\.trim\(\) \|\| \"https://danbooru\.donmai\.us\";", "", text)
text = re.sub(r"\n\s*settings\.visionModel = \$\(\"visionModelSelect\"\)\.value\.trim\(\);", "", text)
text = re.sub(r"\n\s*settings\.activeStylePreset[^\n]*\n", "\n", text)
a = text.splitlines(keepends=True)
save("/home/project/js/app.js", a)

# ---------- api.js ----------
p = load("/home/project/js/api.js")
p = cut_sections(p, [
    (r"^async function requestVisionAnalysis", r"^const NAI_MODELS"),
])
text = "".join(p)
text = text.replace(
    "function composePrompt(rawPrompt, family, qualityOn, styleTags) {\n  const parts = [rawPrompt.trim()];\n  if (styleTags) parts.push(styleTags.trim());\n  if (qualityOn && QUALITY_TAGS[family]) parts.push(QUALITY_TAGS[family]);\n  return parts.filter(Boolean).join(\", \");\n}",
    "function composePrompt(rawPrompt, family, qualityOn) {\n  const parts = [rawPrompt.trim()];\n  if (qualityOn && QUALITY_TAGS[family]) parts.push(QUALITY_TAGS[family]);\n  return parts.filter(Boolean).join(\", \");\n}")
text = text.replace("composePrompt(p.prompt, family, p.qualityOn, p.styleTags)", "composePrompt(p.prompt, family, p.qualityOn)")
text = text.replace("composePrompt(p.prompt, 0, p.qualityOn, p.styleTags)", "composePrompt(p.prompt, 0, p.qualityOn)")
if "styleTags" in text or "requestVisionAnalysis" in text or "artistBase" in text:
    for i, ln in enumerate(text.splitlines(), 1):
        if "styleTags" in ln or "requestVisionAnalysis" in ln or "artistBase" in ln:
            print("api residue", i, ln[:100])
    sys.exit(1)
save("/home/project/js/api.js", text.splitlines(keepends=True))

# ---------- index.html ----------
h = load("/home/project/index.html")
h = cut_sections(h, [
    (r"画师串源库 \(Danbooru\)", r"画风预设 \(稳定画风\)"),
    (r"画风预设 \(稳定画风\)", r"氛围转移 \(Vibe Transfer\)"),
])
h = cut_sections(h, [
    (r"画风一键加成", r"</section>"),
])
# settings fields: artist base & vision model
h = cut_sections(h, [
    (r"<label>画师库地址", r"<label>翻译模型 \(可选\)"),
    (r"<label>视觉分析模型", r"<label>翻译模型 \(可选\)"),
])
text = "".join(h)
text = text.replace('<script src="js/artists.js?v=20261110g"></script>\n', "")
if "artist" in text.lower() or "vision" in text.lower() or "画风预设" in text:
    print("html residue"); sys.exit(1)
save("/home/project/index.html", text.splitlines(keepends=True))
print("OK")
