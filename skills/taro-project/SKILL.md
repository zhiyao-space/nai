---
name: taro-project
description: Scaffolds and develops Taro mini-program applications with React syntax for WeChat and Alipay, preserving H5 preview.
allowed_create_modes:
  - miniprogram
---
# Taro 小程序开发规范

## 核心约束

- **Taro 4.x + React + TypeScript + pnpm**，开发端口固定 `3015`（H5 预览）
- **必须**使用 `@tarojs/components`（View / Text / Button / Input / Image 等），禁用原生 HTML 标签
- 小程序客户端平台 API 统一经 `Taro` 桥接，禁止直接调用 `my.*`、`wx.*` 或其他平台全局对象；平台返回差异集中在模板已有 helper 中处理。项目云函数的服务端换码、签名／验签不属于客户端平台 API。
- **必须** Tailwind CSS 原子类；**禁止**任意值（`w-[340px]` / `text-[14px]`）和硬编码 `style={{ width: '200px' }}`，`style` 只用于跨端兼容修正
- **禁止** 直接 `process.env.XXX` 读环境变量，走项目内的配置入口
- 微信包体限制：主包 ≤ 2MB，总包 ≤ 20MB；支付宝按其实际平台要求核验，不直接套用微信限制
- 首页路径必须是 `pages/index/index`
- TabBar 不要手动实现，在 `app.config.ts` 配置；如配置 TabBar 必须 ≥ 2 个（推荐 ≤ 4），少于 2 个微信会报错
- 真机预览 / 发布：引导用户在 Meoo 平台配置 APPID
- 启动开发：`pnpm run dev`；任务完成总结前必须跑 `pnpm run validate && pnpm run dev` 校验
- **检查类命令禁止自加截断**：跑 `tsc` / `lint` / `build` / `validate` 时，直接 `pnpm run xxx` 即可，**禁止** `| head` / `| tail`。一次性看完所有错误，按文件聚类批量修，再跑一次确认归零。

## 目标平台

- 一份 Taro 业务源码同时支持微信和支付宝，项目类型始终为 `miniprogram`。预览、构建和发布使用本次操作明确选择的渠道，不从小程序 AppID 格式、当前浏览器或历史对话推断并固化项目渠道。
- 平台差异必须走模板已有的运行时分支和适配入口，不复制一套业务源码，也不要求服务端向生成上下文注入固定渠道。旧微信项目不会因选择支付宝操作而自动迁移；不得通过改配置或复制支付宝模板能力标记冒充已完成跨端升级。
- 平台预览、构建和发布请求以本次操作的 `channelType` 为准；同一项目可以分别保留一个微信绑定和一个支付宝绑定，已有另一渠道绑定不构成重复渠道。
- 微信：`pnpm run build:weapp` 输出 `dist`；保留既有微信登录、分块 SSE 和平台配置。默认 `pnpm run build` 仍是微信构建。
- 支付宝：`pnpm run build:alipay` 输出 `dist-alipay`；不可把 `dist` 的微信旧产物当成支付宝构建结果。
- H5：`pnpm run dev` 提供工作台预览，`pnpm run build:web` 输出 `dist-web`；H5 页面可打开不代表小程序目标已验证。
- 运行时明确区分 `Taro.ENV_TYPE.WEAPP`、`Taro.ENV_TYPE.ALIPAY`、`Taro.ENV_TYPE.WEB`。不要将所有非 H5 分支当成微信，也不要将所有非微信分支当成浏览器。
- 修改存量工程时，核对 `AGENTS.md`、项目说明与当前源码及用户已确认方案。发现已废弃的固定渠道、SDK 别名或“只有邮箱登录”等描述时，按实际实现修正对应说明，不把旧描述继续复制为新页面的架构结论；保留仍有效的项目约束，未验证的能力不得写成已验收。

### 支付宝已接入能力与生成边界

