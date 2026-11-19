`client.ts` 和 `types.ts` 由 Meoo Cloud 自动生成并管理，请勿手动修改、覆盖或重新创建。

执行 `meoo-cli cloud init` 或平台恢复云服务时，平台会自动生成客户端和云服务环境配置：

Database、Auth、Storage 和 Realtime 必须使用 `client.ts` 导出的 `supabase` Client；不要自行调用 `createClient()`。云函数如果使用裸 `fetch` / `Taro.request`，URL 必须基于 `client.ts` 导出的 `supabaseUrl`，并携带必要的 `apikey`、`Authorization` 和 `OneDay-App-Id` 请求头。

支付宝使用官方 SDK 与受管 `alipay-runtime.ts`，微信/H5 使用 `default-runtime.ts` 保留原 SDK 选择。这两个 runtime 同样由 Meoo Cloud 生成和恢复，不要修改或另建客户端。支付宝支持基础云 CRUD、会话、图片／单视频二进制上传和同桶批量删除适配，不支持 Realtime 或全量 Supabase API。媒体选择和上传使用 `src/lib/upload.ts`，与现有微信模板同样使用二进制正文，本期不提供 multipart。批量删除依赖 Meoo 网关的 Storage DELETE 转换；目标环境和真机必须分别验收。AI 整段结果使用 `src/lib/sse.ts`。

支付宝计数使用 GET：`select('实际已有列', { count: 'exact' }).limit(1)`，检查错误后读取 `count`，不要使用 `head: true`。方法转换仅覆盖 Meoo PostgREST 的 PATCH/DELETE 和 Storage 同桶 `remove(paths)` 的 DELETE；Storage 的 `update()`、`exists()` 和 `download()` 尚未支持。删除须检查错误及实际删除对象，并刷新列表，不把空数组当作全部删除成功。不要因 SDK 类型存在而调用未适配接口；微信/H5 保留原能力。

支付宝身份登录调用 `signInWithAlipay`，由 `alipay-mp-login.ts` 取码并访问项目云函数 `functions/alipay-mp-login/index.ts`。先部署该函数（`meoo-cli cloud deploy-function -n alipay-mp-login -j false`），在「云服务 → 注册登录 → 支付宝登录」配置 ALIPAY_APP_ID、ALIPAY_PRIVATE_KEY、ALIPAY_PUBLIC_KEY、ALIPAY_ID_TYPE。签名材料不得进入本目录或客户端环境变量。ALIPAY_ID_TYPE 必须匹配开放平台的 open_id/user_id 模式；修改 AppID 或模式不自动迁移已有用户。复用现有 auth.users 和会话，不新增映射表、不合并微信身份；真实换码及真机登录须单独验收。
