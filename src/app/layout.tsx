import type { Metadata } from "next";
import Link from "next/link";
import { JetBrains_Mono, Manrope } from "next/font/google";
import { CalendarPlus } from "lucide-react";
import "./globals.css";
import { Sidebar, MobileNav } from "@/components/sidebar";
import { Button } from "@/components/ui/button";
import { DispatchHeartbeat } from "@/components/dispatch-heartbeat";
import { LumiChatWidget } from "@/components/lumi-chat-widget";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Lumi",
  description: "Schedule and manage outbound AI calls with ElevenLabs",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${manrope.variable} ${jetBrainsMono.variable} antialiased`}>
        <DispatchHeartbeat />
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="sticky top-0 z-20 hidden h-16 items-center justify-end border-b border-[rgba(152,131,229,0.22)] bg-white/82 px-6 backdrop-blur md:flex">
              <Link href="/schedule">
                <Button size="sm">
                  <CalendarPlus className="mr-2 h-4 w-4" />
                  Schedule Call
                </Button>
              </Link>
            </div>
            <MobileNav />
            <main className="flex-1 overflow-y-auto p-6">{children}</main>
          </div>
        </div>
        <LumiChatWidget />
      </body>
    </html>
  );
}
