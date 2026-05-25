import path from "node:path";
import type { NextConfig } from "next";

const allowedFrameAncestors =
  process.env.ALLOWED_FRAME_ANCESTORS?.trim() || "'self'";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors ${allowedFrameAncestors}`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
