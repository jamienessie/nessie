import { useMemo, useState } from "react";
import { CheckCircle2, LogIn } from "lucide-react";
import type { EnvBinding } from "@nessie/shared";
import type { AdapterConfigFieldsProps } from "../types";
import { Field } from "../../components/agent-config-primitives";
import { Button } from "../../components/ui/button";
import { useCompany } from "../../context/CompanyContext";
import { SchemaConfigFields } from "../schema-config-fields";
import { WindsurfSignInModal } from "./WindsurfSignInModal";

const SECRET_ENV_KEY = "WINDSURF_API_KEY";

function readWindsurfSecretBinding(
  env: Record<string, EnvBinding> | undefined,
): { secretId: string } | null {
  const binding = env?.[SECRET_ENV_KEY];
  if (binding && typeof binding === "object" && binding.type === "secret_ref") {
    return { secretId: binding.secretId };
  }
  return null;
}

export function WindsurfLocalConfigFields(props: AdapterConfigFieldsProps) {
  const { isCreate, values, set, config, eff, mark } = props;
  const { selectedCompanyId } = useCompany();
  const [modalOpen, setModalOpen] = useState(false);

  const currentEnv = useMemo<Record<string, EnvBinding>>(() => {
    if (isCreate) {
      return (values?.envBindings ?? {}) as Record<string, EnvBinding>;
    }
    return eff(
      "adapterConfig",
      "env",
      (config.env ?? {}) as Record<string, EnvBinding>,
    );
  }, [isCreate, values, config, eff]);

  const connection = readWindsurfSecretBinding(currentEnv);

  const writeSecretRef = (secretId: string) => {
    const ref: EnvBinding = { type: "secret_ref", secretId, version: "latest" };
    const nextEnv: Record<string, EnvBinding> = { ...currentEnv, [SECRET_ENV_KEY]: ref };
    if (isCreate) {
      set!({ envBindings: nextEnv, envVars: "" });
    } else {
      mark("adapterConfig", "env", nextEnv);
    }
  };

  return (
    <>
      <Field
        label="Windsurf sign-in"
        hint="Drives Devin's manual sign-in flow and stores the token as a Nessie secret bound to WINDSURF_API_KEY. Without this the adapter falls back to whatever `devin auth status` reports."
      >
        <div className="flex items-center gap-2 flex-wrap">
          {connection ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-600/40 bg-emerald-600/10 px-2 py-1 text-xs text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Connected (secret: <code className="font-mono">{SECRET_ENV_KEY}</code>)
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              Not connected — run sign-in to populate Devin's local auth and bind a secret.
            </span>
          )}
          <Button
            type="button"
            size="sm"
            variant={connection ? "outline" : "default"}
            onClick={() => setModalOpen(true)}
            disabled={!selectedCompanyId}
          >
            <LogIn className="h-3.5 w-3.5 mr-1" />
            {connection ? "Re-sign in to Windsurf" : "Sign in to Windsurf"}
          </Button>
        </div>
      </Field>

      <SchemaConfigFields {...props} />

      <WindsurfSignInModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        companyId={selectedCompanyId}
        onConnected={({ secretId }) => writeSecretRef(secretId)}
      />
    </>
  );
}
