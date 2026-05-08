import type { CSSProperties, ReactNode } from "react";

export type PanelProps = {
  /** Optional 10-letter mono uppercase header. */
  label?: ReactNode;
  /** Pass an oklch token like "var(--t1)" to glow the panel in that color. */
  accent?: string;
  glow?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
};

export function Panel({ label, accent, glow, className, style, children }: PanelProps) {
  const combinedStyle: CSSProperties = { ...(style ?? {}) };
  if (accent) (combinedStyle as Record<string, string>)["--accent"] = accent;
  return (
    <section
      className={`panel${glow ? " glow" : ""}${className ? ` ${className}` : ""}`}
      style={combinedStyle}
    >
      {label ? <div className="label">{label}</div> : null}
      {children}
    </section>
  );
}
