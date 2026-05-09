import { useEffect } from "react";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { ChiefDashboardPane } from "./chief-of-staff/ChiefDashboardPane";
import { ChiefTranscriptPane } from "./chief-of-staff/ChiefTranscriptPane";
import { Sparkles } from "lucide-react";

export function ChiefOfStaff() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Chief of Staff" }]);
  }, [setBreadcrumbs]);

  if (!selectedCompanyId) {
    return (
      <EmptyState
        icon={Sparkles}
        message="Select a company first."
      />
    );
  }

  return (
    <div className="flex h-[calc(100vh-3rem)] min-h-0 overflow-hidden">
      {/* Left pane: always-on dashboard */}
      <div className="w-2/5 min-w-[320px] max-w-[520px] min-h-0 overflow-hidden border-r border-border">
        <ChiefDashboardPane companyId={selectedCompanyId} />
      </div>
      {/* Right pane: ask/answer transcript */}
      <div className="flex-1 min-w-0 min-h-0">
        <ChiefTranscriptPane companyId={selectedCompanyId} />
      </div>
    </div>
  );
}
