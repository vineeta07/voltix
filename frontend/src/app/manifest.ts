import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "VOLTIX",
    short_name: "VOLTIX",
    description: "Plug in, pick your ready-by time, and VOLTIX finds your charging slot.",
    start_url: "/app/charge",
    display: "standalone",
    background_color: "#F7F6F2",
    theme_color: "#0F2A3A",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
