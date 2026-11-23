import { useEffect, useState } from 'react';
import Taro from '@tarojs/taro';
import { View, Text, Input } from '@tarojs/components';
import { useAuthStore } from '@/store/auth-store';
import { consumeReturnPath } from '@/lib/redirect-to-login';

type Mode = 'signin' | 'signup';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<Mode>('signin');

  const isWeapp = Taro.getEnv() === Taro.ENV_TYPE.WEAPP;
  const isAlipay = Taro.getEnv() === Taro.ENV_TYPE.ALIPAY;

  // 跳转由 store 订阅驱动：避免依赖 supabase 事件触发时机；也覆盖已登录用户误进本页自动跳走。
  // mount 时一次性消费暂存的 returnPath，避免后续访问拿到陈旧值
  useEffect(() => {
    const target = consumeReturnPath();
    const goBack = () => Taro.reLaunch({ url: target });
    if (useAuthStore.getState().user) {
      goBack();
      return;
    }
    return useAuthStore.subscribe((state, prev) => {
      if (state.user && !prev.user) goBack();
    });
  }, []);

  async function submit(
    action: () => Promise<unknown>,
    options: { errorModalTitle?: string } = {},
  ) {
    Taro.showLoading({ title: '请稍候', mask: true });
    try {
      await action();
      // 成功不 hideLoading：页面即将被 reLaunch 关掉，loading 蒙层正好衔接到新页面
    } catch (e) {
      Taro.hideLoading();
      const message = (e as Error).message;
      if (options.errorModalTitle) {
        Taro.showModal({
          title: options.errorModalTitle,
          content: message,
          confirmText: '知道了',
          showCancel: false,
        });
      } else {
        Taro.showToast({ title: message, icon: 'none' });
      }
    }
  }

  const onPasswordSubmit = () => {
    if (!username || !password) {
      Taro.showToast({ title: '请输入用户名和密码', icon: 'none' });
      return;
    }
    const { signInWithUsername, signUpWithUsername } = useAuthStore.getState();
    submit(() =>
      mode === 'signin'
        ? signInWithUsername(username, password)
        : signUpWithUsername(username, password),
    );
  };

  const onWeappLogin = () => {
    if (!isWeapp) {
      Taro.showModal({
        title: '微信登录不可用',
        content: '微信一键登录仅在微信小程序内支持。',
        confirmText: '知道了',
        showCancel: false,
      });
      return;
    }
    submit(() => useAuthStore.getState().signInWithWeapp(), {
      errorModalTitle: '微信登录失败',
    });
  };

  const onAlipayLogin = () => {
    submit(() => useAuthStore.getState().signInWithAlipay(), {
      errorModalTitle: '支付宝登录失败',
    });
  };

  return (
    <View className="min-h-screen bg-background flex flex-col items-center px-6 pt-20">
      <Text className="text-2xl font-bold text-foreground mb-2">
        {mode === 'signin' ? '登录' : '注册'}
      </Text>
      <Text className="text-sm text-muted-foreground mb-10">
        {mode === 'signin' ? '欢迎回来' : '创建一个新账号'}
      </Text>

      <View className="w-full bg-card border border-border rounded-lg p-4 mb-3">
        <Input
          className="w-full bg-transparent text-foreground"
          type="text"
          value={username}
          placeholder="用户名"
          placeholderClass="text-muted-foreground"
          onInput={(e) => setUsername(e.detail.value)}
        />
      </View>

      <View className="w-full bg-card border border-border rounded-lg p-4 mb-6">
        <Input
          className="w-full bg-transparent text-foreground"
          password
          value={password}
          placeholder="密码"
          placeholderClass="text-muted-foreground"
          onInput={(e) => setPassword(e.detail.value)}
        />
      </View>

      <View
        className="w-full bg-primary rounded-lg py-3 flex items-center justify-center"
        onClick={onPasswordSubmit}
      >
        <Text className="text-primary-foreground font-medium">
          {mode === 'signin' ? '登录' : '注册'}
        </Text>
      </View>

      <View
        className="mt-4 py-2"
        onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
      >
        <Text className="text-sm text-primary">
          {mode === 'signin' ? '还没有账号？立即注册' : '已有账号？立即登录'}
        </Text>
      </View>

      <View className="w-full flex items-center gap-3 my-8">
        <View className="flex-1 h-px bg-muted" />
        <Text className="text-xs text-muted-foreground">或</Text>
        <View className="flex-1 h-px bg-muted" />
      </View>

      {isAlipay ? (
        <View
          className="w-full bg-card border-2 border-primary rounded-lg py-3 flex items-center justify-center"
          onClick={onAlipayLogin}
        >
          <Text className="text-foreground font-medium">支付宝一键登录</Text>
        </View>
      ) : (
        <View
          className="w-full bg-card border-2 border-wechat rounded-lg py-3 flex items-center justify-center gap-2"
          onClick={onWeappLogin}
        >
          <View className="i-mdi-wechat w-5 h-5 text-wechat" />
          <Text className="text-foreground font-medium">微信一键登录</Text>
        </View>
      )}
    </View>
  );
}
