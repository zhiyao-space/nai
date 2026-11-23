import type { Plugin } from 'vite';

/** Taro 4.2.0 + Vite compatibility; do not apply to WeChat/H5. */
export function alipayCompatibilityPlugins(): Plugin[] {
  return [
    {
      name: 'meoo:alipay-browserslist',
      enforce: 'pre',
      generateBundle() {
        // The Alipay platform writes this asset via modifyBuildAssets. In 4.2.0,
        // the Vite proxy can update existing bundle entries but cannot add one.
        // https://github.com/NervJS/taro/blob/v4.2.0/packages/taro-plugin-platform-alipay/src/index.ts
        // https://github.com/NervJS/taro/blob/v4.2.0/packages/taro-vite-runner/src/mini/emit.ts
        this.emitFile({
          type: 'asset', fileName: '.browserslistrc',
          source: 'defaults and fully supports es6-module',
        });
      },
    },
    {
      name: 'meoo:alipay-relative-style-imports',
      enforce: 'post',
      generateBundle: {
        order: 'post',
        handler(_options, bundle) {
          // Taro emits bare sibling imports. Alipay's builder interprets these
          // as package imports; make the relative path explicit before writing.
          // https://github.com/NervJS/taro/blob/v4.2.0/packages/taro-vite-runner/src/mini/style.ts
          for (const asset of Object.values(bundle)) {
            if (asset.type !== 'asset' || asset.fileName !== 'app.acss') continue;
            if (typeof asset.source !== 'string') this.error('Unexpected Taro app.acss asset type');
            asset.source = (asset.source as string).replace(
              /@import (["'])(?![./]|[a-z]+:)([^"']+\.acss)\1/g,
              '@import $1./$2$1',
            );
          }
        },
      },
    },
  ];
}
