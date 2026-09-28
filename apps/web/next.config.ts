import type { NextConfig } from 'next';

/**
 * `standalone` output: the production image copies a self-contained server instead of the whole
 * `node_modules`, which is what keeps the web image small enough to pull quickly on the ECS task
 * that serves it.
 *
 * `poweredByHeader` off and a strict `Referrer-Policy` are baseline, not the security work —
 * CSP, HSTS and the rest land with the owner app in P13 and the production baseline in P17.
 */
const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  // Next types `headers` as returning a Promise; there is nothing asynchronous to do here, so it
  // returns a resolved one rather than being marked `async` with no `await` in it.
  headers() {
    return Promise.resolve([
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ]);
  },
};

export default nextConfig;
