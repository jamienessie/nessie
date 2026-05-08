// 5-segment star bar from the cockpit reference. Each segment is a
// 14×4 rounded rect; filled with --accent for scored segments, with
// --line-soft for unfilled. Used in HR candidate cards and trial
// scorecards.

export function StarBar({
  score,
  outOf = 5,
  accent = "var(--d-eng)",
  width = 100,
}: {
  score: number;
  outOf?: number;
  accent?: string;
  width?: number;
}) {
  const filled = Math.max(0, Math.min(outOf, Math.round(score)));
  const segments = Array.from({ length: outOf }, (_, i) => i < filled);
  const segmentWidth = Math.max(8, Math.floor((width - (outOf - 1) * 2) / outOf));
  return (
    <span
      style={{
        display: "inline-flex",
        gap: 2,
        verticalAlign: "middle",
        ["--accent" as string]: accent,
      } as React.CSSProperties}
      aria-label={`${filled} of ${outOf}`}
    >
      {segments.map((on, i) => (
        <span
          key={i}
          style={{
            width: segmentWidth,
            height: 4,
            borderRadius: 2,
            background: on ? accent : "var(--line-soft)",
            boxShadow: on ? `0 0 6px 0 ${accent}` : "none",
          }}
        />
      ))}
    </span>
  );
}
