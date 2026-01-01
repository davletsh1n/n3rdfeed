import { defineConfig } from 'vite';
import devServer from '@hono/vite-dev-server';

export default defineConfig({
  plugins: [
    devServer({
      entry: 'src/index.ts', // Точка входа нашего приложения
    }),
  ],
  server: {
    port: 3000,
  },
  build: {
    outDir: 'dist',
    ssr: true, // Важно для корректной сборки серверной части
    rollupOptions: {
      input: 'src/index.ts',
    },
  },
});
