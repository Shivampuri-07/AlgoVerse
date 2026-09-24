import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Difficulty } from "@/lib/types";

const VARIANT: Record<Difficulty, "success" | "warning" | "destructive"> = {
  Easy: "success",
  Medium: "warning",
  Hard: "destructive",
};

export function DifficultyBadge({
  difficulty,
  className,
}: {
  difficulty: Difficulty;
  className?: string;
}) {
  return (
    <Badge variant={VARIANT[difficulty]} className={cn(className)}>
      {difficulty}
    </Badge>
  );
}
