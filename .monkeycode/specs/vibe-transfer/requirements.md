# 需求文档：氛围转移 (Vibe Transfer)

Feature Name: vibe-transfer
Updated: 2026-11-07

## 引言

为 NovelAI 图像生成克隆项目新增官方「氛围转移 (Vibe Transfer)」功能：用户上传参考图作为"氛围"，生成时引导画面的风格、色调与构图。请求体结构与 NovelAI 官方 API 完全对齐，通过中转站 (支持 NovelAI 原生格式) 直接转发。项目 V4 载荷中已预留 `reference_image_multiple` 等三个空数组 (js/api.js:146-148)，本功能将其填充打通。

## 术语表

- **氛围参考图 (Vibe)**: 上传后用于引导画面氛围/风格的参考图像，以 base64 (不含 data URL 前缀) 保存在内存中。
- **信息提取强度 (Information Extracted)**: 官方参数，控制从参考图中提取的信息量，范围 0~1，默认 1.0。
- **参考强度 (Reference Strength)**: 官方参数，控制参考图对生成结果的影响程度，范围 0~1，默认 0.6。
- **氛围列表**: 氛围参考图与各自强度参数的有序集合。
- **中转站**: 转发 NovelAI 官方接口 (`/ai/generate-image`) 的代理服务。

## 需求

### 需求 1：氛围参考图管理

**用户故事**：作为创作者，我想添加参考图作为氛围来源，以便生成的画面贴近参考图的风格。

#### 验收标准

1. WHEN 用户在氛围转移上传区选择文件、拖拽图像或 Ctrl+V 粘贴图像，系统 SHALL 将该图像加入氛围列表并以 base64 (不含 data URL 前缀) 保存。
2. WHEN 氛围图加载成功，系统 SHALL 显示缩略图、移除按钮与两个强度滑杆 (信息提取强度默认 1.0，参考强度默认 0.6)。
3. WHILE 氛围列表数量达到上限 (5 张)，系统 SHALL 隐藏新增入口并提示已达上限。
4. WHEN 用户点击某氛围图的移除按钮，系统 SHALL 从氛围列表移除该氛围图并更新界面。
5. IF 用户提交了非图像文件或读取失败，系统 SHALL 提示"图片读取失败"且氛围列表保持不变。

### 需求 2：模型系列适配

**用户故事**：作为创作者，我在 V4/V4.5 与 V3 模型间切换时，希望氛围转移按官方能力自动适配。

#### 验收标准

1. WHILE 当前模型为 V4/V4.5 系列，系统 SHALL 将全部氛围图按列表顺序发送。
2. WHILE 当前模型为 V3 系列，系统 SHALL 仅发送第一张氛围图，并当氛围列表多于 1 张时在卡片内提示"V3 仅支持 1 张氛围图"。
3. IF 当前模型为 V3 且氛围列表为空，系统 SHALL 在请求中省略 V3 氛围字段。

### 需求 3：请求体对齐官方格式

**用户故事**：作为中转站用户，我希望请求体与 NovelAI 官方前端结构一致，以便中转站直接转发官方接口。

#### 验收标准

1. WHEN 氛围列表非空、接口格式为 NovelAI 官方格式且模型为 V4/V4.5，系统 SHALL 按氛围列表顺序填充 `parameters.reference_image_multiple`、`parameters.reference_information_extracted_multiple`、`parameters.reference_strength_multiple` 三个平行数组。
2. WHEN 氛围列表非空、接口格式为 NovelAI 官方格式且模型为 V3，系统 SHALL 填充 `parameters.reference_image`、`parameters.reference_information_extracted`、`parameters.reference_strength` 单值字段 (取第一张)。
3. WHEN 氛围列表为空，系统 SHALL 保持既有字段结构 (V4: 三个空数组占位；V3: 不新增字段)。
4. 氛围图 base64 SHALL 与图生图 `image` 字段一致，不带 data URL 前缀。

### 需求 4：生成流程与界面整合

**用户故事**：作为创作者，我希望氛围转移与其他生成参数一起参与生成流程，界面风格与现有功能一致。

#### 验收标准

1. WHEN 点击生成且接口格式为 NovelAI 官方格式，系统 SHALL 将氛围列表随 `collectParams()` 传入载荷构建。
2. WHEN 接口格式为 OpenAI 兼容格式且氛围列表非空，系统 SHALL 在生成前提示"氛围转移仅支持 NovelAI 官方格式，本次已忽略"并继续生成。
3. WHEN 当前处于凭空画模式且用户 Ctrl+V 粘贴图像，系统 SHALL 将粘贴图加入氛围列表 (照图改/局部重绘模式下维持现有粘贴进源图的行为)。
4. 氛围转移卡片 SHALL 采用与「多角色设定」一致的折叠卡片样式，并提供「?」大白话注释。

### 需求 5：存储边界

**用户故事**：作为用户，我希望浏览器存储不被大体积图像占满。

#### 验收标准

1. 系统 SHALL 将氛围图与强度仅保存在内存变量中，页面刷新后清空 (与源图 `sourceImage` 行为一致)。
2. 系统 SHALL 避免将氛围图 base64 写入 localStorage 或 IndexedDB。

## 决策点 (待用户确认)

1. 氛围图数量上限取 5 张 (与官方 UI 上限一致)。
2. 氛围图刷新后清空、仅内存保存。
3. OpenAI 兼容格式忽略氛围图并提示。