- 云数据仍走 `src/api/` → 受管 `src/supabase/client.ts`，支持云 CRUD，不以本地缓存替代云数据。保持项目路由、用户会话和业务实际需要的权限隔离。
- 支付宝不支持 HEAD：计数用 `select('实际已有列', { count: 'exact' }).limit(1)` 的 GET 请求并读取 `count`，不要设置 `head: true`。Storage 支持上传 helper、`list/createSignedUrl` 及同桶 `remove(paths)` 批量删除；删除由受管适配和 Meoo 网关保留 JSON 正文与 JWT，页面不自行转换请求方法。`update/exists/download` 仍未接入。官方 SDK 类型存在不代表所有接口已适配；详见 meoo-cloud 的 database/storage/realtime 参考。
- `client.ts`、`alipay-runtime.ts`、`default-runtime.ts` 由 Meoo Cloud 管理，初始化／关联／恢复时可能重建；业务代码只消费 `client.ts` 的导出，禁止另建客户端或修改 runtime。存量项目不能仅加一个能力标记冒充已升级。
- 节点测量使用 `measure.ts` 的 `getRectById`；支付宝查询取值由 `alipay-measure.ts` 的 `queryAlipayRectById` 经 Taro 从 `exec` 回调取得，尺寸归一化、视口和位置计算留在公共入口，不照搬微信 `boundingClientRect(callback)`。
- AI 使用 `sse.ts` 的 `sseRequest`：公共入口准备参数、解析事件并调用业务回调；`alipay-sse.ts` 的 `requestAlipaySse` 仅处理支付宝完整文本请求、失败及取消。支付宝在完整响应到达后展示结果，保留失败、取消和完成状态；不要使用 `enableChunked`、`onChunkReceived` 或承诺逐字输出。微信和 H5 保留各自原有传输。
- 支付宝身份登录使用 `signInWithAlipay` → `alipay-mp-login` 项目云函数 → 受管 Supabase 会话，部署与项目凭据按 meoo-cloud 的 `references/basic_auth.md`。只在用户主动登录时取码，不调用微信换码函数。配置 ALIPAY_APP_ID／ALIPAY_PRIVATE_KEY／ALIPAY_PUBLIC_KEY／ALIPAY_ID_TYPE，签名材料只保留在项目服务端；不新增映射表、不合并微信账号。代码存在或账密登录通过不等于真实支付宝身份已验收。
- 图片统一使用 `src/lib/upload.ts` 的 `selectMediaFiles({ mediaType: ['image'] })` 和 `uploadToSupabase`。支付宝适配集中在 `alipay-image.ts`，通过 `Taro.chooseImage` 选择：Taro 4.2 的旧路径映射若覆盖当前返回的 `tempFilePaths`，从官方 `tempFiles[].path` 显式恢复，缺少有效路径则报错，不直接调用 `my.chooseImage`。取消、二进制读取同样经 Taro，并依据文件内容识别 MIME 和真实大小，不根据 `.image` 后缀猜类型。取消返回空数组，权限／读取／格式错误会抛出，页面须捕获并提示。上传失败检查 `success/error`，私有桶按实际 RLS 传入 `userId`，通过 Storage 签名 URL 显示；不把测试桶的大小／类型限制写死成所有应用限制。禁止绕过 helper 调用微信 `chooseMedia`／`chooseMessageFile` 或浏览器 `File.arrayBuffer()`。真机二进制上传和最终显示仍须实际验收。
- 视频同样走 `selectMediaFiles({ mediaType: ['video'] })` 与 `uploadToSupabase`，支付宝由 `alipay-video.ts` 调用 `Taro.chooseVideo`，一次最多一段；提供独立图片／视频入口，不调用支付宝不支持的混选 API。当前识别 MP4/MOV 容器，不保证任意编码可播放；私有视频用签名 URL 和 Taro `Video` 验证播放。取消保留原选择，权限／读取／格式错误需反馈；按实际桶限制校验大小、类型，不把图片桶直接当视频桶。
- 支付宝图片／视频沿用二进制上传，与现有微信模板的上传方式对齐；使用 `uploadToSupabase(file, { bucketId, userId })`。本期不提供 multipart 入口，不生成 `alipayUploadMode`、原生 `uploadFile` 或手写表单协议；存量项目若存在此前试验的 multipart helper、选项或页面入口，应一并移除。保留集中适配与当前受管 SDK 会话，不另建客户端；真机上传、回读及视频播放仍须实际验收。
- `upload.ts` 保留公共选择／上传入口、文件命名及现有路径规则；`alipay-upload.ts` 组合既有 `alipay-image.ts`／`alipay-video.ts` 取得媒体元数据和二进制，再按公共入口给出的路径调用现有 SDK 上传。业务代码不直接导入内部支付宝 helper，不在 helper 内另造命名、路径或上传协议；微信/H5 不因抽取 helper 改变现有行为。
- `src/lib/alipay-image.ts`、`alipay-video.ts`、`alipay-upload.ts`、`alipay-sse.ts`、`alipay-measure.ts` 由 Meoo 平台维护；Agent 禁止通过 Edit、Write、Bash 修改、删除、覆盖或重建这五个 helper，异常应向平台报告。业务定制放在 `upload.ts`／`sse.ts`／`measure.ts` 公共入口或业务层，保留既有平台适配调用。受管规则不授权覆盖存量用户修改：迁移仍须核对公共入口和同名 helper，发现冲突先报告，不能整文件覆盖公共入口或未经核对替换 helper。
- 批量删除使用当前用户有权限的完整对象路径，检查 `error` 和返回删除对象的 `name`，再刷新云列表；返回字段按 meoo-cloud Storage 参考，不猜 `fullPath`，不拼 `bucket_id`。不能只清空本地列表或把空返回当作所有请求文件均已删除；保留确认、防重复提交、失败提示与切换账号后的异步隔离。
- 通用附件选择、AI 逐字输出与 Realtime 不在当前支付宝能力范围。
- 微信专属的包体、位置隐私声明、授权 scope 等要求只应用于微信分支。支付宝权限、合法域名及组件支持按其官方合同逐项核准，不复制微信声明冒充支付宝配置。

