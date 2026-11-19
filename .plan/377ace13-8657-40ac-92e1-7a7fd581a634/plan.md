# 需求文档

## 1. 改动目标
用户反馈：自从使用第三个"接口格式"——空悲切 Chat 协议 (/v1/chat/completions, kbq) 后，点击"生成图像"就报错 `Cannot read properties of undefined (reading 'prompt')`（新防护提示已确认崩溃发生在 generate() 入口的参数收集/校验段内）。目标：定位并修复 kbq 格式下的崩溃，使三种接口格式（NAI 官方 / OpenAI 兼容 / 空悲切 Chat）都能正常生成。

## 2. 现状 vs 目标
- 现状：选择"空悲切 Chat 协议"格式后点生成，弹出"生成参数存在异常数据…(Cannot read properties of undefined (reading 'prompt'))"，无法生成；NAI/OpenAI 格式历史行为正常。
- 目标：kbq 格式下点"生成图像"能正常发起请求并出图；任何参数脏数据均被自动清洗，不再抛未处理异常。

## 3. 排查与修复步骤
1. **jsdom 复现**：用现有 jsdom 环境模拟 format=kbq + 典型 kbq 配置（自定义模型名、氛围图仅 encoded 编码条目、精准参考、多图 n>1、img2img/inpaint）逐组合跑 `generate()`，抓出确切抛错行。
2. **全链路审计加固**（js/app.js 与 js/api.js 中 kbq 相关路径）：
   - `buildKbqChatPayload`：对 `p.prompt / p.negative / p.characters` 全部字符串化兜底；
   - `requestGeneration` / `ensureVibesEncoded` / `encodeVibe`：参数缺字段时兜底，不抛 TypeError；
   - 设置保存切换为 kbq 格式时的联动函数（`updateModelSelectView / populateSamplers / updateVibeHints / updateNegativePlaceholder`）排查 `.prompt` 读取点；
   - generate() 中 kbq 分支 `runBatch(settings)` 与 `requestGeneration(settings, p, …)` 路径确认 p 字段完整性。
3. **若复现仍不触发**：依赖已上线的堆栈提示（app.js?v=20261119i 会在红色提示中显示 app.js:行号），请用户重试一次并截图堆栈行号，按行号精准修复。
4. **收尾**：`node --check` + `pnpm run build` 通过；index.html 版本号再次升级（如 v=20261119j）强制刷新缓存；提交并用用户提供的 GitHub Token 推送到 zhiyao-space/nai main；curl 验证 GitHub Pages 已更新。

## 4. 影响面与调用链
```
生成按钮 → generate()
  ├─ normalizeCharacters / collectParams / applyVibePreset（已有防护，本轮继续兜底）
  ├─ settings.format === "kbq" → requestGeneration(settings, p)
  │     ├─ ensureVibesEncoded → encodeVibe（kbq 专属编码）
  │     └─ buildKbqChatPayload → generateKbqChat → /v1/chat/completions
  └─ runBatch（n>1 分批）
```
改动集中在 `js/app.js`、`js/api.js`（kbq 分支），不影响 NAI/OpenAI 两条已有通道的行为。

## 5. 回归与兼容风险
| 风险点 | 说明 | 对策 |
|---|---|---|
| 改动 kbq payload 结构影响中转站解析 | 字段仅做兜底不新增 | 只补默认值，不增删字段 |
| 缓存导致用户仍跑旧脚本 | 手机浏览器缓存 | 版本号升级 + 引导强刷 |
| 其他格式回归 | 公共路径改动 | jsdom 三种格式各跑一遍生成入口 |

## 6. 验收标准
- jsdom 复现（若成功）下 kbq 格式生成不再抛错；
- `pnpm run build` 通过、本地预览 200；
- GitHub Pages 线上 index.html 引用新版本号且包含修复代码；
- 用户真机强刷后 kbq 格式可正常生成出图，无"异步错误/生成参数异常"提示。

## 7. 不改动范围
- 不改动 NAI 官方格式与 OpenAI 兼容格式的请求结构和行为；
- 不改动 UI 布局、氛围预设按钮、历史记录功能；
- 不改动 GitHub Pages 部署配置。