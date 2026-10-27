import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'

const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, root, ''), ...process.env }

  return {
    main: {
      define: {
        __DISCORD_CLIENT_ID__: JSON.stringify(env.DISCORD_CLIENT_ID ?? ''),
        __DISCORD_TOKEN_EXCHANGE_URL__: JSON.stringify(env.DISCORD_TOKEN_EXCHANGE_URL ?? '')
      },
      plugins: [externalizeDepsPlugin()],
      build: {
        rollupOptions: {
          input: {
            index: resolve(root, 'electron/main.ts')
          }
        }
      }
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
      build: {
        rollupOptions: {
          input: {
            index: resolve(root, 'electron/preload.ts')
          },
          output: {
            format: 'cjs',
            entryFileNames: '[name].cjs'
          }
        }
      }
    },
    renderer: {
      root,
      plugins: [react()],
      build: {
        rollupOptions: {
          input: {
            index: resolve(root, 'index.html')
          }
        }
      }
    }
  }
})
