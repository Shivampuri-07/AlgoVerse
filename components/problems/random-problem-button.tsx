"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Dice5 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { TOPICS } from "@/data/topics";
import { useAppStore } from "@/lib/store";
import { pickRandomProblem } from "@/lib/progress";

export function RandomProblemButton({ variant = "outline" }: { variant?: "outline" | "default" | "secondary" }) {
  const router = useRouter();
  const completed = useAppStore((s) => s.completed);
  const [topic, setTopic] = React.useState("all");
  const [difficulty, setDifficulty] = React.useState("all");
  const [open, setOpen] = React.useState(false);

  function handlePick() {
    const problem = pickRandomProblem(completed, { topic, difficulty });
    if (!problem) {
      toast.error("No incomplete problems match those filters.");
      return;
    }
    setOpen(false);
    router.push(`/problems/${problem.id}`);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant={variant} type="button">
          <Dice5 className="h-4 w-4" />
          Random Problem
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-4">
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Random from</p>
          <p className="text-xs text-muted-foreground">
            Picks a problem you haven&apos;t completed yet.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="random-topic" className="text-xs">Topic</Label>
          <Select value={topic} onValueChange={setTopic}>
            <SelectTrigger id="random-topic">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All topics</SelectItem>
              {TOPICS.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="random-difficulty" className="text-xs">Difficulty</Label>
          <Select value={difficulty} onValueChange={setDifficulty}>
            <SelectTrigger id="random-difficulty">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Easy / Medium / Hard</SelectItem>
              <SelectItem value="Easy">Easy</SelectItem>
              <SelectItem value="Medium">Medium</SelectItem>
              <SelectItem value="Hard">Hard</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button onClick={handlePick} className="w-full">
          <Dice5 className="h-4 w-4" />
          Pick a problem
        </Button>
      </PopoverContent>
    </Popover>
  );
}
