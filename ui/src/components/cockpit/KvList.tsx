import type { ReactNode } from "react";

export type KvRow = { key: string; value: ReactNode };

export function KvList({ rows }: { rows: KvRow[] }) {
  return (
    <div className="kv-list">
      {rows.map((row) => (
        <div key={row.key} className="row">
          <span>{row.key}</span>
          <b>{row.value}</b>
        </div>
      ))}
    </div>
  );
}
