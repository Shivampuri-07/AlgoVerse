import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  hint?: string;
  accent?: "default" | "success" | "warning";
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold tabular-nums">{value}</p>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            accent === "success" && "bg-success/15 text-success",
            accent === "warning" && "bg-warning/15 text-warning",
            (!accent || accent === "default") && "bg-primary/10 text-primary"
          )}
        >
          <Icon className="h-[18px] w-[18px]" />
        </div>
      </CardContent>
    </Card>
  );
}
