import type { NextConfig } from "next";

const devTunnelHost = process.env.DEV_TUNNEL_HOST?.trim();
const nextConfig: NextConfig =
  process.env.NODE_ENV === "development" && devTunnelHost
    ? {
        allowedDevOrigins: [devTunnelHost],
        experimental: {
          serverActions: {
            // Dev Tunnels may forward an Origin of localhost despite a public host.
            allowedOrigins: [devTunnelHost, "localhost:3000"],
          },
        },
      }
    : {};

export default nextConfig;
