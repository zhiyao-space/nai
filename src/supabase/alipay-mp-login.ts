import Taro from '@tarojs/taro';
import { projectUrlId, supabase, supabaseUrl, supabaseAnonKey } from './client';

export class AlipayMpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlipayMpConfigError';
  }
}

/** 用户主动登录时调用；取码、换码和 verifyOtp 共用项目受管客户端，不在首屏自动授权。 */
export async function alipayMpLogin(): Promise<{ userId: string }> {
  if (TARO_ENV !== 'alipay') throw new Error('支付宝登录仅在支付宝小程序中可用');

  // Taro 4.2 将 my.getAuthCode({ scopes: 'auth_base' }) 的 authCode 映射为 code。
  // https://github.com/NervJS/taro/blob/v4.2.0/packages/taro-platform-alipay/src/apis.ts
  let code: string;
  try {
    const result = await Taro.login();
    if (!result.code) throw new Error('未返回授权码');
    code = result.code;
  } catch {
    throw new Error('未能取得支付宝登录授权码，请重试');
  }

  type LoginResponse = {
    token_hash?: string; user_id?: string; code?: string; error?: string;
  };
  let response: { statusCode: number; data: LoginResponse | null };
  try {
    response = await Taro.request({
      url: `${supabaseUrl}/functions/v1/alipay-mp-login`,
      method: 'POST',
      header: { 'Content-Type': 'application/json', apikey: supabaseAnonKey, 'OneDay-App-Id': projectUrlId },
      data: { code },
      dataType: 'json',
      timeout: 60000,
    });
  } catch (error) {
    // Taro 4.2 only normalizes success; fail rejects the native Alipay { status, data }.
    // https://github.com/NervJS/taro/blob/v4.2.0/packages/taro-platform-alipay/src/apis.ts
    const failure = error as { status?: unknown; data?: unknown } | null;
    if (typeof failure?.status !== 'number' || !Number.isInteger(failure.status)
      || failure.status < 400 || failure.status > 599) {
      throw new Error('连接支付宝登录服务失败，请检查网络后重试');
    }
    response = {
      statusCode: failure.status,
      data: failure.data !== null && typeof failure.data === 'object' && !Array.isArray(failure.data)
        ? failure.data as LoginResponse : null,
    };
  }
  const { statusCode, data } = response;
  const serviceError = typeof data?.error === 'string' ? data.error : undefined;
  if (statusCode === 503 && (data?.code === 'ALIPAY_CONFIG_MISSING' || data?.code === 'ALIPAY_CONFIG_INVALID')) {
    throw new AlipayMpConfigError(serviceError || '请在项目云服务中配置支付宝登录');
  }
  if (statusCode === 404 || statusCode === 405) throw new Error('支付宝登录函数尚未部署');
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(serviceError || `支付宝登录服务返回 ${statusCode}`);
  }
  if (typeof data?.token_hash !== 'string' || !data.token_hash || typeof data.user_id !== 'string' || !data.user_id) {
    throw new Error('支付宝登录服务返回数据不完整');
  }
  const { error } = await supabase.auth.verifyOtp({ token_hash: data.token_hash, type: 'magiclink' });
  if (error) throw new Error(`项目登录失败: ${error.message}`);
  return { userId: data.user_id };
}
