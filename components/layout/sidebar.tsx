import Link from "next/link";
import { AlgoVerseLogo } from "@/components/brand/algoverse-logo";
import { APP_NAME } from "@/lib/constants";
import { NavContent } from "@/components/layout/nav-content";

export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 border-r border-border bg-card/40 lg:flex lg:flex-col">
      <div className="flex h-14 items-center gap-2 border-b border-border px-5">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <AlgoVerseLogo />
          {APP_NAME}
        </Link>
      </div>
      <div className="flex-1 overflow-hidden px-3 py-4">
        <NavContent />
      </div>
    </aside>
  );
}
