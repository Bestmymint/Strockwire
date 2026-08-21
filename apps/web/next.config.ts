import { existsSync } from "node:fs";
import { resolve } from "node:path";

import type { NextConfig } from "next";

import { getApiHealthRewrite } from "./src/api-proxy";
import { loadWebEnvironment } from "./src/environment";

const localEnvironmentFile = resolve(import.meta.dirname, "../../.env");

if (existsSync(localEnvironmentFile)) {
  process.loadEnvFile(localEnvironmentFile);
}

const environment = loadWebEnvironment();

const nextConfig: NextConfig = {
  agentRules: false,
  reactStrictMode: true,
  async rewrites() {
    return [getApiHealthRewrite(environment)];
  },
};

export default nextConfig;
