const pkg = require('../../package.json');

module.exports = ctx => {
  if (process.env.TARO_ENV !== 'alipay') return;
  if (pkg.dependencies['@tarojs/plugin-platform-alipay'] !== '4.2.0') {
    throw new Error('Revalidate the Alipay compatibility plugins before changing Taro 4.2.0');
  }
  // Run after the platform installs its default URL injection. Taro's URL
  // implementation does not support the SDK's ws(s) URL construction.
  // The ponyfill itself must be excluded to avoid circular self-injection.
  ctx.register({
    name: 'modifyRunnerOpts', stage: 1000,
    fn({ opts }) {
      opts.injectOptions = {
        ...opts.injectOptions,
        include: {
          ...opts.injectOptions?.include,
          exclude: '**/core-js-pure/**',
          URL: ['core-js-pure/actual/url/index.js', 'default'],
          URLSearchParams: ['core-js-pure/actual/url-search-params/index.js', 'default'],
        },
      };
    },
  });
};
