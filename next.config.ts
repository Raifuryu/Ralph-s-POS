import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the Docker runner stage copy a self-contained server.js + pruned
  // node_modules instead of running `pnpm start` at runtime — avoids pnpm's
  // own pre-flight lockfile check, which misfires (no TTY to confirm a
  // reinstall) when node_modules is copied in from an earlier build stage.
  output: "standalone",
};

export default nextConfig;
