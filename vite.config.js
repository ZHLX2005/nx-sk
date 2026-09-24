import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 前端源码根下的文件会被暴露成 URL：src/web/frontend/api/client.js → /api/client.js。
// 而 /api 又是后端接口前缀，于是**前端自己的模块请求会被代理吞掉**——
// 浏览器拿到一坨 JSON、import 失败，dev 模式下面板直接起不来。
//
// 这是 Vite root 与服务端前缀的天然冲突：靠「目录别叫 api」这种约定防不住，
// 新增一个同名目录就会重现。所以按「是不是前端资源」决定走不走代理。
const FRONTEND_ASSET = /\.(jsx?|mjs|cjs|tsx?|css|map|svg|png|jpe?g|webp|ico|woff2?)$/i;

export function shouldServeLocally(url) {
  const path = String(url || '').split('?')[0];
  return FRONTEND_ASSET.test(path) ? path : undefined; // 真值 = 交回 Vite
}

export default defineConfig({
  root: 'src/web/frontend',
  plugins: [react()],
  build: { outDir: '../public', emptyOutDir: true },
  server: {
    port: 5180,
    host: '127.0.0.1',
    proxy: {
      '/api': { target: 'http://127.0.0.1:7800', bypass: (req) => shouldServeLocally(req.url) },
    },
  },
});
