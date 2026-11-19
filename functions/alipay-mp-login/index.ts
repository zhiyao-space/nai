/**
 * 支付宝小程序项目登录：商家项目凭据换码 → Supabase 用户 → magiclink token_hash。
 * 部署：meoo-cli cloud deploy-function -n alipay-mp-login -j false
 * 仅普通公钥模式；私钥和支付宝公钥只从项目服务端环境读取，不返回平台 access_token。
 * docs-verified:
 * https://github.com/alipay/alipay-sdk-nodejs-all#平台配置
 * https://github.com/alipay/alipay-sdk-java-all/blob/master/v3/docs/AlipaySystemOauthApi.md
 * https://opendocs.alipay.com/mini/0ai2i6
 * https://supabase.com/docs/reference/javascript/auth-admin-generatelink
 */
import { createPrivateKey, createPublicKey, createSign, createVerify } from 'node:crypto';
import { createClient } from 'npm:@supabase/supabase-js@2.105.4';

const headers = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers });
}

function failure(status: number, code: string, error: string) {
  // 上游错误可能包含原始响应、授权码或签名材料，不能直接写日志或透传。
  console.warn(`[alipay-mp-login] ${code}`);
  return reply(status, { code, error });
}

function keyPem(value: string, label: 'PRIVATE KEY' | 'PUBLIC KEY') {
  if (value.includes('-----BEGIN')) return value;
  // RFC 7468 §2: PEM generators wrap base64 at 64 columns. Deno rejects an
  // unwrapped public key even though Node accepts the same RSA key.
  // https://datatracker.ietf.org/doc/html/rfc7468#section-2
  const lines = value.replace(/\s/g, '').match(/.{1,64}/g);
  if (!lines) throw new Error('Empty key');
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`;
}

export async function handleAlipayLogin(req: Request): Promise<Response> {
  // CORS / OPTIONS 由 Meoo Cloud 网关统一处理。
  if (req.method !== 'POST') return reply(405, { error: '仅支持 POST 请求' });

  let code: unknown;
  try {
    const body = await req.json();
    code = body?.code;
  } catch {
    return reply(400, { error: '请求必须是 JSON' });
  }
  if (typeof code !== 'string' || !code.trim()) {
    return reply(400, { error: '缺少支付宝登录授权码' });
  }

  const appId = Deno.env.get('ALIPAY_APP_ID')?.trim();
  const privateKey = Deno.env.get('ALIPAY_PRIVATE_KEY')?.trim();
  const alipayPublicKey = Deno.env.get('ALIPAY_PUBLIC_KEY')?.trim();
  const idType = Deno.env.get('ALIPAY_ID_TYPE')?.trim();
  if (!appId || !privateKey || !alipayPublicKey || !idType) {
    return failure(503, 'ALIPAY_CONFIG_MISSING', '支付宝登录尚未配置：请到「云服务 → 注册登录 → 支付宝登录」配置 AppID、应用私钥、支付宝公钥及用户标识模式');
  }
  if (!/^\d+$/.test(appId) || (idType !== 'open_id' && idType !== 'user_id')) {
    return failure(503, 'ALIPAY_CONFIG_INVALID', '支付宝登录配置无效：请检查 AppID 和用户标识模式');
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return failure(503, 'CLOUD_CONFIG_MISSING', '项目云服务尚未就绪');
  }

  let signingKey: ReturnType<typeof createPrivateKey>;
  let verificationKey: ReturnType<typeof createPublicKey>;
  try {
    // Deno 支持 node:crypto；支付宝 Node SDK 的 urllib 依赖使用未支持的 node:buffer.File。
    // 使用标准 RSA 实现官方 v3 协议，无自定义加密算法，也不引入 Node HTTP 兼容层。
    // 无 PEM 头的私钥按 PKCS8，带 PEM 头可使用 PKCS1 / PKCS8。
    signingKey = createPrivateKey(keyPem(privateKey, 'PRIVATE KEY'));
    verificationKey = createPublicKey(keyPem(alipayPublicKey, 'PUBLIC KEY'));
    if (signingKey.asymmetricKeyType !== 'rsa' || verificationKey.asymmetricKeyType !== 'rsa') {
      throw new Error('RSA keys required');
    }
  } catch {
    return failure(503, 'ALIPAY_CONFIG_INVALID', '支付宝密钥格式无效，请检查应用私钥和支付宝公钥');
  }

  let identity: string;
  try {
    // docs-verified：与官方 SDK v4.14.0 的 curl 签名串一致（保留末尾换行）。
    // https://opendocs.alipay.com/open-v3/054q58
    // https://github.com/alipay/alipay-sdk-nodejs-all/blob/v4.14.0/src/alipay.ts
    const path = '/v3/alipay/system/oauth/token';
    const body = JSON.stringify({ grant_type: 'authorization_code', code });
    const authorization = `app_id=${appId},nonce=${crypto.randomUUID()},timestamp=${Date.now()}`;
    const signature = createSign('RSA-SHA256').update(`${authorization}\nPOST\n${path}\n${body}\n`).sign(signingKey, 'base64');
    const response = await fetch(`https://openapi.alipay.com${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', Accept: 'application/json',
        Authorization: `ALIPAY-SHA256withRSA ${authorization},sign=${signature}`,
      },
      body,
      signal: AbortSignal.timeout(15000),
    });
    if (response.status !== 200) {
      return failure(502, 'ALIPAY_EXCHANGE_FAILED', '支付宝身份验证失败，请重新登录；若持续失败，请检查 AppID、密钥及应用配置');
    }
    // 必须对原始响应文本验签后再解析，拒绝缺失、伪造或被改动的签名。
    // https://opendocs.alipay.com/open-v3/054d0z
    const raw = await response.text();
    const timestamp = response.headers.get('alipay-timestamp');
    const nonce = response.headers.get('alipay-nonce');
    const responseSignature = response.headers.get('alipay-signature');
    if (!timestamp || !nonce || !responseSignature || !createVerify('RSA-SHA256')
      .update(`${timestamp}\n${nonce}\n${raw}\n`).verify(verificationKey, responseSignature, 'base64')) {
      return failure(502, 'ALIPAY_SIGNATURE_INVALID', '支付宝响应验签失败，请检查支付宝公钥配置');
    }
    // 字段来源：官方 AlipaySystemOauthTokenResponseModel；不在 user_id/open_id 间兜底。
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return failure(502, 'ALIPAY_RESPONSE_INVALID', '支付宝登录服务返回异常，请重试');
    }
    const value = data[idType];
    if (typeof value !== 'string' || !value.trim() || value.length > 128) {
      return failure(502, 'ALIPAY_IDENTITY_MISMATCH', `支付宝未返回配置的 ${idType}，请检查开放平台的用户标识模式`);
    }
    identity = value;
  } catch {
    return failure(502, 'ALIPAY_EXCHANGE_FAILED', '支付宝身份验证失败，请重新登录；若持续失败，请检查 AppID、密钥及应用配置');
  }

  try {
    // 固定渠道 / 应用 / 模式 / 值共同派生账号；不合并微信身份、不新增业务映射表。
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(
      JSON.stringify(['alipay', appId, idType, identity]),
    ));
    const identityHash = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
    const email = `${identityHash}@alipay.local`;
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: createError } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { provider: 'alipay_miniprogram' },
      // app_metadata 由服务端维护，避免普通账密用户预占内部邮箱后冒充平台身份。
      app_metadata: { alipay_identity: identityHash },
    });
    // https://supabase.com/docs/guides/auth/debugging/error-codes
    if (createError && createError.code !== 'email_exists' && createError.code !== 'user_already_exists') {
      return failure(500, 'AUTH_USER_FAILED', '建立项目账号失败，请稍后重试');
    }
    const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    if (error || !data?.properties?.hashed_token || !data.user?.id) {
      return failure(500, 'AUTH_SESSION_FAILED', '建立项目登录会话失败，请稍后重试');
    }
    if (data.user.app_metadata?.alipay_identity !== identityHash) {
      return failure(409, 'AUTH_IDENTITY_CONFLICT', '项目账号身份冲突，请联系项目管理员');
    }
    return reply(200, { token_hash: data.properties.hashed_token, user_id: data.user.id });
  } catch {
    return failure(500, 'AUTH_SESSION_FAILED', '建立项目登录会话失败，请稍后重试');
  }
}

Deno.serve(handleAlipayLogin);
