import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, X, Volume2, VolumeX, Loader2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { voiceApi, type VoiceTurn } from "../api/voice";
import { useCompany } from "../context/CompanyContext";
import { cn } from "../lib/utils";

/**
 * Voice mode — talk to your CEO.
 *
 * Browser does STT (webkitSpeechRecognition) and TTS (speechSynthesis).
 * The server only generates the textual reply. Works in Chrome/Edge today;
 * Safari/Firefox fall back to a typed-only flow.
 */

// SpeechRecognition isn't in the standard lib types yet.
type AnySpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};
type SpeechRecognitionErrorEvent = { error: string; message?: string };

function getSpeechRecognition(): { new (): AnySpeechRecognition } | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: { new (): AnySpeechRecognition };
    webkitSpeechRecognition?: { new (): AnySpeechRecognition };
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function VoiceModeButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-md border-[1.5px] border-[#0d0c10] bg-white hover:bg-[#FFF1B8] px-2 py-1 text-xs font-semibold text-[#0d0c10] transition-colors"
        title="Talk to your CEO"
        aria-label="Open voice mode"
      >
        <Mic className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Talk to CEO</span>
      </button>
      {open && <VoiceModal onClose={() => setOpen(false)} />}
    </>
  );
}

interface VoiceModalProps {
  onClose: () => void;
}

