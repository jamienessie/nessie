// @nessie/proxy — public surface.

export {
  startNessieProxy,
  NESSIE_PROXY_DEFAULT_HOST,
  NESSIE_PROXY_DEFAULT_PORT,
  type ProxyHandle,
  type CreateProxyInput,
} from "./server.js";

export { startHealthMonitor, type HealthMonitor, getLatestHealth } from "./health.js";
export { resolveTosAwareness, tosAllowsAutomatedT1 } from "./tos-dial.js";
export {
  NESSIE_TIER_HEADER,
  NESSIE_AGENT_HEADER,
  NESSIE_HEARTBEAT_HEADER,
  NESSIE_COMPANY_HEADER,
  type Tier,
  type TosAwareness,
  type CredentialView,
  type CredentialStatus,
  type CredentialHealthStatus,
  type ProviderTarget,
} from "./types.js";
