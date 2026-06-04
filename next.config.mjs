/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow this app to be embedded inside GoHighLevel (custom menu link iframe).
  // GHL serves the agency/sub-account UI from *.gohighlevel.com / *.leadconnectorhq.com
  // and white-label domains. We use a permissive frame-ancestors so it renders in the
  // GHL iframe regardless of the white-label domain in use.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self' https://*.gohighlevel.com https://*.leadconnectorhq.com https://*.msgsndr.com *;",
          },
          // Note: X-Frame-Options is intentionally omitted. It cannot express an
          // allow-list of multiple domains, and frame-ancestors (above) supersedes it
          // in modern browsers.
        ],
      },
    ];
  },
};

export default nextConfig;
