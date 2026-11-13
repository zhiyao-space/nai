# AGENTS.md

## 依赖
- 纯静态站点（无第三方运行时依赖），预览用 `python3 tools/serve.py`（pnpm run dev 会附加 `-- --port 3015` 参数，serve.py 需忽略未知参数）

## 架构
- 纯前端 SPA：index.html + css/style.css + js/{api,app,db,zip,pngmeta}.js，无构建步骤
- js/api.js 负责构建 NovelAI 官方 payload（V4: v4_prompt/characterPrompts/reference_*_multiple；V3: uc/reference_image 单值）与 OpenAI 兼容 payload
- 氛围图（vibes）持久化在 localStorage（超配额静默失败），生成历史在 IndexedDB（js/db.js）
- 「画风锁定」按用户文档实现：PNG 元数据（js/pngmeta.js readPngMetadata + commentToMeta）→ 命名预设存 localStorage（nai_vibe_presets_v1 / nai_vibe_active_id）→ generate() 里 applyVibePreset() 注入（画师串前置拼接 prompt，seed/scale/steps/cfgRescale/sampler 覆盖，negative 仅在用户留空时注入），不依赖中转站的氛围转移字段
- 上传的参考图统一经 downscaleToMax 缩到最长边 1024 再转 base64

## What Didn't Work
- ❌ dev 脚本直接用 `python3 -m http.server 3015`：pnpm 会附加 `-- --port 3015` 导致 python 报未知参数 → 改用 tools/serve.py 解析兼容
- ❌ Read 工具读取本仓库 .js/.json 文件会被误判为图片 → 改用 Bash sed/cat 与 python 脚本做定点编辑

## Lessons
- 对大文件做批量删功能时，用「起止标记行区间删除 + node --check 验证 + 残留关键词 grep」三步收敛，比逐个 Edit 稳
