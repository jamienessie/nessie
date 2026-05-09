import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/EmptyState";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { chiefOfStaffApi, type ChiefResponse } from "@/api/chiefOfStaff";
import { ChiefResponseCard } from "./ChiefResponseCard";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "What's happening?",
  "What's blocked?",
  "What needs approval?",
  "What's wasting money?",
  "What should happen next?",
  "Which agents are struggling?",
];

interface Turn {
  id: string;
  command: string;
  response?: ChiefResponse;
  loading: boolean;
  error?: string;
}

interface ChiefTranscriptPaneProps {
  companyId: string;
  /** Inject mock turns for the DesignGuide showcase. */
  mockTurns?: Turn[];
}

export function ChiefTranscriptPane({ companyId, mockTurns }: ChiefTranscriptPaneProps) {
  const [turns, setTurns] = useState<Turn[]>(mockTurns ?? []);
  const [composer, setComposer] = useState("");
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  const ask = useMutation({
    mutationFn: async ({ id, command }: { id: string; command: string }) => {
      const response = await chiefOfStaffApi.ask(companyId, command);
      return { id, response };
    },
    onSuccess: ({ id, response }) => {
      setTurns((prev) =>
        prev.map((t) => (t.id === id ? { ...t, response, loading: false } : t)),
      );
    },
    onError: (err, variables) => {
      const message = err instanceof Error ? err.message : "Ask failed";
      setTurns((prev) =>
        prev.map((t) => (t.id === variables.id ? { ...t, error: message, loading: false } : t)),
      );
    },
  });

  const submit = (command: string) => {
    const trimmed = command.trim();
    if (!trimmed) return;
    const id = `turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setTurns((prev) => [...prev, { id, command: trimmed, loading: true }]);
    setComposer("");
    ask.mutate({ id, command: trimmed });
  };

  useEffect(() => {
    const node = transcriptRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [turns.length, ask.isPending]);

  return (
    <div className="flex h-full flex-col">
      {/* Header + suggestions */}
      <div className="shrink-0 border-b border-border px-5 py-3 space-y-2">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4" style={{ color: "var(--tone-operator-fg)" }} />
          <h2 className="text-sm font-semibold">Ask the Chief</h2>
          <span className="ml-auto text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            session
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <Button
              key={s}
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => submit(s)}
              disabled={ask.isPending}
            >
              {s}
            </Button>
          ))}
        </div>
      </div>

      {/* Transcript */}
      <div ref={transcriptRef} className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-5 py-4 space-y-4">
          {turns.length === 0 ? (
            <EmptyState
              icon={Sparkles}
              message="Ask anything about the company. The Chief reads across issues, hires, meetings, costs, and the bus."
            />
          ) : (
            turns.map((turn) => <TurnView key={turn.id} turn={turn} />)
          )}
        </div>
      </div>

      {/* Composer */}
      <form
        className="shrink-0 border-t border-border px-5 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit(composer);
        }}
      >
        <div className="flex items-end gap-2">
          <Textarea
            rows={2}
            placeholder="Ask anything (Shift+Enter for newline)..."
            value={composer}
            onChange={(e) => setComposer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(composer);
              }
            }}
            className="flex-1 min-w-0 resize-none text-sm"
          />
          <Button
            type="submit"
            size="sm"
            disabled={ask.isPending || !composer.trim()}
            className="shrink-0"
          >
            <Send className="size-3" />
            Ask
          </Button>
        </div>
      </form>
    </div>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  return (
    <div className="space-y-2">
      {/* Operator's question */}
      <div className="flex items-start gap-3">
        <Avatar size="sm">
          <AvatarFallback className="bg-foreground text-background font-semibold text-[10px]">
            OP
          </AvatarFallback>
        </Avatar>
        <Card className="flex-1 py-2 gap-0">
          <CardContent className="px-3 py-0">
            <p className="text-sm">{turn.command}</p>
          </CardContent>
        </Card>
      </div>

      {/* Response */}
      <div className={cn("pl-9", turn.loading && "animate-pulse")}>
        {turn.error ? (
          <Card className="py-3">
            <CardContent className="px-4 py-0 text-sm text-destructive">{turn.error}</CardContent>
          </Card>
        ) : turn.response ? (
          <ChiefResponseCard response={turn.response} />
        ) : (
          <Card className="py-3">
            <CardContent className="px-4 py-0 text-sm text-muted-foreground italic">
              Thinking…
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
