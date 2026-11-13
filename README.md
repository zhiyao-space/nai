# NovelAI 图像生成 (中转站版)

高仿 NovelAI 官方图像生成 (Image Generation) 逻辑结构的纯前端单页应用。所有 API 请求走中转站，密钥仅保存在浏览器本地。

## 功能

- NovelAI 风格界面: 左侧参数面板 / 中央画布 / 右侧生成历史
- 提示词 + 负向提示词, 质量标签与 UCP 负向预设 (按模型系列自动切换)
- 模型列表自动从中转站 `{Base URL}/v1/models` 动态拉取, 图像模型智能分组置顶, 支持自定义模型名
- 生成模式: 文生图 (generate) / 图生图 (img2img) / 局部重绘 (inpaint, 内置蒙版画布)
- 图生图: 源图上传 (点击 / 拖拽 / Ctrl+V 粘贴), 强度 Strength 与噪声 Noise, 尺寸自动同步源图
- 角色提示词 (V4): 多角色独立正负提示词 + X/Y 位置坐标, 对应官方 characterPrompts 与 v4_prompt.char_captions 结构
- 氛围转移 (Vibe Transfer): 最多 5 张参考图, 每张独立信息提取强度与参考强度, V4/V4.5 多图 / V3 单图, 仅 NovelAI 官方格式
- 图像尺寸预设 (竖图 / 横图 / 方图, 普通与大图), 宽高自定义
- Steps / Scale / 采样器 (按模型系列动态切换, V4.5 与 V3 采样器名不同) / 噪声调度 / Variety+ (官方 sigma 公式) / CFG 残差 / Seed / 生成数量
- 中→英 提示词翻译 (可选配置翻译模型)
- NovelAI 官方格式响应为 ZIP 内含 PNG, 已内置解压与 PNG 提取
- 生成历史使用 IndexedDB 持久化, 支持复用参数、下载、删除、清空
- 手机优先分页布局: 底部标签页切换 创作 / 画布 / 历史, 桌面端自动恢复三栏布局
- Ctrl + Enter 快捷生成

## 与 NovelAI 官方 API 的结构对齐

NovelAI 格式的请求体与官方前端逻辑一致, 便于直连或中转:

- V4/V4.5: `params_version: 3`, `v4_prompt` / `v4_negative_prompt` (含 char_captions + centers), `characterPrompts` (prompt / uc / center / enabled), `negative_prompt`, `use_coords`, `use_order`
- V3: `params_version: 2`, `uc` 字段, `sm` / `sm_dyn`
- Variety+ = `skip_cfg_above_sigma`, 官方公式: `sqrt((宽x高)/1011712) * (V4.5: 58, 其他: 19)`
- 图生图: `action: "img2img"` + `image` (base64) + `strength` + `noise` + `extra_noise_seed`
- 局部重绘: `action: "inpaint"` + `image` + `mask` (base64 PNG, 白色为重绘区域) + `add_original_image: true`
- 氛围转移: V4/V4.5 为 `reference_image_multiple` / `reference_information_extracted_multiple` / `reference_strength_multiple` 三个平行数组; V3 为单值字段
- 采样器: V4.5/V4 使用 `k_euler_a` / `k_dpmpp_2m_sde` 等命名, V3 使用 `k_euler_ancestral` 等命名

## 中转站 API 配置

点击右上角「设置」:

| 配置项 | 说明 |
|--------|------|
| 中转站地址 (Base URL) | 例如 `https://api.example.com`, 自动补全 https 前缀 |
| API Key | 中转站密钥, 以 `Authorization: Bearer` 头发送 |
| 接口格式 | 见下方两种格式说明 |
| 请求路径 | 可选, 覆盖默认路径, 适配特殊中转站 |
| 模型 | 保存设置后自动从中转站拉取; 也可在「自定义模型名」填写模型 ID, 填写后优先生效 |

### NovelAI 官方格式 (默认, 推荐空悲切等中转站使用)

适用于转发 `image.novelai.net` 或提供 NovelAI 原生格式调用的中转站:

- 请求: `POST {Base URL}/ai/generate-image`
- 请求体: NovelAI 官方 JSON (input / model / action / parameters), 完整支持 generate / img2img / inpaint 三种 action 与 V4 角色提示词结构
- 响应: ZIP 压缩包, 页面自动解压提取 PNG

### OpenAI 兼容格式

适用于提供 `/v1/images/generations` 的中转站:

- 请求: `POST {Base URL}/v1/images/generations`
- 请求体: `model / prompt / negative_prompt / size / steps / guidance_scale / seed / response_format`
- 图生图/重绘模式下追加 `image / strength / noise / mask` 扩展字段, 角色提示词以 `|` 合并进 prompt
- 响应: 标准 JSON, 兼容 `b64_json` 与 `url` 两种返回
- 模型下拉保存设置后自动拉取, 数据来自 `{Base URL}/v1/models`

## 本地运行

纯静态页面, 无需构建:

```bash
python3 -m http.server 3015
```

浏览器打开对应地址即可。

## 目录结构

```
.
  index.html      页面结构
  css/style.css   NovelAI 风格主题
  js/api.js       中转站 API 兼容层 (两种格式 / 参数构建 / 错误处理 / 超时)
  js/pngmeta.js   PNG 生成参数元数据 (官方兼容 tEXt Comment 块 + alpha 隐形通道读写)
  js/zip.js       NovelAI ZIP 响应解压与 PNG 提取
  js/db.js        IndexedDB 历史记录
  js/app.js       UI 交互与生成流程
```

## 说明

- API Key 与配置仅存储于浏览器 localStorage, 页面不经过任何第三方服务器
