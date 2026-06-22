import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Set VITE_PI_HOST in .env.development to your Pi's IP for local dev
  // e.g. VITE_PI_HOST=192.168.1.42:7125
  const piHost = env.VITE_PI_HOST || 'localhost:7125'

  return {
    plugins: [vue()],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
    server: {
      proxy: {
        '/websocket': {
          target: `ws://${piHost}`,
          ws: true,
          changeOrigin: true,
        },
        '/api': {
          target: `http://${piHost}`,
          changeOrigin: true,
        },
        '/printer': {
          target: `http://${piHost}`,
          changeOrigin: true,
        },
        '/server': {
          target: `http://${piHost}`,
          changeOrigin: true,
        },
      },
    },
  }
})
