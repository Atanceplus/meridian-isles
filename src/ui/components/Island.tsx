import type { ReactNode } from "react";

/** The banner at the top of an island page. */
export function IslandHeader({ islandId, eyebrow, title, intro, children }: { islandId: string; eyebrow: string; title: string; intro: ReactNode; children?: ReactNode }) {
  return (
    <header className={`island-head island-${islandId.split(".")[1]}`}>
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p className="muted">{intro}</p>
      </div>
      {children}
    </header>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, small }: { tabs: [T, string][]; value: T; onChange(v: T): void; small?: boolean }) {
  return (
    <div className={`tabs ${small ? "small" : ""}`} role="tablist">
      {tabs.map(([key, label]) => (
        <button key={key} role="tab" aria-selected={value === key} className={value === key ? "on" : ""} onClick={() => onChange(key)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** "3:45" or "225" → seconds; null if unreadable. */
export function parseDuration(text: string): number | null {
  const t = text.trim();
  const m = /^(\d+):([0-5]?\d)$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  return /^\d+$/.test(t) ? Number(t) : null;
}