## 开发流程

### 新增页面（四步）
1. 编写页面组件：`src/pages/example/index.tsx`
2. 编写页面配置：`src/pages/example/index.config.ts`
3. 注册路由：`src/app.config.ts` 的 `pages` 数组追加 `pages/example/index`
4. 若是 TabBar 页面，用 `taro-lucide-tabbar` 生成 PNG 图标（见「图标 → TabBar」）

> 改 `app.config.ts` 后必须重启 `pnpm run dev`，否则不生效。

### 登录保护页面的数据加载

- **不能只在 `useDidShow` 里判断登录并加载数据**：页面首次显示可能早于异步会话恢复。使用订阅认证状态的 `useEffect`，在认证初始化完成且用户有效时触发首次读取；依赖包含实际 store 的就绪状态、用户 ID 和认证错误。仅在 Effect 中处理未登录跳转、却仍把读取全部留在 `useDidShow`，同样会漏掉冷启动读取。已有项目的 store 字段名按当前源码使用，不另建认证状态或云客户端。
- `useDidShow` 负责页面再次显示时的刷新，不能以“内存数组已有数据”为由永久跳过云端读取；私有图片的签名 URL 会过期，重进时需要按现有图片链路重新取得有效 URL。
- 首次认证就绪、页面显示和手动刷新复用同一加载 action；在 action 中同步检查并设置进行中标记，防止重叠请求。读取失败保留可见错误和手动重试，`finally` 释放进行中状态；尚未执行首次读取不能显示成已确认的空数据。
- 用户退出或切换后，清空对应页面的草稿和旧用户数据，迟到响应不得回填到新用户页面。检查读取、创建、修改、删除各 action 的异步完成路径，不能只保护列表读取而漏掉创建结果回填；复用现有 store 的用户隔离与请求失效处理，不因重组页面丢掉这些保护。
- 隔离校验要覆盖每个异步边界：确认弹窗返回、删除完成、删除后的列表刷新完成，以及 action 返回后的页面提示和勾选清理。复用项目已有会话纪元，在每次 `await` 后核对操作所属会话；只在删除回执到达时检查一次，不能保护后续刷新期间发生的退出／重登。取消确认或旧会话结果不得清除当前勾选、提示成功或触发新会话请求。
- 至少验证两个顺序：① 会话先就绪、页面后显示；② 页面先显示、会话后就绪。第二种也必须自动读取，不依赖用户再进一次或手动刷新。再核对登录回跳、编辑返回、读取失败后重试；只验证编译或未登录跳转不能证明这些行为通过。

