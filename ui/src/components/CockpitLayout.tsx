import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Outlet, useLocation, useNavigate, useParams } from "@/lib/router";
import { Rail } from "./cockpit/Rail";
import { Topbar } from "./cockpit/Topbar";
import "./cockpit/tokens.css";
import { CommandPalette } from "./CommandPalette";
import { NewIssueDialog } from "./NewIssueDialog";
import { NewProjectDialog } from "./NewProjectDialog";
import { NewGoalDialog } from "./NewGoalDialog";
import { NewAgentDialog } from "./NewAgentDialog";
import { KeyboardShortcutsCheatsheet } from "./KeyboardShortcutsCheatsheet";
import { ToastViewport } from "./ToastViewport";
import { GeneralSettingsProvider } from "../context/GeneralSettingsContext";
import { useCompany } from "../context/CompanyContext";
import { useDialogActions } from "../context/DialogContext";
import { healthApi } from "../api/health";
import { instanceSettingsApi } from "../api/instanceSettings";
import { shouldSyncCompanySelectionFromRoute } from "../lib/company-selection";
import { queryKeys } from "../lib/queryKeys";
import { NotFoundPage } from "../pages/NotFound";

// Phase 10 — universal cockpit chrome wrapper. Replaces the legacy
// <Layout> for every route in App.tsx that previously used it.
//
// Preserves the load-bearing behaviours from Layout:
//   - companyPrefix → CompanyContext sync (so company-scoped legacy
//     pages keep resolving the active company from the URL)
//   - OnboardingWizard auto-open when no companies exist
//   - mounts the global dialogs (CommandPalette, NewIssueDialog, etc.)
//     and ToastViewport so they're available on every page
//
// Drops the legacy chrome bits (Sidebar, BreadcrumbBar, PropertiesPanel,
// MobileBottomNav, WorktreeBanner, DevRestartBanner). The cockpit Rail
// and Topbar are the only chrome. Legacy page bodies render unchanged
// inside <main className="cockpit-main">.

export function CockpitLayout() {
  const { openOnboarding } = useDialogActions();
  const {
    companies,
    loading: companiesLoading,
    selectedCompany,
    selectedCompanyId,
    selectionSource,
    setSelectedCompanyId,
  } = useCompany();
  const { companyPrefix } = useParams<{ companyPrefix: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const onboardingTriggered = useRef(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const matchedCompany = useMemo(() => {
    if (!companyPrefix) return null;
    const requestedPrefix = companyPrefix.toUpperCase();
    return companies.find((company) => company.issuePrefix.toUpperCase() === requestedPrefix) ?? null;
  }, [companies, companyPrefix]);
  const hasUnknownCompanyPrefix =
    Boolean(companyPrefix) && !companiesLoading && companies.length > 0 && !matchedCompany;

  const { data: health } = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => healthApi.get(),
    retry: false,
  });
  const keyboardShortcutsEnabled = useQuery({
    queryKey: queryKeys.instance.generalSettings,
    queryFn: () => instanceSettingsApi.getGeneral(),
  }).data?.keyboardShortcuts === true;

  // Auto-open the OnboardingWizard if the operator has no companies.
  useEffect(() => {
    if (companiesLoading || onboardingTriggered.current) return;
    if (health?.deploymentMode === "authenticated") return;
    if (companies.length === 0) {
      onboardingTriggered.current = true;
      openOnboarding();
    }
  }, [companies, companiesLoading, openOnboarding, health?.deploymentMode]);

  // Company-prefix → CompanyContext sync.
  useEffect(() => {
    if (!companyPrefix || companiesLoading || companies.length === 0) return;
    if (!matchedCompany) {
      const fallback = (selectedCompanyId ? companies.find((c) => c.id === selectedCompanyId) : null)
        ?? companies[0] ?? null;
      if (fallback && selectedCompanyId !== fallback.id) {
        setSelectedCompanyId(fallback.id, { source: "route_sync" });
      }
      return;
    }
    if (companyPrefix !== matchedCompany.issuePrefix) {
      const suffix = location.pathname.replace(/^\/[^/]+/, "");
      navigate(`/${matchedCompany.issuePrefix}${suffix}${location.search}`, { replace: true });
      return;
    }
    if (shouldSyncCompanySelectionFromRoute({
      selectionSource,
      selectedCompanyId,
      routeCompanyId: matchedCompany.id,
    })) {
      setSelectedCompanyId(matchedCompany.id, { source: "route_sync" });
    }
  }, [
    companyPrefix,
    companies,
    companiesLoading,
    matchedCompany,
    selectedCompanyId,
    selectionSource,
    setSelectedCompanyId,
    navigate,
    location.pathname,
    location.search,
  ]);

  return (
    <GeneralSettingsProvider value={{ keyboardShortcutsEnabled }}>
      <div className="cockpit-root" style={{ minHeight: "100vh" }}>
        <div className="cockpit-app">
          <Rail />
          <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
            <Topbar label="WORKSPACE" />
            <main id="main-content" tabIndex={-1} className="cockpit-main" style={{ outline: "none", flex: 1 }}>
              {hasUnknownCompanyPrefix ? (
                <NotFoundPage scope="invalid_company_prefix" requestedPrefix={companyPrefix ?? selectedCompany?.issuePrefix} />
              ) : (
                <Outlet />
              )}
            </main>
          </div>
        </div>
        <CommandPalette />
        <NewIssueDialog />
        <NewProjectDialog />
        <NewGoalDialog />
        <NewAgentDialog />
        <KeyboardShortcutsCheatsheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
        <ToastViewport />
      </div>
    </GeneralSettingsProvider>
  );
}
