"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ListChecks, Star, Settings, ChevronRight, UserRound, Sparkles } from "lucide-react";
import { TOPIC_CATEGORIES } from "@/data/topics";
import { useAppStore } from "@/lib/store";
import { getTopicProgress } from "@/lib/progress";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";

const FOOTER_LINKS = [
  { href: "/account", label: "Account", icon: UserRound },
  { href: "/pricing", label: "Plans", icon: Sparkles },
  { href: "/settings", label: "Settings", icon: Settings },
];

const PRIMARY_LINKS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/problems", label: "Problems", icon: ListChecks },
  { href: "/bookmarks", label: "Bookmarks", icon: Star },
];

export function NavContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const completed = useAppStore((s) => s.completed);
  const topicProgress = getTopicProgress(completed);
  const progressByTopic = Object.fromEntries(topicProgress.map((t) => [t.topicId, t]));

  return (
    <nav className="flex h-full flex-col gap-6" aria-label="Main navigation">
      <div className="space-y-1">
        {PRIMARY_LINKS.map((link) => {
          const active = pathname === link.href;
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-foreground/80 hover:bg-accent hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {link.label}
            </Link>
          );
        })}
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto scrollbar-thin pr-1">
        {TOPIC_CATEGORIES.map((category) => (
          <div key={category.id}>
            <p className="px-3 pb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {category.name}
            </p>
            <div className="space-y-0.5">
              {category.topicIds.map((topicId) => {
                const progress = progressByTopic[topicId];
                if (!progress) return null;
                const href = `/topics/${topicId}`;
                const active = pathname === href;
                return (
                  <Link
                    key={topicId}
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group flex flex-col gap-1 rounded-lg px-3 py-1.5 text-sm transition-colors",
                      active
                        ? "bg-primary/10 text-primary"
                        : "text-foreground/75 hover:bg-accent hover:text-foreground"
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate">{progress.topicName}</span>
                      <span className="flex items-center gap-1 shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        {progress.completed}/{progress.total}
                        <ChevronRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />
                      </span>
                    </span>
                    <Progress value={progress.percent} className="h-1" />
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-1 border-t border-border pt-3">
        {FOOTER_LINKS.map((link) => {
          const active = pathname === link.href;
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-foreground/80 hover:bg-accent hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
