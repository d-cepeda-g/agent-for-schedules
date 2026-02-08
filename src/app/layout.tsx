import type { Metadata } from "next";
import Link from "next/link";
import { CalendarPlus } from "lucide-react";
import "./globals.css";
import { Sidebar, MobileNav } from "@/components/sidebar";
import { Button } from "@/components/ui/button";
import { DispatchHeartbeat } from "@/components/dispatch-heartbeat";

export const metadata: Metadata = {
  title: "Call Scheduler",
  description: "Schedule and manage outbound AI calls with ElevenLabs",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <DispatchHeartbeat />
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="hidden h-16 items-center justify-end border-b px-6 md:flex">
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
      </body>
    </html>
  );
}
