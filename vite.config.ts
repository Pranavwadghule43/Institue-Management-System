import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Resolve the real project path so Windows short/long path variants don't confuse the dev server.
const root = realpathSync.native(fileURLToPath(new URL('.', import.meta.url)));

export default defineConfig({
  root,
  plugins: [react()],
});
