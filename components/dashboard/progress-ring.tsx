export function ProgressRing({
  percent,
  size = 132,
  strokeWidth = 12,
  label,
  display,
}: {
  percent: number;
  /** Text shown in the middle; defaults to the rounded percent. */
  display?: string;
  size?: number;
  strokeWidth?: number;
  label?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <div
      className="relative inline-flex items-center justify-center"
      role="img"
      aria-label={label ?? `${display ?? `${percent}%`} complete`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-secondary"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="stroke-primary transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold tabular-nums">{display ?? `${percent}%`}</span>
        <span className="text-[11px] text-muted-foreground">complete</span>
      </div>
    </div>
  );
}
