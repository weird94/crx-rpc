/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/__test__/**/*.test.ts', 'tests/**/__test__/**/*.test.tsx'],
  },
})
