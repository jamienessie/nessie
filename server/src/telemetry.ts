// Nessie ships with telemetry permanently disabled. Nothing leaves the machine.
// We keep the export shape so existing callers compile, but every operation is
// a no-op. Do not re-enable.

import type { TelemetryClient } from "@nessie/shared/telemetry";

export function initTelemetry(_fileConfig?: { enabled?: boolean }): TelemetryClient | null {
  return null;
}

export function getTelemetryClient(): TelemetryClient | null {
  return null;
}
