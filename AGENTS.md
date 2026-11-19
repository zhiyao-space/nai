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

- Vibe 编码批量导出/导入用官方 Export as Encodings 同款 ZIP（每张一个 .naiv4vibe）：js/zip.js 新增 buildZipStore（store 无压缩 + CRC32 + 合法 DOS 日期）与 extractZipEntries（通用解包，支持 store/deflate）；本地头字段偏移（crc=14,csize=18,usize=22,nameLen=26）与中央目录不同，混用会导致解包读到文件名字节
- 「从 PNG 导入 Vibe」按钮仅提取 PNG 内嵌 vibe 编码加入氛围面板，不动其他参数；纯编码条目（b64 空、仅 encoded）刷新后仍持久化 encoded（saveVibes 对无原图项保留 encoded），卡片显示「Vibe 编码」占位块与编码状态徽标（已编码/已缓存=免费复用，否则生成时编码约 2 Anlas；改信息提取强度会实时刷新徽标，因缓存键含 infoExtracted）
- V4 请求体在 vibes 非空时发送 use_reference_image: true（官方字段）；氛围过滤条件为 v.b64 || v.encoded（纯编码条目也要能进 payload）
- 批量文本替换在 Bash heredoc 内联 python 偶发匹配失败（同一字符串单独验证能命中）→ 改用 Write 落盘 patch 脚本再执行，匹配稳定
- 华为/安卓机型上传图片两大坑：① file.type 常为空串/文件名可能是 .heic，按 MIME 或扩展名过滤都会静默丢文件，上传入口应不过滤、交给解码失败时报错；② file input 的 change 里必须先读 files 再清 input.value，先清会让 DocumentsUI 慢响应下 FileList 失效变空（bindPrecise 曾因此「没有收到文件」而 bindVibeTransfer 先读后清一直正常）
- 全局 Ctrl+V 粘贴要按当前参考模式 (refMode) 分流：此前固定进氛围图，导致精准参考模式下粘贴的图「消失」进隐藏面板
- localStorage 恢复的历史条目字段要补全：精准参考早期条目只存 b64 无 dataUrl，缩略图渲染直接 img.src=r.dataUrl 会图裂/空白，加载时需 map 补 dataUrl 或渲染时兜底 data:image/png;base64,+b64
- 参考图 UI 为单选切换模式（#refModeSwitch 分段控件，localStorage nai_ref_mode_v1）：氛围转移/精准参考两块 section 互斥显隐，切换只改 UI 可见性，数据两套都保留在 localStorage
- 本站全局 CSS 对 input 有宽高干扰：新增 range 滑杆/小数值框必须加 !important 固定宽高（.pr-slider/.pr-val 先例），否则滑杆会缩成圆点、数值框被拉满宽
- 精准参考卡片 (renderPreciseList) 为竖版结构：模式分段(.seg-btn)+用途说明、强度(-1~1)/保真(0~1)/信息提取(0~1) 三个滑杆(.pr-slider)+数值框、风格感知开关(仅非 style 模式显示，编码进 director_reference_descriptions 的 base_caption 后缀)、模式切换未手动调参时自动填推荐值；不走官方计费，不放 Anlas 提示：模式分段(.seg-btn)+用途说明、Strength(-1~1)/Fidelity(0~1) 滑块(.pr-slider)+数值框、风格感知开关(仅非 style 模式显示，编码进 director_reference_descriptions 的 base_caption 后缀)、模式切换未手动调参时自动填推荐值；费用提示 #preciseCostHint 按张数动态更新
- 精准参考 (director_reference_*) 与氛围转移互斥：payload 里同时存在时只发 director 字段，且必须把 reference_image_multiple / normalize_reference_strength_multiple 一并省略（发空数组会 400）；director 走原始 base64 无需 encode-vibe，requestGeneration 里要跳过氛围编码
- 空悲切中转站的 `reference_image_multiple` 只接受 `/v1/ai/encode-vibe` 编码后的 Vibe 二进制，原始图片 Base64 会报 400 INVALID_NATIVE_REQUEST；生成前须先编码，编码结果按「图片+强度+模型」本地缓存复用（编码收费约 2 Anlas/次）
- 官方下载的 PNG 自带 Vibe 编码是官方**前端**在下载时用 stealth alpha 隐写写入的（stealth_pngcomp：gzip JSON 列优先写入 alpha 最低位），后端返回的是裸图；本站 downloadImage 用 js/pngmeta.js embedPngMetadata 复现（JSON 内 vibes[].data=编码二进制 base64 为官方复用格式）
- 中转站/官方精准参考 (Precise Reference) 字段为 director_reference_images / descriptions / information_extracted / strength_values / secondary_strength_values（secondary = 1 - 保真度），与氛围转移互斥，仅 V4.5
- Vibe 编码可导出为官方 .naiv4vibe 格式（JSON {prompt:"vibe encoding for NAIV4", information_extracted, data:<编码base64>}），导入同理；只有 encoded 或编码缓存命中的条目可导出，纯原图条目需先生成一次完成编码
- Write 工具偶发把长文件内容写成本体被占位符替换的坏文件 → 写完先 cat 核实；多条 && 链式命令在托管管道里偶发只执行前几段且吞输出 → 关键步骤（patch/commit/push）单独发命令并回显结果
- 同一 app.js 里存在多处相似代码（如 head.appendChild(del)、commentToMeta(await readPngMetadata) 各 2-3 处）→ patch 脚本断言 count==1 会失败，改用 rfind/位置限定只替换目标处
- 对大文件做批量删功能时，用「起止标记行区间删除 + node --check 验证 + 残留关键词 grep」三步收敛，比逐个 Edit 稳
- jsdom 冒烟测试加载本站全量 JS 需补 polyfill：dom.window 上注入 TextEncoder/TextDecoder（zip.js CRC 前置）、Node 原生 Blob（jsdom Blob 无 arrayBuffer）、indexedDB 桩（db.js 加载即 dbOpen），并用 index.html 剥掉 script/link 标签后作 DOM，否则 app.js 初始化直接抛 null.innerHTML
- 精准参考捆绑格式：ZIP = ref_XX.png + precise_refs.json（{version:1, refs:[{type,strength,fidelity,infoExtracted,styleAware,image|data}]}），官方无精准参考文件格式，此为本站约定；导入兼容 ZIP 捆绑与普通图片
- 空悲切精准参考真实可用协议（逆向自其官方 MochiNai 前端 bundle）：走 /v1/chat/completions，消息体为 JSON 字符串，精准参考字段是 `character_references`（非官方 director_*）：[{image: dataURI, type:'character'|'style', fidelity, strength}]；氛围是 `controlnet.images`：[{image: dataURI, info_extracted, strength}]；响应为 Markdown data URI 图片。本站已实现为第三种接口格式 format:"kbq"。其原生接口的 director_reference_* 字段实测 500（自家 MochiNai 可用、第三方转发有 bug）
- collectParams 是 `return {...}` 直接返回字面量，patch 时若要在函数尾部处理返回值必须先把 `return {` 改成 `const p = {`，否则运行时 ReferenceError（node --check 查不出来）
- 沙箱重置会丢失 git remote origin，推送失败先检查 remote 是否存在再怀疑令牌
