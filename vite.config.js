import { defineConfig } from 'vite'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

console.log('VITE CONFIG CARREGADO')

export default defineConfig({
  plugins: [
    nodePolyfills({
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      protocolImports: true,
    }),
  ],

  server: {
    proxy: {
      '/api/football-data/v4': {
        target: 'https://api.football-data.org',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/football-data\/v4/, '/v4'),
      },
    },
  },

  define: {
    global: 'globalThis',
    'process.env': {},
    'process.env.NODE_ENV': '"production"',
    'process.version': '"v18.0.0"',
  },

  resolve: {
    alias: {
      process: 'process/browser',
    },
  },

  optimizeDeps: {
    include: [
      'process',
      'buffer',
    ],
  },

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        posicoes: resolve(__dirname, 'posicoes.html'),
      },
    },
  },
})