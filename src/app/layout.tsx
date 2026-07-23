import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { SecurityProvider } from "@/components/providers/security-provider";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
    { media: "(prefers-color-scheme: dark)", color: "#0A0A0F" },
  ],
};

export const metadata: Metadata = {
  title: {
    default: "GenZ TV — Premium Live Streaming",
    template: "%s | GenZ TV",
  },
  description: "GenZ TV — Your premium destination for live TV, sports, cricket, football and entertainment streaming.",
  keywords: ["GenZ TV", "Live TV", "Sports Streaming", "Cricket", "Football", "IPTV", "M3U8", "HLS"],
  authors: [{ name: "GenZ TV" }],
  creator: "GenZ TV",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon.svg", type: "image/svg+xml", media: "(prefers-color-scheme: light)" },
      { url: "/favicon-dark.svg", type: "image/svg+xml", media: "(prefers-color-scheme: dark)" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  manifest: "/manifest.json",
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "GenZ TV",
    title: "GenZ TV — Premium Live Streaming",
    description: "Your premium destination for live TV, sports, cricket, football and entertainment streaming.",
  },
  twitter: {
    card: "summary_large_image",
    title: "GenZ TV — Premium Live Streaming",
    description: "Your premium destination for live TV, sports, cricket, football and entertainment streaming.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body
        className={`${plusJakarta.variable} ${inter.variable} font-sans antialiased bg-background text-foreground`}
        suppressHydrationWarning
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange={false}
        >
          <SecurityProvider>
            {children}
          </SecurityProvider>
          <Toaster
            position="bottom-right"
            toastOptions={{
              className: 'bg-card text-card-foreground border border-border',
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
