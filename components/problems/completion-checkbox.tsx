"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { useAppStore } from "@/lib/store";
import { toast } from "sonner";

export function CompletionCheckbox({ problemId, title }: { problemId: number; title: string }) {
  const completed = useAppStore((s) => Boolean(s.completed[problemId]));
  const setCompleted = useAppStore((s) => s.setCompleted);

  return (
    <Checkbox
      checked={completed}
      onClick={(e) => e.stopPropagation()}
      onCheckedChange={(checked) => {
        const value = checked === true;
        setCompleted(problemId, value);
        if (value) toast.success(`Marked "${title}" as completed`);
      }}
      aria-label={completed ? `Mark ${title} as incomplete` : `Mark ${title} as completed`}
      // 20px box, ~40px touch area (invisible pseudo-element) for phones.
      className="relative after:absolute after:-inset-2.5 after:content-['']"
    />
  );
}
