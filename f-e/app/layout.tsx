import type { Metadata } from "next";
import { Geist, Geist_Mono, Raleway } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/context/ThemeContext";
import { ToastProvider } from "@/components/context/ToastContext";
import { PivyChatProvider } from "@/components/context/PivyChatContext";
import { FavoritesProvider } from "@/components/context/FavoritesContext";
import { WatchlistProvider } from "@/components/context/WatchlistContext";
import { PaperTradingProvider } from "@/components/context/PaperTradingContext";
import { MarketStatusProvider } from "@/components/context/MarketStatusContext";
import PostLoginToastHandler from '@/components/ui/PostLoginToastHandler';
import NavigationWrapper from "@/components/navigation/NavigationWrapper";
import { UIProvider } from "@/components/context/UIContext";

const raleway = Raleway({
  variable: "--font-raleway",
  subsets: ["latin"],
});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Pivotal AI - Trading Platform",
  description: "AI-powered trading platform with real-time insights",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${raleway.variable} antialiased`}
      >
        <ThemeProvider>
          <ToastProvider>
            <MarketStatusProvider>
            <PostLoginToastHandler />
            {/* UIProvider for global modal state */}
            <UIProvider>
              <PivyChatProvider>
              <FavoritesProvider>
              <WatchlistProvider>
              <PaperTradingProvider>
              <div className="min-h-screen flex flex-col">
                {/* Navigation wrapper conditionally renders TopNav and BottomNav */}
                <NavigationWrapper />
                {/* Main Content Area */}
                <main className="flex-1 md:pb-0">
                  {children}
                </main>
              </div>
              </PaperTradingProvider>
              </WatchlistProvider>
              </FavoritesProvider>
              </PivyChatProvider>
            </UIProvider>
            </MarketStatusProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
