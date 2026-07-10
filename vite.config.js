import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative paths so the same build works at any GitHub Pages
  // subpath (e.g. /Pricing-competitor-app/). Combined with HashRouter
  // in main.jsx, there's no path-rewrite plumbing to worry about.
  base: './',
  server: { port: 5173, host: true },
})
