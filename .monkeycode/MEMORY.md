# User Instruction Memory

This file records user instructions, preferences, and teachings for reference in future interactions.

## Format

### User Instruction Entry
User instruction entries should follow this format:

[User Instruction Summary]
- Date: [YYYY-MM-DD]
- Context: [Mentioned scenario or time]
- Instructions:
  - [Content of user teaching or instruction, described line by line]

### Project Knowledge Entry
Entries discovered by the Agent during task execution should follow this format:

[Project Knowledge Summary]
- Date: [YYYY-MM-DD]
- Context: Discovered by Agent while performing [specific task description]
- Category: [Operations & Deployment|Build Methods|Testing Methods|Troubleshooting & Debugging|Workflow & Collaboration|Environment Configuration]
- Instructions:
  - [Specific knowledge points, described line by line]

## Deduplication Strategy
- Before adding a new entry, check for similar or identical instructions.
- If a duplicate is found, skip the new entry or merge it with the existing one.
- When merging, update the context or date information.
- This helps avoid redundant entries and keeps the memory file tidy.

## Entries

[项目路线图] NovelAI 官方功能对照缺口清单
- Date: 2026-11-07
- Context: Agent 对照 NovelAI 官方图像生成面板盘点本项目 (高仿 NovelAI 的中转站纯前端) 时整理，用户要求记住作为后续开发路线
- Category: Workflow & Collaboration
- Instructions:
  - 已实现: 文生图 / 图生图 / 局部重绘(蒙版画布) / 提示词+负向+画质词+UC 预设 / 画风卡片(简版) / V4.5-V4-V3 模型 / 角色提示词 / 氛围转移(Vibe Transfer) / Danbooru 画师串源库(搜索+缩略图预览+插入去重+收藏, 画师库地址可配置, 断网回退内置离线合集 js/artists.js) / Variety+ / CFG 残差 / 噪声调度 / 尺寸预设 / IndexedDB 历史+复用参数 / NovelAI+OpenAI 双格式 / ZIP 解压 / Anlas 估算 / 手机优先分页
  - 待补 (优先级高): 角色参考 (Character Reference, V4.5): 每个角色挂参考图+信息提取/参考强度, 与氛围转移同构, 对应官方 characterPrompts 内 reference 字段
  - 待补: Augment 图像增强标签页: 官方第四标签 (变体 Demux / 上色 Colorize / 表情 Emotion / 去杂物 Declutter / 抠图 Remove BG), 走官方 augment 接口
  - 待补: 提示词变体 (Variations): {a|b} 变体语法 + variation seed, 字段实现时以官方抓包为准
  - 待补: Vibe 掩码 (V4.5): 给氛围图涂 mask 限定影响区域, 字段需核对官方
  - 待补: V3 SMEA / SMEA DYN 开关: 目前 sm/sm_dyn 写死 false, 官方 V3 有此 UI
  - 待补: 官方 Style Presets 预设系统 (可保存/复用提示词+参数组合), 目前画风卡片是本地简版替代
  - 待补: Generate Forever 官方式重掷 (同参数 seed 递增连续出图)
  - 待补: Anlas 精确计费公式 (官方按分辨率/步数/模型档位精确算, 氛围转移另计费), 目前是粗略估算
  - 待补: 提示词 Token 计数 (官方按 CLIP token 计, 目前按字符数)
  - 待补: 局部重绘 add_original_image 开关 (官方可选, 目前写死 true)
  - 待补: 官方模型清单补全 (Furry 等系列模型 ID) / 蒙版羽化与图层增强 / 历史分页+批量下载 ZIP / 偏好设置面板
  - 约定: 每个新功能先对照官方请求体结构对齐 (js/api.js buildNaiPayload), NovelAI 原生格式优先, OpenAI 格式对不上的官方特性直接忽略并提示

[部署链路] GitHub Pages 发布流程
- Date: 2026-11-08
- Context: 推送 main 后线上站点未更新, 排查发现 Pages 为 legacy 模式, 部署源是 gh-pages 分支
- Category: Operations & Deployment
- Instructions:
  - Pages 配置: legacy 模式, 部署源 = gh-pages 分支根目录, 线上地址 https://zhiyao-space.github.io/nai/
  - gh-pages 约定: 仅站点文件 (.nojekyll / index.html / css/ / js/), 排除 README.md 与 .monkeycode/
  - 发布流程: 推 main 之后, 用临时索引构造发布树并快进推送 gh-pages: `GIT_INDEX_FILE=/tmp/x.index git read-tree origin/main && git rm -r --cached .monkeycode README.md && git update-index --add --cacheinfo 100644,$(git hash-object -w --stdin </dev/null),.nojekyll && git write-tree` 然后 `git commit-tree <tree> -p origin/gh-pages` 再 `git push <url> ${COMMIT}:refs/heads/gh-pages`
  - 推送认证: 平台凭据助手对 github.com 返回 500, 用一次性 URL 带 token 推送; 注意本环境是 zsh, `$COMMIT:refs/...` 会被 `:r` 修饰符吃掉, 必须写 `${COMMIT}:refs/...`
  - 验证: Pages 构建约 40s, curl 线上 js 资源与页面关键字确认