function VoiceModal({ onClose }: VoiceModalProps) {
  const { selectedCompanyId } = useCompany();
  const [turns, setTurns] = useState<VoiceTurn[]>([]);
  const [partial, setPartial] = useState("");
  const [listening, setListening] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [supportsSTT, setSupportsSTT] = useState(true);
  const [typed, setTyped] = useState("");
  const recogRef = useRef<AnySpeechRecognition | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const speak = useCallback(
    (text: string) => {
      if (muted) return;
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    },
    [muted],
  );

  const turnMutation = useMutation({
    mutationFn: async (message: string) => {
      if (!selectedCompanyId) throw new Error("Pick a company first.");
      const history = turns.slice(-20); // keep the server payload light
      return voiceApi.turn(selectedCompanyId, message, history);
    },
    onSuccess: (result) => {
      setTurns((prev) => [...prev, { role: "ceo", text: result.reply }]);
      setWarning(result.source === "template" ? result.warning ?? null : null);
      speak(result.reply);
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Reply failed"),
  });

  // Initialise SpeechRecognition lazily so SSR / non-browsers don't crash.
  useEffect(() => {
    const SR = getSpeechRecognition();
    if (!SR) {
      setSupportsSTT(false);
      return;
    }
    const r = new SR();
    r.continuous = false;
    r.interimResults = true;
    r.lang = "en-US";
    r.onresult = (ev) => {
      let interim = "";
      let final = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const result = ev.results[i];
        if (result.isFinal) final += result[0].transcript;
        else interim += result[0].transcript;
      }
      if (final) {
        setPartial("");
        submit(final.trim());
      } else {
        setPartial(interim);
      }
    };
    r.onerror = (ev) => {
      setError(`Speech recognition: ${ev.error}`);
      setListening(false);
    };
    r.onend = () => setListening(false);
    recogRef.current = r;
    return () => {
      try {
        r.abort();
      } catch {
        /* noop */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns, partial]);

  const submit = useCallback(
    (text: string) => {
      const clean = text.trim();
      if (!clean) return;
      setError(null);
      setTurns((prev) => [...prev, { role: "user", text: clean }]);
      turnMutation.mutate(clean);
    },
    [turnMutation],
  );

  const toggleListen = () => {
    const r = recogRef.current;
    if (!r) return;
    if (listening) {
      try {
        r.stop();
      } catch {
        /* noop */
      }
      setListening(false);
      return;
    }
    setError(null);
    try {
      r.start();
      setListening(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start microphone");
    }
  };

  const onSubmitTyped = (e: React.FormEvent) => {
    e.preventDefault();
    if (!typed.trim()) return;
    submit(typed);
    setTyped("");
  };

  const closeAll = () => {
    try {
      recogRef.current?.abort();
    } catch {
      /* noop */
    }
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* noop */
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={closeAll}>
      <div
        className="stack-card w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="px-4 py-3 flex items-center gap-2 border-b-[1.5px] border-[#0d0c10]"
          style={{ background: "linear-gradient(135deg, #fffaf0 0%, #FFE0BB 100%)" }}
        >
          <Mic className="h-4 w-4 text-[#0d0c10]" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-mono font-bold uppercase tracking-widest text-[#0d0c10]">Talk to CEO</p>
            <p className="text-[10px] text-[#5a525e]">{listening ? "listening…" : turnMutation.isPending ? "thinking…" : "ready"}</p>
          </div>
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            className="p-1.5 rounded hover:bg-[#FFF1B8] text-[#0d0c10]"
            title={muted ? "Unmute reply playback" : "Mute reply playback"}
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={closeAll}
            className="p-1.5 rounded hover:bg-[#FFF1B8] text-[#0d0c10]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 bg-[#fffaf0]">
          {turns.length === 0 && !partial && (
            <p className="text-xs text-[#5a525e] text-center py-6">
              Press the mic and say something — or type in the box below.
            </p>
          )}
          {turns.map((turn, i) => (
            <TurnBubble key={i} turn={turn} />
          ))}
          {partial && <TurnBubble turn={{ role: "user", text: partial + "…" }} muted />}
          {turnMutation.isPending && (
            <div className="flex items-center gap-2 text-xs text-[#5a525e] px-1">
              <Loader2 className="h-3 w-3 animate-spin" /> CEO is thinking…
            </div>
          )}
          {error && <p className="text-xs text-destructive px-1">{error}</p>}
          {warning && (
            <p className="text-[10px] text-amber-700 bg-amber-100/60 border-[1.5px] border-amber-300 rounded-sm px-2 py-1.5 mx-1">
              Falling back to a template reply. {warning}
            </p>
          )}
        </div>

        <div className="border-t-[1.5px] border-[#0d0c10] p-3 space-y-2 bg-white">
          {supportsSTT ? (
            <div className="flex items-center justify-center">
              <button
                type="button"
                onClick={toggleListen}
                disabled={!selectedCompanyId}
                className={cn(
                  "flex items-center justify-center rounded-full h-14 w-14 border-[2px] border-[#0d0c10] transition-colors",
                  listening ? "bg-[#FF4D2E] text-white animate-pulse" : "bg-[#FFC83A] text-[#0d0c10] hover:bg-[#FF4D2E] hover:text-white",
                  !selectedCompanyId && "opacity-50 cursor-not-allowed",
                )}
                aria-label={listening ? "Stop listening" : "Start listening"}
              >
                {listening ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
              </button>
            </div>
          ) : (
            <p className="text-[10px] text-center text-[#5a525e]">
              Your browser doesn't support speech recognition. Type below.
            </p>
          )}
          <form onSubmit={onSubmitTyped} className="flex items-center gap-2">
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="…or type here"
              className="flex-1 rounded-md border-[1.5px] border-[#0d0c10] bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#FFC83A]"
              disabled={!selectedCompanyId || turnMutation.isPending}
            />
            <button
              type="submit"
              disabled={!typed.trim() || !selectedCompanyId || turnMutation.isPending}
              className="rounded-md border-[1.5px] border-[#0d0c10] bg-[#0d0c10] text-white px-3 py-1.5 text-xs font-extrabold hover:bg-[#FF4D2E] disabled:opacity-50"
            >
              send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function TurnBubble({ turn, muted }: { turn: VoiceTurn; muted?: boolean }) {
  const isCeo = turn.role === "ceo";
  return (
    <div className={cn("flex", isCeo ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "max-w-[85%] rounded-md border-[1.5px] border-[#0d0c10] px-2.5 py-1.5 text-xs leading-snug",
          isCeo ? "bg-white text-[#0d0c10]" : "bg-[#FFC83A] text-[#0d0c10]",
          muted && "opacity-60",
        )}
      >
        <p className="font-mono uppercase text-[9px] mb-0.5 text-[#5a525e]">
          {isCeo ? "CEO" : "You"}
        </p>
        <p>{turn.text}</p>
      </div>
    </div>
  );
}
