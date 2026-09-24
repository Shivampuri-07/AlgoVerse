import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { TopicProgress } from "@/lib/progress";

export function TopicProgressCard({ topic }: { topic: TopicProgress }) {
  return (
    <Link href={`/topics/${topic.topicId}`}>
      <Card className="transition-colors hover:border-primary/40 hover:bg-accent/40">
        <CardContent className="space-y-3 p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium leading-snug">{topic.topicName}</p>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </div>
          <Progress value={topic.percent} />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {topic.completed} / {topic.total} completed
            </span>
            <span className="font-medium tabular-nums text-foreground">{topic.percent}%</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
