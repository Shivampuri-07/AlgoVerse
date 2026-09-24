import { cn } from "@/lib/utils";

/**
 * The AlgoVerse mark: an "A" drawn as a small graph (three nodes, three edges) inside an
 * orbit. Same artwork as the app icons in public/icons and app/icon.svg. The gradient is a
 * CSS background (not an SVG <linearGradient>), so several copies on one page never clash
 * over ids and still render when an earlier copy is hidden.
 */
export function AlgoVerseLogo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[23%] bg-gradient-to-br from-[#5B6CFF] to-[#7A3FF2]",
        className
      )}
      aria-hidden
    >
      <svg viewBox="0 0 512 512" className="h-full w-full" focusable="false">
        <ellipse
          cx="256"
          cy="284"
          rx="196"
          ry="74"
          transform="rotate(-18 256 284)"
          fill="none"
          stroke="#fff"
          strokeOpacity="0.32"
          strokeWidth="14"
        />
        <g stroke="#fff" strokeWidth="30" strokeLinecap="round">
          <line x1="256" y1="124" x2="160" y2="386" />
          <line x1="256" y1="124" x2="352" y2="386" />
          <line x1="195" y1="292" x2="317" y2="292" />
        </g>
        <g fill="#fff">
          <circle cx="256" cy="124" r="38" />
          <circle cx="160" cy="386" r="38" />
          <circle cx="352" cy="386" r="38" />
        </g>
        <circle cx="436" cy="222" r="20" fill="#7DE3FF" />
      </svg>
    </span>
  );
}
