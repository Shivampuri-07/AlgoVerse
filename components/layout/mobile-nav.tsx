"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ListChecks, Star, Menu } from "lucide-react";
import { AlgoVerseLogo } from "@/components/brand/algoverse-logo";
import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/lib/ui-store";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { NavContent } from "@/components/layout/nav-content";

const TABS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/problems", label: "Problems", icon: ListChecks },
  { href: "/bookmarks", label: "Bookmarks", icon: Star },
];

export function MobileNav() {
  const pathname = usePathname();
  const mobileNavOpen = useUIStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useUIStore((s) => s.setMobileNavOpen);

  return (
    <>
      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-border bg-card/95 backdrop-blur lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors",
                active ? "text-primary" : "text-muted-foreground"
              )}
            >
              <Icon className="h-5 w-5" />
              {tab.label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open full menu"
          className="flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium text-muted-foreground transition-colors"
        >
          <Menu className="h-5 w-5" />
          Menu
        </button>
      </nav>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="flex w-[85%] flex-col overflow-hidden">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <AlgoVerseLogo />
              {APP_NAME}
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-hidden">
            <NavContent onNavigate={() => setMobileNavOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
