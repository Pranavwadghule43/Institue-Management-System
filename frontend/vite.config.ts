import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Resolve the real project path so Windows short/long path variants don't confuse the dev server.
const root = realpathSync.native(fileURLToPath(new URL('.', import.meta.url)));

/* 23 Nov security patch SEC-07: Content-Security-Policy for the built app.
   Scripts only from this site (no inline scripts, no eval); the API is the only other address the page may call.
   Inline style attributes stay allowed (React style props, PDF rendering). The built index.html carries the policy as
   a <meta> tag so it applies on any host; `npm run preview` and the hosting set it as a header too, with the parts
   a <meta> tag can't carry (frame-ancestors) — see docs/SECURITY_DEPLOYMENT.md. */
export function contentSecurityPolicy(apiUrl: string, { header = false } = {}) {
  const api = new URL(apiUrl);
  const directives = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${api.origin}`,
    "frame-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(header ? ["frame-ancestors 'none'"] : []),
    ...(api.protocol === 'https:' ? ['upgrade-insecure-requests'] : []),
  ];
  return directives.join('; ');
}

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function cspMeta(apiUrl: string): Plugin {
  return {
    name: 'ims-csp-meta',
    apply: 'build', // the dev server injects inline scripts for hot reload, so the policy is for builds only
    // Right after <meta charset>, before any script, so the policy covers everything that loads.
    transformIndexHtml: (html) => html.replace(/(<meta charset="UTF-8" \/>)/i,
      `$1\n    <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(apiUrl)}" />`),
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, 'VITE_');
  const apiUrl = env.VITE_API_URL || 'http://127.0.0.1:8000/api/v1';
  return {
    root,
    plugins: [react(), cspMeta(apiUrl)],
    preview: {
      headers: { ...SECURITY_HEADERS, 'Content-Security-Policy': contentSecurityPolicy(apiUrl, { header: true }) },
    },
  };
});
