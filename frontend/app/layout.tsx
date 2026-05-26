import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { RegisterSW } from "@/components/dashboard/RegisterSW";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
  weight: ["300", "400", "500", "600", "700", "800"],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains-mono",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "PolyWeather | Institutional Weather Signal Intelligence",
    template: "%s | PolyWeather",
  },
  description:
    "PolyWeather is a paid professional weather-signal intelligence terminal with METAR evidence, DEB forecast blending, and AI decision cards. Real-time observations for 51 global cities.",
  manifest: "/site.webmanifest",
  metadataBase: new URL("https://polyweather.top"),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    siteName: "PolyWeather",
    title: "PolyWeather | Institutional Weather Signal Intelligence",
    description:
      "Paid professional weather-signal intelligence terminal. METAR evidence, DEB forecast blending, AI decision cards. 51 cities, real-time.",
    url: "https://polyweather.top",
    images: [
      {
        url: "/apple-touch-icon.png",
        width: 180,
        height: 180,
        alt: "PolyWeather",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "PolyWeather | Weather Signal Intelligence",
    description:
      "Paid professional weather-signal intelligence terminal. 51 cities, real-time observations.",
    images: ["/apple-touch-icon.png"],
  },
  robots: {
    index: true,
    follow: true,
    "max-video-preview": -1,
    "max-image-preview": "large",
    "max-snippet": -1,
  },
  icons: {
    icon: [
      { url: "/favicon.ico", type: "image/x-icon" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
    shortcut: ["/favicon.ico"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="zh-CN"
      className={`${inter.variable} ${jetbrainsMono.variable} light`}
    >
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <a href="#main-content" className="skip-to-content">
          Skip to content
        </a>
        <main id="main-content">{children}</main>
        <RegisterSW />
      </body>
    </html>
  );
}
