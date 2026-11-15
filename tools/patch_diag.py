# -*- coding: utf-8 -*-
p = 'js/app.js'
s = open(p, encoding='utf-8').read()
old = '''      const list = (meta && Array.isArray(meta.vibes)) ? meta.vibes.filter((v) => v.b64 || v.encoded) : [];
      if (!list.length) {
        toast("该 PNG 未内嵌 Vibe 数据 (仅支持官方或本站生成的图)", "warn");
        return;
      }'''
new = '''      const list = (meta && Array.isArray(meta.vibes)) ? meta.vibes.filter((v) => v.b64 || v.encoded) : [];
      if (!list.length) {
        if (meta && (meta.prompt || meta.width)) {
          toast("这张图有生成参数, 但生成时氛围面板是空的, 所以没嵌入 Vibe 数据。请在生成它之前先添加氛围图, 或导入官方带 Vibe 的 PNG", "warn", 6500);
        } else {
          toast("该 PNG 未内嵌生成参数和 Vibe 数据 (可能被微信/QQ/截图二次压缩破坏, 请用浏览器里下载按钮保存的原始 PNG)", "warn", 6500);
        }
        return;
      }'''
assert s.count(old) == 1, "anchor count=%d" % s.count(old)
s = s.replace(old, new)
open(p, 'w', encoding='utf-8').write(s)
print("patch-diag ok")
