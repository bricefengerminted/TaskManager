import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// API_TARGET lets a second checkout run against its own backend (e.g. a worktree on another port).
const apiTarget = process.env.API_TARGET || 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/uploads': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
});
