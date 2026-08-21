import type { NextConfig } from "next";

import { loadWebEnvironment } from "./src/environment";

loadWebEnvironment();

const nextConfig: NextConfig = {
  agentRules: false,
  reactStrictMode: true,
};

export default nextConfig;
