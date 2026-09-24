import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/problems/empty-state";
import type { TopicProgress } from "@/lib/progress";

export function ContinueLearning({ topics }: { topics: TopicProgress[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Continue Learning</CardTitle>
      </CardHeader>
      <CardContent>
        {topics.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="You've completed every topic!"
            description="Incredible work — revisit bookmarks or pick a random problem to stay sharp."
            className="border-none py-8"
          />
        ) : (
          <ul className="space-y-1">
            {topics.map((topic) => (
              <li key={topic.topicId}>
                <Link
                  href={`/topics/${topic.topicId}`}
                  className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-accent"
                >
                  <span className="flex items-center gap-2">
                    <ArrowRight className="h-3.5 w-3.5 text-primary" />
                    {topic.topicName}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {topic.completed}/{topic.total}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
