import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "*.replit.dev",
    "*.repl.co",
    "*.replit.app",
    "*.janeway.replit.dev",
  ],
  serverExternalPackages: ["@prisma/client"],
};

export default nextConfig;
