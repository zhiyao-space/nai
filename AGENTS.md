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

- 「从 PNG 导入 Vibe」按钮仅提取 PNG 内嵌 vibe 编码加入氛围面板，不动其他参数；纯编码条目（b64 空、仅 encoded）刷新后仍持久化 encoded（saveVibes 对无原图项保留 encoded），卡片显示「Vibe 编码」占位块与编码状态徽标（已编码/已缓存=免费复用，否则生成时编码约 2 Anlas；改信息提取强度会实时刷新徽标，因缓存键含 infoExtracted）
- V4 请求体在 vibes 非空时发送 use_reference_image: true（官方字段）；氛围过滤条件为 v.b64 || v.encoded（纯编码条目也要能进 payload）
- 批量文本替换在 Bash heredoc 内联 python 偶发匹配失败（同一字符串单独验证能命中）→ 改用 Write 落盘 patch 脚本再执行，匹配稳定
- 空悲切中转站的 `reference_image_multiple` 只接受 `/v1/ai/encode-vibe` 编码后的 Vibe 二进制，原始图片 Base64 会报 400 INVALID_NATIVE_REQUEST；生成前须先编码，编码结果按「图片+强度+模型」本地缓存复用（编码收费约 2 Anlas/次）
- 官方下载的 PNG 自带 Vibe 编码是官方**前端**在下载时用 stealth alpha 隐写写入的（stealth_pngcomp：gzip JSON 列优先写入 alpha 最低位），后端返回的是裸图；本站 downloadImage 用 js/pngmeta.js embedPngMetadata 复现（JSON 内 vibes[].data=编码二进制 base64 为官方复用格式）
- 中转站/官方精准参考 (Precise Reference) 字段为 director_reference_images / descriptions / information_extracted / strength_values / secondary_strength_values（secondary = 1 - 保真度），与氛围转移互斥，仅 V4.5
- Vibe 编码可导出为官方 .naiv4vibe 格式（JSON {prompt:"vibe encoding for NAIV4", information_extracted, data:<编码base64>}），导入同理；只有 encoded 或编码缓存命中的条目可导出，纯原图条目需先生成一次完成编码
- Write 工具偶发把长文件内容写成本体被占位符替换的坏文件 → 写完先 cat 核实；多条 && 链式命令在托管管道里偶发只执行前几段且吞输出 → 关键步骤（patch/commit/push）单独发命令并回显结果
- 同一 app.js 里存在多处相似代码（如 head.appendChild(del)、commentToMeta(await readPngMetadata) 各 2-3 处）→ patch 脚本断言 count==1 会失败，改用 rfind/位置限定只替换目标处
- 对大文件做批量删功能时，用「起止标记行区间删除 + node --check 验证 + 残留关键词 grep」三步收敛，比逐个 Edit 稳
- 沙箱重置会丢失 git remote origin，推送失败先检查 remote 是否存在再怀疑令牌
