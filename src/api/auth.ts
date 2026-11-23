import type { User } from '@supabase/supabase-js';
import { supabase } from '@/supabase/client';
import { wxMpLogin } from '@/supabase/wx-mp-login';
import { alipayMpLogin } from '@/supabase/alipay-mp-login';

/** store 内部走 onAuthStateChange 不需要这个；业务侧主动取用 */
export async function getCurrentUser(): Promise<User | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

export async function signInWithWeapp(): Promise<void> {
  await wxMpLogin();
}

export async function signInWithAlipay(): Promise<void> {
  await alipayMpLogin();
}

/** 用户名自动包成 `{username}@meoo.local` 兼容 Supabase 邮箱认证；真实邮箱登录改用 `signInWithPassword({ email })` */
export async function signInWithUsername(username: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({
    email: `${username}@meoo.local`,
    password,
  });
  if (error) throw new Error(`登录失败: ${error.message}`);
}

/** `options.data.username` 透传到 `raw_user_meta_data`，由 `handle_new_user` 触发器写入 profiles */
export async function signUpWithUsername(username: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signUp({
    email: `${username}@meoo.local`,
    password,
    options: { data: { username } },
  });
  if (error) throw new Error(`注册失败: ${error.message}`);
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(`登出失败: ${error.message}`);
}

/** store 注入 setState 用；业务订阅 `useAuthStore` 即可。返回 unsubscribe。 */
export function subscribeAuthState(onChange: (user: User | null) => void): () => void {
  supabase.auth
    .getSession()
    .then(({ data }) => onChange(data.session?.user ?? null))
    .catch((e) => console.warn('[api/auth] getSession 失败：', e));
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => {
    onChange(session?.user ?? null);
  });
  return () => subscription.unsubscribe();
}
