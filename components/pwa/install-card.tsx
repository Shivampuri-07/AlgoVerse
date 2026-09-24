"use client";

import * as React from "react";
import { CheckCircle2, Download, Share, Smartphone } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { promptInstall, usePwaStore } from "@/lib/pwa-store";

/** Settings → "Install app": the honest state of installation for this browser. */
export function InstallCard() {
  const installEvent = usePwaStore((s) => s.installEvent);
  const installed = usePwaStore((s) => s.installed);
  const isIos = usePwaStore((s) => s.isIos);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Smartphone className="h-4 w-4" /> Install app
        </CardTitle>
        <CardDescription>
          AlgoVerse can be installed on your phone or computer and opens in its own window.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm">
        {!mounted ? null : installed ? (
          <p className="flex items-center gap-2 text-success">
            <CheckCircle2 className="h-4 w-4" /> You&apos;re using the installed app.
          </p>
        ) : installEvent ? (
          <Button onClick={() => void promptInstall()}>
            <Download className="h-4 w-4" /> Install AlgoVerse
          </Button>
        ) : isIos ? (
          <p className="text-muted-foreground">
            In Safari, tap <Share className="inline h-4 w-4 align-text-bottom" aria-label="Share" />{" "}
            <strong className="text-foreground">Share</strong>, then{" "}
            <strong className="text-foreground">Add to Home Screen</strong>.
          </p>
        ) : (
          <p className="text-muted-foreground">
            Your browser hasn&apos;t offered installation here. In Chrome or Edge use the install icon in the
            address bar (or the menu → <em>Install AlgoVerse</em>); on Android use the menu →{" "}
            <em>Install app</em> / <em>Add to Home screen</em>.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