依据：[Taro `useDidShow`](https://docs.taro.zone/docs/hooks#usedidshow) 在页面显示时触发；[React `useEffect`](https://react.dev/reference/react/useEffect#parameters) 在依赖变化后执行。会话状态更新不等于页面再次显示。

### 交付前页面验收

- 检查实际预览路由与目标页面是否一致，按工程真实的 H5 hash/browser 路由定位。截图失败、路由不匹配或回到首页时，不能改验其他页面后宣称目标页面通过。
- 登录页截图只证明登录页或未登录守卫。登录后业务页仍需检查加载、空态、成功和错误交互；没有可用登录态时明确保留未验证，不以“复用已有 store/api”替代新页面验收。
- 新页面需同时检查从应用首页进入与扫码/分享直接进入（无上一页）的导航闭环。沿用项目已有登录退出能力，确保仍能到达退出入口或返回已有账号入口，不只依赖原生返回按钮；复用现有认证 action，验证取消、成功、失败重试与再次登录，不另建认证流程。预览指定业务页只能作为直达场景，不能替代默认首页路径验收。
- 新增页面与后续修改都要验证最终源码和所选渠道的实际构建产物；修复落在源码及对应生成规范中，不修改临时构建包冒充生成修复。

### 路径别名
`@/*` 已配置指向 `src/*`，**必须**用别名导入：

```typescript
import { SomeComponent } from '@/components/some-component'        // ✅
import { SomeComponent } from '../../../components/some-component' // ❌
```

### 命名

| 对象 | 规则 | 示例 |
|---|---|---|
| 文件 / 目录 | kebab-case | `user-profile.tsx`、`user-center/` |
| 组件 / 类型 | PascalCase | `UserProfile`、`ApiResponse` |
| 变量 / 函数 | camelCase | `getUserInfo` |
| 常量 | UPPER_SNAKE_CASE | `API_BASE_URL` |

## 样式

### 配色（语义 token）

**禁止 tsx 内联十六进制色值**（`bg-[#562aff]` / `text-[#xxx]`），全部走 `src/app.css` 中预置的语义 token。

**第一步：按 App 调性改 `src/app.css` 的 `:root, page` 块**（只改色值，不改变量名）。

**第二步：组件只用语义类名**

```tsx
<View className="bg-background min-h-screen">
  <View className="bg-card rounded-lg p-4 border border-border">
    <Text className="text-foreground text-lg font-bold">主标题</Text>
    <Text className="text-muted-foreground text-sm">副文案</Text>
    <View className="mt-3 bg-primary px-4 py-2 rounded-md">
      <Text className="text-primary-foreground text-center">主按钮</Text>
    </View>
  </View>
</View>
```

### Tailwind / WXSS 禁用清单

以下类名 / 选择器会导致预览或上传失败（eslint `no-restricted-syntax` 强制）：

| 禁用 | 替代 |
|---|---|
| `peer-*` / `group-*` 修饰符（如 `peer-checked` / `group-hover`） | 自己用 state 控制 |
| 任意小数值类名（`space-y-1.5` / `w-0.5`，`gap-*` 除外） | 用整数（`space-y-2` / `w-1`） |
| `has-*` 变体 / 任意 `[&:has(...)]` | 在父级用 state 标记 |
| `[&>*...]` 通配符选择器 | 用明确标签（`[&>view]`） |
| `[&>[data-...]]` 属性选择器 | 改用 className 区分 |
| `[&~...]` 兄弟选择器 | 用 flex 顺序 + 条件类 |
| `bg-color/N` / `bg-opacity-N` | inline `style={{ backgroundColor: 'rgba(...)' }}` |

CSS 文件里 **禁止远程 `@import`**（如 `@import url("https://fonts.googleapis.com/...")`），字体 / 图片改为本地静态资源。

### 小程序样式坑

**Input 必须 View 包装** — H5 端 Input 自身的 padding / bg / radius 会被原生样式覆盖：

```tsx
<View className="bg-secondary rounded-2xl p-4 mb-4">           {/* ✅ */}
  <Input className="w-full bg-transparent" />
</View>
<Input className="bg-secondary rounded-xl px-4 py-3 w-full" /> {/* ❌ H5 失效 */}
```

**Fixed + Flex 在 H5 失效** — 必须 inline style：

```tsx
<View style={{
  position: 'fixed', bottom: 50, left: 0, right: 0,
  display: 'flex', flexDirection: 'row', gap: '12px',
  padding: '12px', backgroundColor: '#fff', zIndex: 100,
}}>
  <Button>确认</Button>
</View>
```

**半透明背景** — 小程序下 `bg-foo/N` / `bg-opacity-N` 透明度会丢，改用 inline `style={{ backgroundColor: 'rgba(...)' }}`。

**ScrollView padding 撑爆视口** — 子元素 `w-full` 会基于含 padding 的内容区计算宽度而溢出。把水平 padding 移到内部容器：

```tsx
<ScrollView className="py-4">                {/* ✅ ScrollView 只留 py，px 给内部 */}
  <View className="w-full px-4">内容</View>
</ScrollView>
<ScrollView className="px-4 py-4">           {/* ❌ 子元素 w-full 溢出 */}
  <View className="w-full">内容</View>
</ScrollView>
```

## 图标

### 页面图标（`@egoist/tailwindcss-icons`）

已注册 `mdi`（Material Design）和 `lucide` 两个集合，用 `i-{collection}-{kebab-name}` 类名：

```tsx
<View className="i-mdi-home w-6 h-6" />
<View className="i-lucide-bot w-6 h-6 text-red-500" />
```

- 尺寸用 `w-*` / `h-*`；颜色通过 `text-*` 设置（CSS 层面继承 `currentColor`）
- kebab-case 命名：`House` → `i-lucide-house`，`MousePointerClick` → `i-lucide-mouse-pointer-click`
- **类名必须字面量**，动态拼接（`` `i-mdi-${name}` ``）扫描不到、不会打包
- **禁止** `import '@iconify-json/mdi'`，会把 7000+ JSON 全打进包
- **禁止**给图标组件传 `color="currentColor"`（如 `<MyIcon color="currentColor" />`），小程序端不会继承，请用显式色值或通过 Provider 提供默认色

### TabBar 图标（必须本地 PNG）

微信 TabBar 不支持 SVG。用 `taro-lucide-tabbar` 生成到 `src/assets/tabbar/`：

```bash
npx taro-lucide-tabbar House Settings User -c "#999999" -a "#1890ff" -o ./src/assets/tabbar
```

`app.config.ts`：

```typescript
export default defineAppConfig({
  tabBar: {
    color: '#999999',
    selectedColor: '#1890ff',
    backgroundColor: '#ffffff',
    list: [
      { pagePath: 'pages/index/index', text: '首页',
        iconPath: './assets/tabbar/house.png',
        selectedIconPath: './assets/tabbar/house-active.png' },
    ],
  },
})
```

## 跨端兼容

H5 不支持 Camera / Map / Canvas 等原生组件。**用 `Taro.getEnv()` 直接判断，不要 `useState + useEffect`**（会有渲染延迟）：

来源：[Camera 平台支持度](https://docs.taro.zone/docs/components/media/camera)、[`Taro.ENV_TYPE`](https://docs.taro.zone/en/docs/apis/about/env)。

```tsx
const env = Taro.getEnv()
const isMiniProgram = env === Taro.ENV_TYPE.WEAPP || env === Taro.ENV_TYPE.ALIPAY   // ✅

{isMiniProgram ? (
  <Camera className="w-full h-96" devicePosition="back" />
) : (
  <View className="flex items-center justify-center h-96 bg-muted">
    <Text className="text-muted-foreground">请在小程序中打开体验完整功能</Text>
  </View>
)}
```

**默认不用 `<Button>`** — 原生 Button 有不可控的默认尺寸 / 样式，改用 `<View onClick>` + Tailwind 自实现。

`View` 没有按钮的禁用行为：变灰、`opacity` 或 loading 文案不会阻止点击。保存、删除、上传、AI 等操作必须由 handler 或 store action 同步拦截重复调用；涉及确认弹窗时在弹窗前锁定，取消、失败和完成都在 `finally` 解锁。事件用 Taro 支持的 `onClick`，不要照搬 React Native 的 `onPress`。

**日期 / 时间 / 枚举用 `<Picker>` 不要用 `<Input>`** — `mode="date|time|selector|multiSelector|region"` 原生滚轮，onChange 返回已格式化值（`date` → `YYYY-MM-DD`、`time` → `HH:mm`、`selector` → index），避免手输格式错。

## 数据与云

```
页面 ──► store (zustand) ──► api ──► supabase
```

- **禁止页面 / 组件 / store 内 `import { supabase }`**，所有调用走 `src/api/`
- 后端数据全部进 store，mutation 走 action 自动同步
- meoo-cloud 不预设"匿名优先"，RLS 按业务实际需要设计（覆盖 meoo-cloud SKILL 默认）
- 详细规则：`src/api/README.md`、`src/store/README.md`

## 小程序特性

### 本地存储
小程序不能依赖浏览器存储，**禁用** `localStorage` / `sessionStorage` / `wx.setStorageSync`，统一走 `Taro.*StorageSync`。value 自动 JSON 序列化；以下单 key ≤ 1MB、总量 ≤ 10MB 是微信限制，支付宝配额需按其平台要求核验：

```tsx
import Taro from '@tarojs/taro';
Taro.setStorageSync('pref', { theme: 'dark' });
const pref = Taro.getStorageSync('pref');   // 不存在返回 ''
Taro.removeStorageSync('pref');
```

- 区分“从未保存”和“已保存的空列表”：通过 [`Taro.getStorageInfoSync().keys`](https://docs.taro.zone/docs/apis/storage/getStorageInfoSync) 确认键不存在后才初始化示例；校验返回的 `keys` 字符串数组与可选 `success`，查询失败不写入。不能只凭 `getStorageSync` 返回空值推断首次使用，适配层可能吞掉读取错误；`[]` 是用户删空后的有效结果，不能因 `length === 0` 重新填入示例。
- 持久化要覆盖删除最后一条后的空数组；不能用 `if (items.length > 0)` 跳过保存。先完成存储读取再允许写入，避免初始占位空状态覆盖已有数据；保持现有存储键与数据格式。
- 读取和保存分属两个 Effect 时，就绪标记必须与已加载数据的渲染状态一致。前一个 Effect 直接把 ref 设为已就绪，会让同轮保存 Effect 用旧的占位空数组覆盖存储；读失败或数据格式异常时禁止写入示例覆盖原值，并显示错误。
- 本地数据交付前实际检查首次示例、添加／勾选／筛选、删除最后一条后重新打开仍为空，以及已有非空数据重开不丢失。读写失败需可见，不把未保存的内存状态当成持久化成功。

### 微信位置接口必须声明 requiredPrivateInfos（微信发布门禁）

调用下列 **8 个位置接口**中的任意一个，就**必须**在 `src/app.config.ts` 的 `requiredPrivateInfos` 里声明对应接口名，否则微信侧提审前的隐私检测会判定"代码调用了未声明的隐私接口"，发布会被拦下。

8 个接口（枚举出处：[app.json requiredPrivateInfos 官方配置文档](https://developers.weixin.qq.com/miniprogram/dev/reference/configuration/app.html#requiredPrivateInfos)，docs-verified）：
`getFuzzyLocation` / `getLocation` / `onLocationChange` / `startLocationUpdate` / `startLocationUpdateBackground` / `chooseLocation` / `choosePoi` / `chooseAddress`

**写法：不带 `wx.` 前缀**（`'getLocation'` ✅，`'wx.getLocation'` ❌）。注意微信自己在不同接口里格式不统一——上传检测结果里回显的是 `wx.getLocation` 那种带前缀的写法，但 `app.json` 这里就是不带前缀，别照抄错。

```typescript
// src/app.config.ts
export default defineAppConfig({
  pages: ['pages/index/index'],
  // ✅ 只声明本项目真正调用到的接口
  requiredPrivateInfos: ['getFuzzyLocation', 'chooseAddress'],
  permission: {
    'scope.userLocation': { desc: '用于展示你附近的门店' },   // 位置接口还需要授权文案
  },
})
```

规则：

- **只声明真正调用的**：不要为了"保险"把 8 个全写上。声明与实际功能不符会影响审核观感；且上传时对 `requiredPrivateInfos` 有互斥性校验（错误码 `85311`，docs-verified），全量声明必然踩中互斥对而上传失败。
- **禁止同一项目同时使用 `getLocation` 与 `getFuzzyLocation`**：这两个接口互斥（上传校验错误码 `85311`，docs-verified）。**能用模糊定位就不要用精确定位**——只有明确需要精确坐标（如导航、到米级的距离计算）才用 `getLocation`，展示"附近的 XX"用 `getFuzzyLocation` 即可。
- 删掉某个位置功能时，**同步删掉**对应声明，保持声明与代码一致。
- 改完 `app.config.ts` 记得重启 `pnpm run dev`（同「新增页面」小节的提醒）。

> 为什么必须在生成时就写对：这份声明是发布链路的硬门禁。漏了会在用户点发布之后才被微信检测出来（检测结果里会列出"未配置的隐私接口"），用户看到的是"发布被拦住"而不是"代码有问题"，排查成本远高于生成时顺手写一行。
>
> 相关错误码（docs-verified）：`85310` API 名/格式错、`85311` 接口互斥、`85312` 无权限。

## 按需调试

遇到用户报告或已有证据确认的具体故障，需要进一步取证时，先 Read `skills/taro-project/debug/debug.md`。普通开发和首页截图验收无需读取；该文档不属于开工必读文档。
