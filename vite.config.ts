import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Resolve the real project path so Windows short/long path variants don't confuse the dev server.
const root = realpathSync.native(fileURLToPath(new URL('.', import.meta.url)));

// `npm run build:demo` produces one self-contained HTML file (dist-demo/index.html)
// that can be double-clicked or emailed to the client for review.
export default defineConfig(({ mode }) => ({
  root,
  plugins: mode === 'demo' ? [react(), viteSingleFile()] : [react()],
  build: mode === 'demo' ? { outDir: 'dist-demo', assetsInlineLimit: 100_000_000 } : undefined,
}));
