import type { NextConfig } from 'next';

/**
 * `standalone` output: the production image copies a self-contained server instead of the whole
 * `node_modules`, which is what keeps the web image small enough to pull quickly on the ECS task
 * that serves it.
 *
 * `poweredByHeader` off and a strict `Referrer-Policy` are baseline, not the security work —
 * CSP, HSTS and the rest land with the owner app in P13 and the production baseline in P17.
 */
/**
 * Local single-origin proxy, development and end-to-end tests only. Deployed, the load balancer
 * sends `/api/*` to the API service and everything else here (one origin: the session cookie is
 * `__Host-`, the CSRF guard compares `APP_ORIGIN`). Locally the two run as separate processes,
 * so a build with `OWNER_API_PROXY_ORIGIN` set forwards `/api/*` to the API the same way. Read at
 * build time (rewrites are compiled into the route manifest); unset, no rewrite exists.
 */
const apiProxyOrigin = process.env['OWNER_API_PROXY_ORIGIN'];
const LOOPBACK = ['localhost', '127.0.0.1'];
// Loopback only: a deployed build that picked the variable up must fail, not compile in a proxy
// that forwards session cookies around the load balancer.
if (
  apiProxyOrigin !== undefined &&
  apiProxyOrigin !== '' &&
  !LOOPBACK.includes(new URL(apiProxyOrigin).hostname)
) {
  throw new Error(
    'OWNER_API_PROXY_ORIGIN is a local-development proxy and must be a loopback origin',
  );
}

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  // The shared wire contract ships as TypeScript source (workspace package).
  transpilePackages: ['@moin/contracts'],
  ...(apiProxyOrigin === undefined || apiProxyOrigin === ''
    ? {}
    : {
        rewrites() {
          return Promise.resolve([
            { source: '/api/:path*', destination: `${new URL(apiProxyOrigin).origin}/api/:path*` },
          ]);
        },
      }),
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
