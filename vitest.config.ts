import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Default environment stays 'node' (core/ tests spawn real subprocesses and
// don't want a DOM). Renderer component tests opt into jsdom per-file via a
// `// @vitest-environment jsdom` pragma — see src/app/RightPanel.test.tsx.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@core': resolve('core'),
      '@renderer': resolve('src'),
    },
  },
  test: {
    environment: 'node',
  },
})
