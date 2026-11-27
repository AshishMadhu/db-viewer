import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { pgProxy } from './tools/pg-proxy'

export default defineConfig({
  base: './',
  plugins: [react(), pgProxy()],
  server: { host: 'localhost' },
})
