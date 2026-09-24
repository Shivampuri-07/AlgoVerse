"use client";

import * as React from "react";
import { dateKey, formatDateLabel, isoToDateKey } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const WEEKS = 18;

function levelFor(count: number) {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  if (count <= 4) return 3;
  return 4;
}

const LEVEL_CLASSES = [
  "bg-muted",
  "bg-success/25",
  "bg-success/45",
  "bg-success/70",
  "bg-success",
];

/** Simple GitHub-style activity heatmap for the last ~18 weeks. */
export function StreakHeatmap({ timestamps }: { timestamps: string[] }) {
  const cells = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const iso of timestamps) {
      const key = isoToDateKey(iso);
      counts[key] = (counts[key] ?? 0) + 1;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(today);
    const start = new Date(today);
    start.setDate(start.getDate() - (WEEKS * 7 - 1));
    // Align the grid to full weeks starting Sunday.
    start.setDate(start.getDate() - start.getDay());

    const days: { key: string; count: number; inRange: boolean; label: string }[] = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      const key = dateKey(cursor);
      const isFuture = cursor > today;
      days.push({
        key,
        count: isFuture ? 0 : counts[key] ?? 0,
        inRange: !isFuture,
        label: formatDateLabel(key),
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    // group into columns of 7 (weeks)
    const weeks: typeof days[] = [];
    for (let i = 0; i < days.length; i += 7) {
      weeks.push(days.slice(i, i + 7));
    }
    return weeks;
  }, [timestamps]);

  return (
    <div className="space-y-2">
      <div className="flex gap-[3px] overflow-x-auto pb-1 scrollbar-thin">
        {cells.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-[3px]">
            {week.map((day) => (
              <Tooltip key={day.key}>
                <TooltipTrigger asChild>
                  <div
                    className={cn(
                      "h-3 w-3 rounded-[3px]",
                      day.inRange ? LEVEL_CLASSES[levelFor(day.count)] : "bg-transparent"
                    )}
                    aria-hidden={!day.inRange}
                  />
                </TooltipTrigger>
                {day.inRange && (
                  <TooltipContent>
                    {day.count} {day.count === 1 ? "problem" : "problems"} on {day.label}
                  </TooltipContent>
                )}
              </Tooltip>
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        Less
        {LEVEL_CLASSES.map((cls, i) => (
          <span key={i} className={cn("h-3 w-3 rounded-[3px]", cls)} />
        ))}
        More
      </div>
    </div>
  );
}
