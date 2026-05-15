import { useCallback, useEffect, useState } from "react";
import { Copy, ExternalLink, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Phase = "idle" | "starting" | "urlReady" | "submitting" | "done" | "error";

type StartResponse = { sessionId: string; signinUrl: string };
type CompleteResponse = {
  ok: boolean;
  devinAuthed: boolean;
  secretId: string | null;
  secretName: string | null;
  secretError?: string;
};

interface WindsurfSignInModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string | null;
  onConnected: (result: { secretId: string; secretName: string }) => void;
}

const inputClass =
  "w-full rounded-md border border-border px-2.5 py-1.5 bg-transparent outline-none text-sm font-mono placeholder:text-muted-foreground/40";

export function WindsurfSignInModal({
  open,
  onOpenChange,
  companyId,
  onConnected,
}: WindsurfSignInModalProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [signinUrl, setSigninUrl] = useState<string>("");
  const [token, setToken] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [errorDetail, setErrorDetail] = useState<string>("");
  const [copied, setCopied] = useState(false);

  const reset = useCallback(() => {
    setPhase("idle");
    setSessionId(null);
    setSigninUrl("");
    setToken("");
    setErrorMessage("");
    setErrorDetail("");
    setCopied(false);
  }, []);

  const start = useCallback(async () => {
    if (!companyId) {
      setPhase("error");
      setErrorMessage("Select a company before signing in.");
      return;
    }
    setPhase("starting");
    setErrorMessage("");
    setErrorDetail("");
    try {
      const res = await fetch("/api/adapters/windsurf/signin/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      const body = (await res.json()) as StartResponse & {
        error?: string;
        hint?: string;
        stdout?: string;
        stderr?: string;
      };
      if (!res.ok) {
        setPhase("error");
        setErrorMessage(body.error ?? "Failed to start sign-in.");
        setErrorDetail(body.hint ?? body.stderr ?? body.stdout ?? "");
        return;
      }
      setSessionId(body.sessionId);
      setSigninUrl(body.signinUrl);
      setPhase("urlReady");
    } catch (err) {
      setPhase("error");
      setErrorMessage("Network error while starting sign-in.");
      setErrorDetail(err instanceof Error ? err.message : String(err));
    }
  }, [companyId]);

  useEffect(() => {
    if (open && phase === "idle") {
      void start();
    }
    if (!open) {
      reset();
    }
  }, [open, phase, start, reset]);

  const submitToken = useCallback(async () => {
    if (!sessionId || !companyId || !token.trim()) return;
    setPhase("submitting");
    setErrorMessage("");
    setErrorDetail("");
    try {
      const res = await fetch("/api/adapters/windsurf/signin/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId,
          token: token.trim(),
          companyId,
          bindEnv: true,
        }),
      });
      const body = (await res.json()) as CompleteResponse & {
        error?: string;
        stdout?: string;
        stderr?: string;
      };
      if (!res.ok || !body.ok) {
        setPhase("error");
        setErrorMessage(body.error ?? "Sign-in failed.");
        setErrorDetail(body.stderr ?? body.stdout ?? body.secretError ?? "");
        return;
      }
      setPhase("done");
      if (body.secretId && body.secretName) {
        onConnected({ secretId: body.secretId, secretName: body.secretName });
      }
      // Auto-close after a beat so the user sees "Connected".
      setTimeout(() => onOpenChange(false), 1200);
    } catch (err) {
      setPhase("error");
      setErrorMessage("Network error while submitting token.");
      setErrorDetail(err instanceof Error ? err.message : String(err));
    }
  }, [sessionId, companyId, token, onConnected, onOpenChange]);

  const copyUrl = useCallback(() => {
    if (!signinUrl) return;
    void navigator.clipboard.writeText(signinUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [signinUrl]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Sign in to Windsurf</DialogTitle>
          <DialogDescription>
            Nessie is driving <code className="text-xs bg-muted px-1 py-0.5 rounded">devin auth login --force-manual-token-flow</code>{" "}
            so you can complete the Windsurf manual sign-in without leaving the app.
          </DialogDescription>
        </DialogHeader>

        {phase === "starting" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Asking Devin for a sign-in URL…
          </div>
        )}

        {phase === "urlReady" || phase === "submitting" || phase === "done" ? (
          <div className="space-y-4">
            <div>
              <div className="text-xs text-muted-foreground mb-1">
                1. Open this URL in your browser and complete sign-in:
              </div>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={signinUrl}
                  className={cn(inputClass, "truncate")}
                />
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent/50 transition-colors shrink-0"
                  onClick={copyUrl}
                >
                  <Copy className="h-3 w-3" />
                  {copied ? "Copied" : "Copy"}
                </button>
                <a
                  href={signinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent/50 transition-colors shrink-0"
                >
                  <ExternalLink className="h-3 w-3" />
                  Open
                </a>
              </div>
            </div>

            <div>
              <div className="text-xs text-muted-foreground mb-1">
                2. Paste the <code className="font-mono">ott$…</code> token from the Windsurf page:
              </div>
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="ott$..."
                className={inputClass}
                autoFocus
                disabled={phase === "submitting" || phase === "done"}
              />
            </div>

            {phase === "done" ? (
              <div className="text-sm text-emerald-700">
                Connected. Closing…
              </div>
            ) : (
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onOpenChange(false)}
                  disabled={phase === "submitting"}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={submitToken}
                  disabled={phase === "submitting" || !token.trim()}
                >
                  {phase === "submitting" ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      Authenticating…
                    </>
                  ) : (
                    "Submit token"
                  )}
                </Button>
              </div>
            )}
          </div>
        ) : null}

        {phase === "error" && (
          <div className="space-y-3">
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm">
              <div className="font-medium text-destructive">{errorMessage}</div>
              {errorDetail && (
                <pre className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground font-mono">
                  {errorDetail}
                </pre>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button type="button" onClick={start}>
                Try again
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
