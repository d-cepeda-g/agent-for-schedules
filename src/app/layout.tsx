import type { Metadata } from "next";
import "./globals.css";
import { Sidebar, MobileNav } from "@/components/sidebar";
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
            <MobileNav />
            <main className="flex-1 overflow-y-auto p-6">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
