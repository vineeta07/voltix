import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: { default: "VOLTIX — the traffic signal for EV charging", template: "%s · VOLTIX" },
  description:
    "VOLTIX gives every EV on a shared transformer its own start time, so everyone keeps the cheap rate and the site never exceeds its real capacity.",
  applicationName: "VOLTIX",
  openGraph: { title: "VOLTIX", description: "The traffic signal for EV charging on a neighbourhood transformer.", images: ["/og.png"] },
  appleWebApp: { capable: true, title: "VOLTIX", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F6F2" },
    { media: "(prefers-color-scheme: dark)", color: "#0B1F2B" },
  ],
};

// Runs before paint so the saved theme never flashes.
const themeScript = `try{var t=localStorage.getItem('voltix.theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
