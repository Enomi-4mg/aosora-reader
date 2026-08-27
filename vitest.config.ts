import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer')
    }
  },
  test: {
    globals: true,
    environment: 'node',
    // jsdom が要るテストはファイル先頭の `// @vitest-environment jsdom` で個別指定する
    // (vitest 4 で environmentMatchGlobs は廃止)
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx']
  }
})
