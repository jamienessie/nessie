import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen } from "lucide-react";
import { snippetsApi, type Snippet } from "../api/snippets";

interface SnippetPickerProps {
  companyId: string | null | undefined;
  onPick: (snippet: Snippet) => void;
  label?: string;
}

// Lightweight picker that drops a button into any LLM-input surface.
// Click to expand the snippet list, click a snippet to invoke onPick
// (typically: insert into the surrounding textarea). Snippets are
// keyed company-wide (no agent filter) so the same picker shape works
// in Arena Compose, Coaching Notes, Replay Lab, etc.
export function SnippetPicker({ companyId, onPick, label = "Insert snippet" }: SnippetPickerProps) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["snippets", companyId],
    queryFn: () => (companyId ? snippetsApi.list(companyId) : Promise.resolve({ snippets: [] })),
    enabled: Boolean(companyId && open),
  });
  const snippets: Snippet[] = q.data?.snippets ?? [];

  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-[11px] font-mono uppercase tracking-wider text-muted-foreground hover:bg-muted"
      >
        <BookOpen className="h-3 w-3" />
        {label}
      </button>
      {open && (
        <div
          className="absolute z-50 mt-1 max-h-72 w-72 overflow-y-auto rounded-md border bg-background shadow-lg"
          role="menu"
        >
          {q.isLoading ? (
            <div className="p-2 text-xs text-muted-foreground">Loading snippets…</div>
          ) : snippets.length === 0 ? (
            <div className="p-2 text-xs text-muted-foreground">
              No snippets yet — create some on the /snippets page.
            </div>
          ) : (
            <ul className="flex flex-col">
              {snippets.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(s);
                      setOpen(false);
                    }}
                    className="flex w-full flex-col gap-0.5 px-3 py-1.5 text-left text-xs hover:bg-muted"
                  >
                    <span className="font-mono">{s.key}</span>
                    <span className="text-[10px] text-muted-foreground">{s.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
