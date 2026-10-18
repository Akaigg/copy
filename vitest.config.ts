import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['pacotes/*/testes/**/*.test.ts', 'apps/motor/testes/**/*.test.ts'],
    testTimeout: 30000,
  },
})
