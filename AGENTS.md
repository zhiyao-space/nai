# AGENTS.md

## 依赖
- 纯静态站点（无第三方运行时依赖），预览用 `python3 tools/serve.py`（pnpm run dev 会附加 `-- --port 3015` 参数，serve.py 需忽略未知参数）；`pnpm run build` = 对 5 个 js 文件跑 node --check

## 架构
- 纯前端 SPA：index.html + css/style.css + js/{api,app,db,zip,pngmeta,artists}.js，无构建步骤
- js/api.js 负责构建 payload：NovelAI 官方格式（V4: v4_prompt/characterPrompts/reference_*_multiple；V3: uc 单值）、OpenAI 兼容格式、空悲切 Chat 协议（format:"kbq"，/v1/chat/completions + JSON 消息体，精准参考=character_references，氛围=controlnet.images，响应为 Markdown data URI）
- 氛围图（vibes）持久化在 localStorage（超配额静默失败），生成历史在 IndexedDB（js/db.js）
- 画风锁定：PNG 元数据（pngmeta.js，含 stealth_pngcomp alpha 隐写）→ 命名预设存 localStorage（nai_vibe_presets_v1）→ generate() 里 applyVibePreset() 注入；启用预设时 Seed 自动滚动逻辑会跳过（保画风复现）
- 精准参考与氛围转移互斥；kbq Chat 协议氛围图必须原图（纯编码条目不支持）
- collectParams() 必须以 `return p;` 结尾（曾因漏写导致所有通道点不了），行内有注释标记

## What Didn't Work
- ❌ dev 脚本直接用 `python3 -m http.server`：pnpm 会附加 `-- --port 3015` 导致报错 → 改用 tools/serve.py 解析兼容
- ❌ Read 工具读取本仓库 .js 文件会误判为图片 → 用 Bash sed/cat 与 python 脚本做定点编辑
- ❌ Bash heredoc 内联 python 批量替换偶发截断/匹配失败 → Write 落盘 patch 脚本再执行
- ❌ jsdom w.eval 加载全量 JS 做冒烟测试：顶层 `window.addEventListener("pageshow")` 报 window is not defined，且该 eval 上下文无自由 addEventListener → 全量 DOM 冒烟成本高，改用 node 单测纯函数级逻辑验证

## Lessons
- git 推送通道间歇抖动（TLS -110 / Authentication failed / 超时），API /user 200 不代表 push 会成功；原样重试常可成功；沙箱重置会丢 git remote origin（推送失败先查 remote）
- 排查"线上没生效"先确认改动是否已 commit：工作区未提交的修改 git diff origin/main..HEAD 看不到
- 部署页"按钮点了没反应"类问题：全局 window error/unhandledrejection toast + pageshow 恢复卡死的 disabled 按钮，让用户看到真实报错文本再定位
- loadState() 恢复 localStorage 的 params.characters 必须过滤 null/非对象条目，否则 collectParams 读 c.prompt 崩溃（在 generate() 的 try 之前，表现为所有通道都点不了）
- 同一项目可能有多个会话并行改动：动手前先 git fetch origin main 并合并最新，避免覆盖其他会话的修复
- 缓存刷新靠 index.html 里 `js/xx.js?v=日期字母` 版本串，每次改 js 后要递增
