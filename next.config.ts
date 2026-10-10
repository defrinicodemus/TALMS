import type { NextConfig } from "next";

const devTunnelHost = process.env.DEV_TUNNEL_HOST?.trim();
const useDevTunnel = process.env.NODE_ENV === "development" && Boolean(devTunnelHost);
const nextConfig: NextConfig = {
  ...(useDevTunnel ? { allowedDevOrigins: [devTunnelHost!] } : {}),
  experimental: {
    serverActions: {
      // Allow a 2 MB logo plus multipart overhead; actions still validate file size.
      bodySizeLimit: "3mb",
      // Dev Tunnels may forward an Origin of localhost despite a public host.
      ...(useDevTunnel ? { allowedOrigins: [devTunnelHost!, "localhost:3000"] } : {}),
    },
  },
};

export default nextConfig;
