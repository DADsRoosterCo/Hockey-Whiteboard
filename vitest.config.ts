import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'app/**/*.test.ts', 'app/**/*.test.tsx'],
    exclude: ['test-results/**', 'test-results-new/**', 'node_modules/**', 'mcp-server/**'],
  },
})
