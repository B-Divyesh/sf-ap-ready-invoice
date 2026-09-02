import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(here),
  publicDir: resolve(here, 'public'),
  build: { outDir: resolve(here, 'dist'), emptyOutDir: true, target: 'es2022', sourcemap: true },
  server: { port: 5173, proxy: { '/api': 'http://localhost:8080', '/health': 'http://localhost:8080' } }
});
