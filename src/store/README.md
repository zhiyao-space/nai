# src/store — 全局状态层（zustand）

后端拉的数据全部进 store，订阅者自动同步。

## 规则

- 一个实体一个文件：`src/store/posts-store.ts`
- store 调 api，禁止 store 内 `supabase.from(...)`
- `fetch / init` 用 `loading` 互斥防并发；登出时 user 相关 store 调 `reset()` 清缓存
- 不调 `Taro.showToast`；action 失败 `throw`，让页面 Toast
- **不写 `index.ts` 桶文件**

## 示例：（`src/store/posts-store.ts`）

```ts
import { create } from 'zustand';
import * as postsApi from '@/api/posts';
import type { Post, PostInsert } from '@/api/posts';

interface PostsState {
  items: Post[];
  loading: boolean;
  loaded: boolean;
  fetch: () => Promise<void>;
  add: (input: PostInsert) => Promise<Post>;
  reset: () => void;
}

export const usePostsStore = create<PostsState>((set, get) => ({
  items: [], loading: false, loaded: false,

  fetch: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      set({ items: await postsApi.listPosts(), loaded: true });
    } finally { set({ loading: false }); }
  },

  add: async (input) => {
    const created = await postsApi.createPost(input);
    set({ items: [created, ...get().items] });
    return created;
  },

  reset: () => set({ items: [], loading: false, loaded: false }),
}));
```

页面：`useEffect(() => { if (!loaded) fetch(); }, [loaded, fetch])`。A 页 `add()` 后 B 页自动同步。

## 已内置鉴权链路

- `useAuthStore`（`src/store/auth-store.ts`）：`user / loaded / signInWithWeapp / signInWithUsername / signUpWithUsername / signOut`，用户名内部自动包成 `{username}@meoo.local`
- `redirectToLogin(returnPath?)`（`src/lib/redirect-to-login.ts`）：跳登录页，可选带回跳路径
- 登录页 `src/pages/login/index.tsx`：账号密码 + 注册切换 + 微信登录，文案布局可改，骨架不要重写

不需要登录的项目不动这部分。需要时：

1. 初始化 meoo-cloud 云服务，阅读鉴权相关文档
2. `src/app.config.ts` 的 `pages` 加 `pages/login/index`
3. 业务订阅 `user` 判登录态。**鉴权前必须先看 `loaded`**，否则首屏会把"还没知道"误当未登录，瞬间跳登录页：

```tsx
const { user, loaded } = useAuthStore();

// 整页要求登录
useEffect(() => {
  if (loaded && !user) redirectToLogin(router.path);
}, [loaded, user]);
if (!loaded) return null;

// 局部动作要求登录
const onLike = async () => {
  if (!loaded) return;
  if (!user) return redirectToLogin(router.path);
  await postsApi.likePost(id);
};

// 展示用户：不要用 user.email（占位符）/ openid / user.id，走 user_metadata 兜底
const meta = user?.user_metadata ?? {};
const nickname = meta.nickname || meta.username || '微信用户';
const avatar = meta.avatar_url || '/path/to/fallback.png';
```

登出时业务 store 清缓存：在自身模块顶层订阅 auth，别让 `signOut` 手动调下游：

```ts
// posts-store.ts 末尾
useAuthStore.subscribe((s, prev) => {
  if (prev.user && !s.user) usePostsStore.getState().reset();
});
```
登录页文案、布局可改，鉴权骨架不要重写。
