"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CheckCircle2, ChevronLeft, ChevronRight, Circle, ExternalLink, Save, SearchX } from "lucide-react";
import { getProblemById } from "@/data/problems";
import { getTopicById } from "@/data/topics";
import { getProblemsByTopic as problemsInTopic } from "@/lib/progress";
import { useAppStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { DifficultyBadge } from "@/components/problems/difficulty-badge";
import { ProblemActions, PlatformAvailability } from "@/components/problems/platform-links";
import { AiHelper } from "@/components/ai/ai-helper";
import { cn } from "@/lib/utils";
import type { AiProblemContext } from "@/lib/ai/shared";
import { BookmarkButton } from "@/components/problems/bookmark-button";
import { EmptyState } from "@/components/problems/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import type { Problem } from "@/lib/types";

/**
 * Debounced autosave. Pending edits are flushed when the component unmounts (e.g. when
 * navigating to the next problem), so nothing typed in the last half-second is lost.
 */
function useDebouncedSave(value: string, save: (v: string) => void, delay = 500) {
  const [saved, setSaved] = React.useState(true);
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout>>();
  const pendingRef = React.useRef<string | null>(null);
  const saveRef = React.useRef(save);
  saveRef.current = save;
  // Last value known to be in the store — only real edits are saved (StrictMode-safe).
  const lastSavedRef = React.useRef(value);

  React.useEffect(() => {
    if (value === lastSavedRef.current) {
      pendingRef.current = null;
      setSaved(true);
      return;
    }
    setSaved(false);
    pendingRef.current = value;
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      saveRef.current(value);
      lastSavedRef.current = value;
      pendingRef.current = null;
      setSaved(true);
    }, delay);
    return () => clearTimeout(timeoutRef.current);
  }, [value, delay]);

  React.useEffect(
    () => () => {
      if (pendingRef.current !== null) {
        saveRef.current(pendingRef.current);
        lastSavedRef.current = pendingRef.current;
        pendingRef.current = null;
      }
    },
    []
  );

  return saved;
}

