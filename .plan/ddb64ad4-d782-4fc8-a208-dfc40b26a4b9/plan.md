# 需求文档

## 1. Task summary

按官方 Precise Reference 文档重做「精准参考」面板的 UI 与功能：把目前一行挤下缩略图+下拉+两个数字框的简陋条目，升级为与氛围转移卡片同风格的竖版卡片，并补齐文档中的官方能力（负值支持、Style Aware 开关、推荐参数预设、Anlas 费用提示）。用户截图确认：上传修复已成功（缩略图已显示），本轮只做 UI 美化 + 功能增强，不动上传链路。

## 2. 视觉风格

- **参考来源**：本项目既有 NovelAI 深色紫罗兰主题（深底 + 紫色高亮 + 圆角卡片），氛围转移面板的 `.vibe-card` 系列是直接的视觉参照。
- **整体取向**：精准参考条目改为竖版卡片：左侧大缩略图（参照 `.vibe-thumb`），右侧参数区纵向排列；顶部一行「模式分段选择 (seg 样式) + 删除按钮」；中间两个**滑块**（Strength / Fidelity）取代裸数字输入框，滑块右端显示数值；底部一行「Style Aware 开关（仅 character / character&style 模式显示）+ 推荐值提示」。
- **受影响区块**：仅「精准参考 (Precise Reference)」卡片内部；氛围转移、画风锁定面板不动。移动端（用户主力场景）与桌面端均需可用。

## 3. 功能增强（全部来自用户提供的官方文档）

1. **滑块替代裸输入框**：Strength 与 Fidelity 用自定义 range 滑块 + 数值显示；点击数值可手动输入（官方支持负值，Strength 范围 -1~1，Fidelity 范围 0~1）。
2. **Style Aware 开关**：character 与 character&style 模式下显示「风格感知」toggle（复用现有 `.switch/.slider` 样式，默认开启）；关闭时仅锁定角色身份不带画风。API 字段：`director_reference_descriptions[].caption.base_caption` 附加 style_aware 信息（按官方 payload 结构编码进 base_caption 前缀，与现有 type 编码方式合并，不新增字段名）。
3. **推荐参数预设**：每个模式切换时若用户未手动改过参数，自动填入社区推荐值（character: 强度 0.6 / 保真 0.7；style: 强度 0.8 / 保真 0.6；character&style: 强度 0.7 / 保真 0.7），用户手动调节后不再覆盖。
4. **Anlas 费用提示**：精准参考模式下在上传框下方显示一行小字「每张参考图每次生成 +5 Anlas，与 Opus 免费额度独立」，按当前张数动态显示（如「2 张参考 ≈ +10 Anlas/次」）。
5. **模式提示联动**：选择模式时在卡片内显示该模式的用途一句话说明（复现外观 / 锁定画风 / 两者兼顾），替代现在只有下拉文字的干巴巴选择。
6. **既有互斥逻辑保持不变**：与氛围转移互斥、V4.5 模型警示、上传无过滤——均已实现，本轮不回归改动。

## 4. Files to be modified

- `js/app.js`：preciseRefs 条目新增 styleAware、manualTuned 字段（savePrecise/loadState 兼容旧数据补默认值）；重写 renderPreciseList (L1272-1312) 为竖版卡片 + 滑块 + toggle + 预设联动；模式切换自动填推荐值的逻辑。
- `js/api.js`：buildNaiPayload (L188-196) 的 director_reference_descriptions 组装扩展 style_aware 编码（保持向后兼容：旧条目无 styleAware 默认 true）。
- `index.html`：精准参考区块（L90-103）增加 Anlas 费用提示行容器（#preciseCostHint）。
- `css/style.css`：新增 .precise-card 系列样式（参照 .vibe-card 风格）、自定义 range 滑块样式（.pr-slider）、模式说明文字样式；复用现有 .seg/.switch。

## 5. Implementation approach

- 逐文件 patch（python 落盘脚本或 Edit 小段替换），渲染函数整体重写替换；数据结构只加字段不改旧字段，loadState 对旧 localStorage 数据补默认值，保证用户已存的参考图无感升级。
- 滑块 change 事件更新对象 + savePrecise()（沿用现有节流方式）。
- 静态资源版本号统一 bump（index.html ?v=）。

## 6. Testing considerations

- node --check 两个 js 文件；本地 jsdom 渲染冒烟测试（构造条目 → renderPreciseList → 断言卡片/滑块/toggle 数量与 img.src）。
- payload 构建测试：带 styleAware true/false 的条目分别构建，核对 director_reference_descriptions 输出；负值 strength 正确传入 strength_values。
- pnpm run build（静态站需通过 tools/serve.py 无报错）+ pnpm run dev 预览 + 移动端视口截图验收。
- 推送 GitHub main 分支（用户在 GitHub Pages 上使用）。