import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['../test/module-test/**/*.test.ts'],
    globals: true,
  },
});
