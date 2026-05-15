import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen } from "lucide-react";
import { snippetsApi, type Snippet } from "../api/snippets";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { Button } from "@/components/ui/button";
import { StackPanel, StackChip } from "@/components/stack";

const ACCENT = "#FFB400";
const KEY_PATTERN = /^[a-z0-9_-]{1,64}$/;

export default function Snippets() {
  const { selectedCompanyId: companyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const qc = useQueryClient();
  const [draftKey, setDraftKey] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Snippets" }]);
  }, [setBreadcrumbs]);

  const listQuery = useQuery({
    queryKey: ["snippets", companyId],
    queryFn: () => (companyId ? snippetsApi.list(companyId) : Promise.resolve({ snippets: [] })),
    enabled: Boolean(companyId),
  });

  const snippets: Snippet[] = listQuery.data?.snippets ?? [];
  const selected = useMemo(
    () => snippets.find((s) => s.key === selectedKey) ?? null,
    [snippets, selectedKey],
  );

  useEffect(() => {
    if (selected) {
      setDraftKey(selected.key);
      setDraftTitle(selected.title);
      setDraftBody(selected.body);
    }
  }, [selected]);

  const upsert = useMutation({
    mutationFn: () => {
      if (!companyId) throw new Error("no company");
      if (!KEY_PATTERN.test(draftKey)) throw new Error("key must match /^[a-z0-9_-]{1,64}$/");
      return snippetsApi.upsert(draftKey, {
        companyId,
        title: draftTitle,
        body: draftBody,
      });
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["snippets", companyId] });
      setSelectedKey(data.snippet.key);
    },
  });

  const remove = useMutation({
    mutationFn: (key: string) => {
      if (!companyId) throw new Error("no company");
      return snippetsApi.delete(key, companyId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["snippets", companyId] });
      setSelectedKey(null);
      setDraftKey("");
      setDraftTitle("");
      setDraftBody("");
    },
  });

  return (
    <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-[260px_1fr]">
      <StackPanel
        color={ACCENT}
        title={
          <span className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            Snippets
          </span>
        }
      >
        <div className="flex flex-col gap-2 p-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setSelectedKey(null);
              setDraftKey("");
              setDraftTitle("");
              setDraftBody("");
            }}
          >
            + New snippet
          </Button>
          {snippets.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              message='No snippets yet. Try keys like "summarize_3_bullets", "refactor_for_testability", "review_for_security" — reusable across Arena, Coaching, and Replay Lab.'
            />
          ) : (
            <ul className="flex flex-col gap-1">
              {snippets.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedKey(s.key)}
                    className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs ${
                      s.key === selectedKey ? "bg-[#0d0c10] text-white" : "hover:bg-muted"
                    }`}
                  >
                    <span className="truncate font-mono">{s.key}</span>
                    <StackChip color="#cbd5e1">v{s.version}</StackChip>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </StackPanel>

      <StackPanel
        color={ACCENT}
        title={<span>{selected ? `Edit ${selected.key}` : "New snippet"}</span>}
        right={
          selected ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => remove.mutate(selected.key)}
              disabled={remove.isPending}
            >
              Delete
            </Button>
          ) : null
        }
      >
        <div className="flex flex-col gap-3 p-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
              key (lowercase, digits, _, -)
            </span>
            <input
              type="text"
              value={draftKey}
              onChange={(e) => setDraftKey(e.target.value)}
              placeholder="summarize_3_bullets"
              disabled={Boolean(selected)}
              className="rounded-md border bg-background px-3 py-2 text-sm font-mono"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
              title
            </span>
            <input
              type="text"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder="Summarize as 3 bullets"
              className="rounded-md border bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
              body
            </span>
            <textarea
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              placeholder="Write the snippet text. Reusable across Arena, agent instructions, Replay Lab."
              rows={12}
              className="rounded-md border bg-background px-3 py-2 text-sm font-mono"
            />
          </label>
          {upsert.error && (
            <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-900">
              {(upsert.error as Error).message}
            </div>
          )}
          <div>
            <Button
              disabled={!draftKey.trim() || !draftTitle.trim() || !draftBody.trim() || upsert.isPending}
              onClick={() => upsert.mutate()}
            >
              {upsert.isPending ? "Saving…" : selected ? "Save new revision" : "Create snippet"}
            </Button>
          </div>
          {selected && (
            <div className="text-xs text-muted-foreground">
              Current version: v{selected.version}. Saving creates v{selected.version + 1}.
            </div>
          )}
        </div>
      </StackPanel>
    </div>
  );
}
