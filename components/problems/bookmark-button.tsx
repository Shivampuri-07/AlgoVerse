"use client";

import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export function BookmarkButton({
  problemId,
  size = "icon",
  className,
}: {
  problemId: number;
  size?: "icon" | "sm" | "default";
  className?: string;
}) {
  const bookmarked = useAppStore((s) => s.bookmarked.includes(problemId));
  const toggleBookmark = useAppStore((s) => s.toggleBookmark);

  return (
    <Button
      type="button"
      variant="ghost"
      size={size}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleBookmark(problemId);
      }}
      aria-pressed={bookmarked}
      aria-label={bookmarked ? "Remove bookmark" : "Add bookmark"}
      className={cn(bookmarked && "text-warning", className)}
    >
      <Star className={cn("h-4 w-4", bookmarked && "fill-current")} />
      {size !== "icon" && (bookmarked ? "Bookmarked" : "Bookmark")}
    </Button>
  );
}
