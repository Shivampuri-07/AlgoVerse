"use client";

import * as React from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Reloads the page the user was trying to open; retries automatically when back online. */
export function RetryButton() {
  React.useEffect(() => {
    const onOnline = () => window.location.reload();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);
  return (
    <Button onClick={() => window.location.reload()}>
      <RotateCcw className="h-4 w-4" /> Try again
    </Button>
  );
}
