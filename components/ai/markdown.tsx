import * as React from "react";

/**
 * Tiny, safe Markdown renderer for AI answers. Builds React elements (no
 * dangerouslySetInnerHTML), and only ever puts inline elements inside <p>/<li>, so the
 * output is always valid DOM nesting. Supports: fenced code, headings, bullet and
 * numbered lists, paragraphs, **bold**, *italic*, `inline code`.
 */

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = pattern.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const token = m[0];
    const key = `${keyPrefix}-${i++}`;
    if (token.startsWith("`")) {
      nodes.push(
        <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = m.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

type Block =
  | { type: "code"; lang: string; text: string }
  | { type: "heading"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "p"; text: string };

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^\s*```\s*([\w+#-]*)\s*$/);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++; // closing fence (or end while streaming)
      blocks.push({ type: "code", lang: fence[1], text: body.join("\n") });
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = line.match(/^\s*#{1,6}\s+(.*)$/);
    if (heading) {
      blocks.push({ type: "heading", text: heading[1] });
      i++;
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*+]\s+/, ""));
      blocks.push({ type: "ul", items });
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ""));
      blocks.push({ type: "ol", items });
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*```/.test(lines[i]) &&
      !/^\s*#{1,6}\s+/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i])
    ) {
      para.push(lines[i++]);
    }
    blocks.push({ type: "p", text: para.join(" ") });
  }
  return blocks;
}

export function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {blocks.map((b, bi) => {
        const k = `b${bi}`;
        switch (b.type) {
          case "code":
            return (
              <pre key={k} className="overflow-x-auto rounded-lg border border-border bg-muted/60 p-3 text-[12.5px] leading-snug">
                <code className="font-mono">{b.text}</code>
              </pre>
            );
          case "heading":
            return (
              <p key={k} className="font-semibold">
                {renderInline(b.text, k)}
              </p>
            );
          case "ul":
            return (
              <ul key={k} className="list-disc space-y-1 pl-5">
                {b.items.map((it, ii) => (
                  <li key={ii}>{renderInline(it, `${k}-${ii}`)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={k} className="list-decimal space-y-1 pl-5">
                {b.items.map((it, ii) => (
                  <li key={ii}>{renderInline(it, `${k}-${ii}`)}</li>
                ))}
              </ol>
            );
          default:
            return <p key={k}>{renderInline(b.text, k)}</p>;
        }
      })}
    </div>
  );
}
