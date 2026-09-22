import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev-only badge; bottom-left sits on the sign-in page's "Built by" line.
  devIndicators: { position: "bottom-right" },
};

export default nextConfig;
