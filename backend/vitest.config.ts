import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: { DB_PATH: './test-taskmanager.db' },
    fileParallelism: false,
    setupFiles: ['./src/test/setup.ts'],
  },
});
