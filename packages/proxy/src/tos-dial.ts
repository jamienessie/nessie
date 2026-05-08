import type { TosAwareness } from "./types.js";

// The TOS-Awareness Dial controls how aggressively the proxy will use T1
// (subscription) credentials. T1 auth is typically a session cookie scraped
// from a logged-in browser; most providers' TOS prohibits unattended headless
// use, so Nessie ships Conservative by default.
//
//   Conservative — T1 calls only fire when an operator explicitly clicks
//                  "use subscription" on the run. Heartbeat-driven runs and
//                  any automation route to T2/T3 even if T1 is healthy.
//   Standard     — T1 wakes on real triggers (assignment, review-requested,
//                  scheduled standup, @mention). Backoff on first 429.
//   Aggressive   — Anything wakes T1. Highest provider-flag risk.
//
// The setting is loaded from instance_settings; an env-var override lets
// CI / dev workflows force Conservative without DB writes.
//
// Returns the effective dial setting for this process. Reads:
//   1. process.env.NESSIE_TOS_AWARENESS (Conservative|Standard|Aggressive)
//   2. (later) instance_settings table key 'tos_awareness'
//   3. fallback: Conservative

const VALID = new Set<TosAwareness>(["Conservative", "Standard", "Aggressive"]);

export function resolveTosAwareness(
  env: NodeJS.ProcessEnv = process.env,
): TosAwareness {
  const raw = env.NESSIE_TOS_AWARENESS?.trim() as TosAwareness | undefined;
  if (raw && VALID.has(raw)) return raw;
  return "Conservative";
}

// Whether the dial allows automated (non-operator-clicked) T1 use.
export function tosAllowsAutomatedT1(dial: TosAwareness): boolean {
  return dial !== "Conservative";
}