export default function ProblemDetailPage() {
  const params = useParams<{ id: string }>();
  const problem = getProblemById(Number(params.id));
  const hydrated = useAppStore((s) => s.hydrated);

  if (!problem) {
    return (
      <EmptyState
        icon={SearchX}
        title="Problem not found"
        description="This problem doesn't exist in the current dataset."
        action={
          <Button asChild size="sm">
            <Link href="/problems">Back to all problems</Link>
          </Button>
        }
      />
    );
  }

  if (!hydrated) {
    return (
      <div className="max-w-3xl space-y-4">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-8 w-80" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  // Keyed so each problem gets fresh editor state (and pending notes flush on switch).
  return <ProblemDetail key={problem.id} problem={problem} />;
}

function ProblemDetail({ problem }: { problem: Problem }) {
  const hydrated = useAppStore((s) => s.hydrated);
  const completed = useAppStore((s) => Boolean(s.completed[problem.id]));
  const setCompleted = useAppStore((s) => s.setCompleted);
  const markVisited = useAppStore((s) => s.markVisited);
  const storedNote = useAppStore((s) => s.notes[problem.id] ?? "");
  const storedMistakes = useAppStore((s) => s.mistakes[problem.id] ?? "");
  const storedCode = useAppStore((s) => s.code[problem.id] ?? "");
  const setNote = useAppStore((s) => s.setNote);
  const setMistakes = useAppStore((s) => s.setMistakes);
  const setCode = useAppStore((s) => s.setCode);

  const [note, setNoteLocal] = React.useState(storedNote);
  const [mistakes, setMistakesLocal] = React.useState(storedMistakes);
  const [code, setCodeLocal] = React.useState(storedCode);

  React.useEffect(() => {
    if (hydrated) markVisited(problem.id);
  }, [hydrated, problem.id, markVisited]);

  const noteSaved = useDebouncedSave(note, (v) => setNote(problem.id, v));
  const mistakesSaved = useDebouncedSave(mistakes, (v) => setMistakes(problem.id, v));
  const codeSaved = useDebouncedSave(code, (v) => setCode(problem.id, v));

  const topic = getTopicById(problem.topic);
  // Only metadata goes to the AI — never a copied problem statement.
  const aiContext = React.useMemo<AiProblemContext>(
    () => ({
      title: problem.title,
      topic: topic?.name ?? problem.topic,
      section: problem.section,
      difficulty: problem.difficulty,
      tags: problem.tags,
      description: problem.description,
    }),
    [problem, topic]
  );
  const topicList = problemsInTopic(problem.topic);
  const indexInTopic = topicList.findIndex((p) => p.id === problem.id);
  const prev = indexInTopic > 0 ? topicList[indexInTopic - 1] : undefined;
  const next = indexInTopic >= 0 && indexInTopic < topicList.length - 1 ? topicList[indexInTopic + 1] : undefined;

  return (
    <div className="max-w-3xl space-y-6 pb-10">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        <Link href={`/topics/${problem.topic}`} className="hover:text-foreground">
          {topic?.name ?? problem.topic}
        </Link>
        {problem.section && (
          <>
            <ChevronRight className="h-3.5 w-3.5" />
            <span>{problem.section}</span>
          </>
        )}
        <ChevronRight className="h-3.5 w-3.5" />
        <span aria-current="page">Problem #{problem.order}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">{problem.title}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Difficulty:</span>
            <DifficultyBadge difficulty={problem.difficulty} />
            {problem.step && <Badge variant="outline">A2Z Step {problem.step}</Badge>}
            {problem.kind === "theory" && <Badge variant="outline">Theory / lesson</Badge>}
            {problem.premium && <Badge variant="warning">LeetCode Premium</Badge>}
          </div>
        </div>
        <BookmarkButton problemId={problem.id} size="default" className="border border-input shadow-sm" />
      </div>

      {problem.description && <p className="text-sm leading-relaxed text-muted-foreground">{problem.description}</p>}

      {problem.tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {problem.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="font-normal">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="space-y-4 p-5">
          <Button
            type="button"
            variant={completed ? "default" : "outline"}
            aria-pressed={completed}
            onClick={() => {
              const value = !completed;
              setCompleted(problem.id, value);
              toast[value ? "success" : "message"](
                value ? `Marked "${problem.title}" as completed` : `Marked "${problem.title}" as incomplete`
              );
            }}
            className={cn(completed && "bg-success text-success-foreground hover:bg-success/90")}
          >
            {completed ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
            {completed ? "Completed" : "Mark Completed"}
          </Button>

          <ProblemActions problem={problem} />

          <details className="group rounded-lg border border-border px-3 py-2 text-sm">
            <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">
              Where to practise &amp; related problems
            </summary>
            <div className="mt-3 space-y-3">
              <PlatformAvailability problem={problem} />
              {problem.related && problem.related.length > 0 && (
                <div className="space-y-1.5 rounded-lg border border-dashed border-border p-3">
                  <p className="font-medium">Related practice (not the identical problem)</p>
                  <ul className="space-y-1">
                    {problem.related.map((r) => (
                      <li key={r.url}>
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          {r.title} <ExternalLink className="h-3 w-3" />
                        </a>
                        {r.note && <span className="text-muted-foreground"> — {r.note}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </details>
        </CardContent>
      </Card>

      <AiHelper problem={aiContext} code={code} />

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">My Notes</CardTitle>
          <SaveIndicator saved={noteSaved} />
        </CardHeader>
        <CardContent>
          <Label htmlFor="notes" className="sr-only">Notes</Label>
          <Textarea
            id="notes"
            value={note}
            onChange={(e) => setNoteLocal(e.target.value)}
            placeholder="Write your notes here... (approach, complexity, edge cases)"
            className="min-h-[120px]"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Mistakes / Things to remember</CardTitle>
          <SaveIndicator saved={mistakesSaved} />
        </CardHeader>
        <CardContent>
          <Label htmlFor="mistakes" className="sr-only">Mistakes and things to remember</Label>
          <Textarea
            id="mistakes"
            value={mistakes}
            onChange={(e) => setMistakesLocal(e.target.value)}
            placeholder="What tripped you up? What should future-you remember?"
            className="min-h-[100px]"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Code / Solution</CardTitle>
          <SaveIndicator saved={codeSaved} />
        </CardHeader>
        <CardContent>
          <Label htmlFor="code" className="sr-only">Code or solution</Label>
          <Textarea
            id="code"
            value={code}
            onChange={(e) => setCodeLocal(e.target.value)}
            placeholder="// Paste or write your solution here (optional)"
            spellCheck={false}
            className="min-h-[180px] font-mono text-[13px]"
          />
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-2">
        {prev ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/problems/${prev.id}`} aria-label={`Previous: ${prev.title}`}>
              <ChevronLeft className="h-4 w-4" /> Previous
            </Link>
          </Button>
        ) : (
          <span />
        )}
        {next && (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/problems/${next.id}`} aria-label={`Next: ${next.title}`}>
              Next <ChevronRight className="h-4 w-4" />
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}

function SaveIndicator({ saved }: { saved: boolean }) {
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <Save className="h-3 w-3" />
      {saved ? "Saved" : "Saving..."}
    </span>
  );
}
