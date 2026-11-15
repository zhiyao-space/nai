# 需求文档

## 1. 任务概述

继续完善"氛围转移"功能，目标两个：**画风更稳定**、**逻辑结构更对齐 NovelAI 官方**。经代码测绘发现 1 个实际 Bug 和 2 个官方逻辑缺口，加上体验增强，共 4 项改动。

## 2. 发现的问题（改动依据）

1. **Bug：导入官方 PNG 丢失 Vibe 编码**——「导入参数」恢复氛围图时 `vibes.filter(v => v.b64)` 会把只有编码数据（`encoded` 有值、`b64` 为空）的官方 vibe 项整个丢弃（js/app.js reuseParams）。导致官方 PNG 里免费携带的编码被浪费。
2. **官方字段缺口**——官方 V4 请求体在有氛围图时会发送 `use_reference_image: true`，我们的 buildNaiPayload 没发这个字段。
3. **编码状态不可见**——氛围图卡片不显示编码缓存状态，用户不知道哪些图已编码（命中缓存不扣费）、哪些要花编码费。

## 3. 改动点（共 4 项）

1. **修复导入闭环**：reuseParams 恢复氛围图时同时接受 `v.b64` 或 `v.encoded`；只有编码数据时缩略图显示占位色块（无原图数据，属正常），生成时直接用编码免重新编码。
2. **补官方字段**：buildNaiPayload V4 分支在 vibes 存在时补发 `use_reference_image: true`（对齐官方请求体）。
3. **编码状态徽标**：氛围图卡片头部显示「已编码（免费复用）」/「生成时编码（约 2 Anlas）」小徽标；检查编码缓存 key 命中情况展示状态，拖动信息提取滑杆时状态实时刷新（改变提取强度会使命中失效）。
4. **一键导入 Vibe（官方导入逻辑）**：氛围转移卡片新增「从 PNG 导入 Vibe」按钮——选择官方或本站生成的 PNG，仅提取内嵌的 Vibe 编码加入氛围面板，**不动其他参数**（区别于现有"导入参数"会覆盖全部参数）；官方 PNG 的编码直接免费复用。

## 4. 视觉说明

延续现有深色 NovelAI 风格：徽标用小号圆角胶囊（绿色=已编码免费 / 灰色=待编码），新按钮沿用现有 mini-btn 样式，不引入新的视觉体系，仅氛围转移卡片内部受影响。

## 5. 涉及文件

- js/app.js — reuseParams 修复、renderVibeList 徽标、新增 importVibeFromPng 处理与按钮绑定
- js/api.js — buildNaiPayload 补 use_reference_image
- js/pngmeta.js — 无需改动（commentToMeta 已能解析官方 vibes[].data）
- index.html — 氛围转移卡片加「从 PNG 导入 Vibe」按钮 + 隐藏 file input
- css/style.css — 编码状态徽标样式（.vibe-enc-badge）

## 6. 验收标准

- [ ] 导入一张带 Vibe 编码的官方 PNG 后，氛围面板出现对应氛围图，生成请求 `reference_image_multiple` 直接携带导入的编码（不调用 encode-vibe）
- [ ] 生成带氛围图时请求体含 `use_reference_image: true`
- [ ] 氛围图卡片能看到编码状态徽标，且修改"信息提取"后徽标变为"待编码"
- [ ] 「从 PNG 导入 Vibe」只改氛围面板，提示词/参数不受影响
- [ ] pnpm run build 通过，预览正常

## 7. 本期不做

- 氛围图拖拽排序（官方列表无顺序语义）
- 画风预设绑定编码（涉及预设文件格式变更，留待后续）
- V5 相关功能（中转站未开放）
