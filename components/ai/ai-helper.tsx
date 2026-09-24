"use client";

import * as React from "react";
import { Bot, ChevronDown, Eraser, RotateCcw, Send, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Markdown } from "@/components/ai/markdown";
import { streamAiReply } from "@/lib/ai/client";
import {
  AI_LIMITS,
  AI_QUICK_ACTIONS,
  type AiActionId,
  type AiChatMessage,
  type AiProblemContext,
  type AiQuickAction,
} from "@/lib/ai/shared";
import { cn } from "@/lib/utils";

interface ChatError {
  message: string;
  /** The conversation to resend when the user presses Retry. */
  retry: AiChatMessage[];
  action?: AiActionId;
}

/**
 * The per-problem AI tutor. Talks only to our own /api/ai route (the Gemini API key stays
 * on the server). Collapsible on phones, always open from the md breakpoint up.
 */
export function AiHelper({ problem, code }: { problem: AiProblemContext; code?: string }) {
  const [messages, setMessages] = React.useState<AiChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<ChatError | null>(null);
  const [expanded, setExpanded] = React.useState(false);
  const [debugOpen, setDebugOpen] = React.useState(false);
  const [debugCode, setDebugCode] = React.useState(code ?? "");
  const abortRef = React.useRef<AbortController | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const panelId = React.useId();

  React.useEffect(() => () => abortRef.current?.abort(), []);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading, error]);

  const send = React.useCallback(
    async (conversation: AiChatMessage[], action: AiActionId = "chat") => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setError(null);
      setLoading(true);
      setMessages([...conversation, { role: "assistant", content: "" }]);

      const history = conversation.slice(-AI_LIMITS.maxMessages);
      let answer = "";
      const result = await streamAiReply(
        { problem, messages: history, action },
        (piece) => {
          answer += piece;
          setMessages([...conversation, { role: "assistant", content: answer }]);
        },
        controller.signal
      );

      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
      if (!result.ok) {
        // Keep whatever arrived before the failure; drop an empty assistant bubble.
        setMessages(answer ? [...conversation, { role: "assistant", content: answer }] : conversation);
        if (!result.aborted) setError({ message: result.message, retry: conversation, action });
      }
    },
    [problem]
  );

  function ask(text: string, action: AiActionId = "chat", attachedCode?: string) {
    const content = text.trim();
    if (!content || loading) return;
    if (content.length > AI_LIMITS.maxMessageChars) {
      setError({ message: `Please keep messages under ${AI_LIMITS.maxMessageChars} characters.`, retry: [] });
      return;
    }
    if (attachedCode && attachedCode.length > AI_LIMITS.maxCodeChars) {
      setError({ message: `Please keep code under ${AI_LIMITS.maxCodeChars} characters.`, retry: [] });
      return;
    }
    setExpanded(true);
    const message: AiChatMessage = attachedCode ? { role: "user", content, code: attachedCode } : { role: "user", content };
    void send([...messages.filter((m) => m.content), message], action);
  }

  function runQuickAction(action: AiQuickAction) {
    if (action.needsCode) {
      setExpanded(true);
      setDebugOpen(true);
      if (!debugCode.trim() && code) setDebugCode(code);
      return;
    }
    ask(action.prompt, action.id);
  }

  function sendDebug() {
    if (!debugCode.trim()) return;
    const action = AI_QUICK_ACTIONS.find((a) => a.id === "debug")!;
    ask(action.prompt, "debug", debugCode);
    setDebugOpen(false);
  }

  function stop() {
    abortRef.current?.abort();
  }

  function clear() {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setLoading(false);
  }

  const visible = messages.filter((m) => m.role === "user" || m.content || loading);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot className="h-4 w-4 text-primary" aria-hidden />
            AI DSA Helper
          </CardTitle>
          <p className="text-sm text-muted-foreground">Stuck? Ask for a hint — I&apos;ll help you get unstuck.</p>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clear} aria-label="Clear conversation">
              <Eraser className="h-4 w-4" />
              <span className="hidden sm:inline">Clear</span>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="md:hidden"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls={panelId}
          >
            {expanded ? "Hide" : "Open"}
            <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
          </Button>
        </div>
      </CardHeader>

      <CardContent id={panelId} className={cn("space-y-3", expanded ? "block" : "hidden md:block")}>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Quick questions">
          {AI_QUICK_ACTIONS.map((action) => (
            <Button
              key={action.id}
              type="button"
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => runQuickAction(action)}
            >
              <span aria-hidden>{action.emoji}</span>
              {action.label}
            </Button>
          ))}
        </div>

        {debugOpen && (
          <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
            <div className="flex items-center justify-between">
              <Label htmlFor={`${panelId}-code`}>Paste the code you want checked</Label>
              <Button variant="ghost" size="icon" onClick={() => setDebugOpen(false)} aria-label="Close code box">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <Textarea
              id={`${panelId}-code`}
              value={debugCode}
              onChange={(e) => setDebugCode(e.target.value)}
              spellCheck={false}
              placeholder="// your solution"
              className="min-h-[140px] font-mono text-[13px]"
            />
            <div className="flex justify-end">
              <Button size="sm" onClick={sendDebug} disabled={!debugCode.trim() || loading}>
                <span aria-hidden>🐛</span> Find the bug
              </Button>
            </div>
          </div>
        )}

        {(visible.length > 0 || error) && (
          <div
            ref={scrollRef}
            className="max-h-[28rem] space-y-3 overflow-y-auto rounded-lg border border-border bg-muted/20 p-3"
            aria-live="polite"
            aria-busy={loading}
          >
            {visible.map((m, i) => {
              const isLast = i === visible.length - 1;
              return (
                <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[92%] rounded-xl px-3 py-2",
                      m.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "border border-border bg-card"
                    )}
                  >
                    <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide opacity-70">
                      {m.role === "user" ? "You" : "AI"}
                    </span>
                    {m.role === "user" ? (
                      <div className="space-y-2">
                        <div className="whitespace-pre-wrap break-words text-sm">{m.content}</div>
                        {m.code && (
                          <pre className="max-h-48 overflow-auto rounded-md bg-black/20 p-2 font-mono text-[12px] leading-relaxed">
                            <code>{m.code}</code>
                          </pre>
                        )}
                      </div>
                    ) : m.content ? (
                      <Markdown text={m.content} />
                    ) : (
                      isLast &&
                      loading && (
                        <span className="flex items-center gap-2 text-sm text-muted-foreground">
                          <span className="inline-flex gap-1" aria-hidden>
                            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.2s]" />
                            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.1s]" />
                            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
                          </span>
                          Thinking…
                        </span>
                      )
                    )}
                  </div>
                </div>
              );
            })}

            {error && (
              <div
                role="alert"
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                <span className="whitespace-pre-line">{error.message}</span>
                {error.retry.length > 0 && error.retry[error.retry.length - 1].role === "user" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void send(error.retry, error.action)}
                    disabled={loading}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Retry
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
            setInput("");
          }}
        >
          <Label htmlFor={`${panelId}-input`} className="sr-only">
            Ask the AI helper
          </Label>
          <Textarea
            id={`${panelId}-input`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                ask(input);
                setInput("");
              }
            }}
            placeholder="Ask AI something… (Enter to send, Shift+Enter for a new line)"
            rows={2}
            className="min-h-[44px] flex-1 resize-y"
            maxLength={AI_LIMITS.maxMessageChars}
          />
          {loading ? (
            <Button type="button" variant="outline" onClick={stop} aria-label="Stop generating">
              <Square className="h-4 w-4" />
              Stop
            </Button>
          ) : (
            <Button type="submit" disabled={!input.trim()} aria-label="Send message">
              <Send className="h-4 w-4" />
              Send
            </Button>
          )}
        </form>

        <p className="text-xs text-muted-foreground">
          Powered by Google Gemini (free tier) — answers can be rate-limited or wrong, so reason them through.
          Only the problem&apos;s title, topic, section, difficulty and tags (plus any code you paste) are shared.
        </p>
      </CardContent>
    </Card>
  );
}
