import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/problems/empty-state";

export default function NotFound() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <EmptyState
        icon={Compass}
        title="Page not found"
        description="The page you're looking for doesn't exist. Let's get you back on the roadmap."
        action={
          <Button asChild size="sm">
            <Link href="/">Back to Dashboard</Link>
          </Button>
        }
      />
    </div>
  );
}
