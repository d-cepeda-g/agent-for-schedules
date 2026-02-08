"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  CalendarPlus,
  CalendarDays,
  Users,
  Phone,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useState } from "react";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/schedule", label: "Schedule", icon: CalendarPlus },
  { href: "/customers", label: "Contacts", icon: Users },
  { href: "/calls", label: "Calls", icon: Phone },
];

const SIDEBAR_COLLAPSED_STORAGE_KEY = "dashboard:sidebar-collapsed";

function readStoredCollapsedState(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function NavLinks({
  onClick,
  collapsed = false,
}: {
  onClick?: () => void;
  collapsed?: boolean;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      {NAV_ITEMS.map((item) => {
        const isActive =
          pathname === item.href ||
          (item.href !== "/" && pathname.startsWith(item.href));

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onClick}
            title={collapsed ? item.label : undefined}
            className={cn(
              "flex items-center rounded-lg text-sm font-medium transition-colors",
              collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5",
              isActive
                ? "bg-sidebar-primary text-sidebar-primary-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )}
          >
            <item.icon className="h-4 w-4" />
            {collapsed ? <span className="sr-only">{item.label}</span> : item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState<boolean>(readStoredCollapsedState);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(
          SIDEBAR_COLLAPSED_STORAGE_KEY,
          next ? "true" : "false"
        );
      } catch {
        // Ignore storage failures.
      }
      return next;
    });
  }

  return (
    <aside
      className={cn(
        "hidden md:flex md:flex-col md:border-r md:border-sidebar-border md:bg-sidebar md:transition-[width] md:duration-200",
        collapsed ? "md:w-20" : "md:w-64"
      )}
    >
      <div
        className={cn(
          "flex h-16 items-center border-b border-sidebar-border",
          collapsed ? "px-2" : "px-4 lg:px-6"
        )}
      >
        <Link
          href="/"
          className={cn(
            "flex items-center gap-2 overflow-hidden",
            collapsed ? "w-8 justify-center" : "min-w-0"
          )}
        >
          <Image
            src="/lumi-logo.svg"
            alt="Lumi logo"
            width={20}
            height={20}
            className="h-5 w-5 object-contain"
          />
          {collapsed ? (
            <span className="sr-only">Lumi</span>
          ) : (
            <span className="truncate text-lg font-semibold">Lumi</span>
          )}
        </Link>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </Button>
      </div>
      <div className={cn("flex-1 py-4", collapsed ? "px-2" : "px-4")}>
        <NavLinks collapsed={collapsed} />
      </div>
    </aside>
  );
}

export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <div className="sticky top-0 z-20 flex h-16 items-center border-b border-[rgba(152,131,229,0.22)] bg-white/82 px-4 backdrop-blur md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon">
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 border-sidebar-border bg-sidebar p-4">
          <div className="mb-6 flex items-center gap-2 px-3">
            <Image
              src="/lumi-logo.svg"
              alt="Lumi logo"
              width={20}
              height={20}
              className="h-5 w-5 object-contain"
            />
            <span className="text-lg font-semibold">Lumi</span>
          </div>
          <NavLinks onClick={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <span className="ml-3 text-lg font-semibold">Lumi</span>
      <Link href="/schedule" className="ml-auto">
        <Button size="sm">
          <CalendarPlus className="h-4 w-4" />
          <span className="ml-2 hidden sm:inline">Schedule Call</span>
        </Button>
      </Link>
    </div>
  );
}
