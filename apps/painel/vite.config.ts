import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const alvo = process.env.MOTOR_URL ?? 'http://127.0.0.1:3001'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { chunkSizeWarningLimit: 1200 },
  server: {
    port: 5173,
    proxy: {
      '/api/eventos': { target: alvo.replace(/^http/, 'ws'), ws: true },
      '/api': { target: alvo },
    },
  },
})
