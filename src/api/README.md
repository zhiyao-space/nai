# src/api — 数据访问层

封装 Supabase 调用，页面 / store 不直接 `import { supabase }`。

## 规则

- 一个表/模块一个文件，CRUD 命名 `list / get / create / update / delete <Entity>`，非 CRUD 用业务动词
- **类型必须从 `@/supabase/types` 的 `Database` 取**：`type Post = Database['public']['Tables']['posts']['Row']`、`PostInsert = ...['Insert']`、`PostUpdate = ...['Update']`。**禁止自己写 `interface Post {...}`**——手写极易把 nullable 列标成非空，导致 `string | null` 不匹配编译报错
- 必须 `if (error) throw new Error(...)`，返回明确类型，不透传 `{ data, error }`
- 列表函数支持 `limit/offset` 分页；不调 `Taro.showToast`（UI 交给页面）
- **不写 `index.ts` 桶文件**

## 示例：（`src/api/posts.ts`）

```ts
import { supabase } from '@/supabase/client';
import type { Database } from '@/supabase/types';

export type Post = Database['public']['Tables']['posts']['Row'];
export type PostInsert = Database['public']['Tables']['posts']['Insert'];

export async function listPosts(limit = 50, offset = 0): Promise<Post[]> {
  const { data, error } = await supabase.from('posts').select('*')
    .order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  if (error) throw new Error(`查询帖子失败: ${error.message}`);
  return data ?? [];
}

export async function createPost(input: PostInsert): Promise<Post> {
  const { data, error } = await supabase.from('posts').insert(input).select('*').single();
  if (error) throw new Error(`创建帖子失败: ${error.message}`);
  return data;
}
```

`updatePost / deletePost` 同模板。
