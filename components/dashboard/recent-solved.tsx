import Link from "next/link";
import { CheckCircle2, History } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/problems/empty-state";
import { DifficultyBadge } from "@/components/problems/difficulty-badge";
import type { Problem } from "@/lib/types";

export function RecentSolved({ problems }: { problems: (Problem & { completedAt: string })[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recently Solved</CardTitle>
      </CardHeader>
      <CardContent>
        {problems.length === 0 ? (
          <EmptyState
            icon={History}
            title="No problems solved yet"
            description="Mark a problem as completed and it'll show up here."
            className="border-none py-8"
          />
        ) : (
          <ul className="space-y-1">
            {problems.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/problems/${p.id}`}
                  className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-accent"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                    <span className="truncate">{p.title}</span>
                  </span>
                  <DifficultyBadge difficulty={p.difficulty} className="shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
