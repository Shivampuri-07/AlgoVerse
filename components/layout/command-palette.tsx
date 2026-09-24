"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LayoutDashboard, ListChecks, Star, Settings, ArrowRight } from "lucide-react";
import { PROBLEMS } from "@/data/problems";
import { getTopicById } from "@/data/topics";
import { useUIStore } from "@/lib/ui-store";
import { problemSearchText } from "@/lib/use-problem-filters";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { DifficultyBadge } from "@/components/problems/difficulty-badge";

export function CommandPalette() {
  const open = useUIStore((s) => s.commandOpen);
  const setOpen = useUIStore((s) => s.setCommandOpen);
  const router = useRouter();

  const go = React.useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router, setOpen]
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search problems, topics, tags..." aria-label="Search" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigate">
          <CommandItem onSelect={() => go("/")}>
            <LayoutDashboard /> Dashboard
            <CommandShortcut>g d</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/problems")}>
            <ListChecks /> All Problems
            <CommandShortcut>g p</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/bookmarks")}>
            <Star /> Bookmarks
            <CommandShortcut>g b</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/settings")}>
            <Settings /> Settings
            <CommandShortcut>g s</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Problems">
          {PROBLEMS.map((problem) => {
            const topic = getTopicById(problem.topic);
            return (
              <CommandItem
                key={problem.id}
                value={`${problem.order} ${problemSearchText(problem)}`}
                onSelect={() => go(`/problems/${problem.id}`)}
              >
                <ArrowRight />
                <span className="w-8 shrink-0 text-xs tabular-nums text-muted-foreground">{problem.order}</span>
                <span className="flex-1 truncate">{problem.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{topic?.name}</span>
                <DifficultyBadge difficulty={problem.difficulty} className="ml-2" />
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
