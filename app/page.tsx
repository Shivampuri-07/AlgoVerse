"use client";

import Link from "next/link";
import { ListChecks, CheckCircle2, Circle, Flame, CalendarCheck2, PlayCircle } from "lucide-react";
import { useAppStore, selectCompletedToday } from "@/lib/store";
import {
  getOverallProgress,
  getTopicProgress,
  getNextIncompleteTopics,
  getRecentlySolved,
  getNextUpProblem,
} from "@/lib/progress";
import { getProblemById, PROBLEMS } from "@/data/problems";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/dashboard/stat-card";
import { ProgressRing } from "@/components/dashboard/progress-ring";
import { TopicProgressCard } from "@/components/dashboard/topic-progress-card";
import { StreakHeatmap } from "@/components/dashboard/streak-heatmap";
import { ContinueLearning } from "@/components/dashboard/continue-learning";
import { RecentSolved } from "@/components/dashboard/recent-solved";
import { RandomProblemButton } from "@/components/problems/random-problem-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

const STEP_COUNT = new Set(PROBLEMS.map((p) => p.step).filter(Boolean)).size;

export default function DashboardPage() {
  const hydrated = useAppStore((s) => s.hydrated);
  const completed = useAppStore((s) => s.completed);
  const streak = useAppStore((s) => s.streak);
  const lastVisitedId = useAppStore((s) => s.lastVisitedId);
  const legacy = useAppStore((s) => s.legacy);

  if (!hydrated) return <DashboardSkeleton />;

  const overall = getOverallProgress(completed);
  const topicProgress = getTopicProgress(completed);
  const nextTopics = getNextIncompleteTopics(completed, 4);
  const recent = getRecentlySolved(completed, 6);
  const completedToday = selectCompletedToday(completed);
  const lastVisited = lastVisitedId ? getProblemById(lastVisitedId) : undefined;
  const nextUp = getNextUpProblem(completed);
  const resume = lastVisited ?? nextUp;
  const activityTimestamps = [...Object.values(completed), ...Object.values(legacy?.completed ?? {})];

  return (
    <div className="space-y-6 pb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AlgoVerse</h1>
          <p className="text-sm text-muted-foreground">
            Striver&apos;s A2Z roadmap &middot; {overall.total} items across {STEP_COUNT} steps.
          </p>
        </div>
        <div className="sm:hidden">
          <RandomProblemButton />
        </div>
      </div>

      {resume && (
        <Card className="border-primary/30 bg-primary/[0.04]">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <PlayCircle className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  {lastVisited ? "Continue where you left off" : "Up next in the roadmap"}
                </p>
                <p className="text-sm font-medium">
                  <span className="tabular-nums text-muted-foreground">#{resume.order}</span> {resume.title}
                </p>
              </div>
            </div>
            <Button asChild size="sm">
              <Link href={`/problems/${resume.id}`}>{lastVisited ? "Resume" : "Start"}</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 p-6 sm:flex-row sm:items-center">
            <ProgressRing percent={overall.percent} display={`${overall.percentPrecise}%`} />
            <div className="w-full space-y-2 text-center sm:text-left">
              <p className="text-sm font-medium text-muted-foreground">Overall progress</p>
              <Progress value={overall.percent} className="h-2.5" />
              <p className="text-lg font-semibold tabular-nums">
                {overall.completed} / {overall.total} completed
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex h-full flex-col justify-center gap-4 p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-warning/15 text-warning">
                <Flame className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold tabular-nums">{streak.current} day{streak.current === 1 ? "" : "s"}</p>
                <p className="text-xs text-muted-foreground">Current streak</p>
              </div>
            </div>
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>🏆 Longest streak: <span className="font-medium text-foreground">{streak.longest} days</span></span>
              <span>✅ Today: <span className="font-medium text-foreground">{completedToday}</span></span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={ListChecks} label="Total Problems" value={overall.total} />
        <StatCard icon={CheckCircle2} label="Completed" value={overall.completed} accent="success" />
        <StatCard icon={Circle} label="Remaining" value={overall.remaining} />
        <StatCard icon={CalendarCheck2} label="Solved Today" value={completedToday} accent="warning" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <ContinueLearning topics={nextTopics} />
        </div>
        <div className="lg:col-span-1">
          <RecentSolved problems={recent} />
        </div>
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <StreakHeatmap timestamps={activityTimestamps} />
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Progress by topic</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {topicProgress.map((t) => (
            <TopicProgressCard key={t.topicId} topic={t} />
          ))}
        </div>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6 pb-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
