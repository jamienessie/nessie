import {
  Inbox,
  CircleDot,
  Target,
  LayoutDashboard,
  DollarSign,
  History,
  Search,
  SquarePen,
  Network,
  Boxes,
  Repeat,
  GitBranch,
  Settings,
  Building2,
  UserPlus,
  Users,
  ShieldCheck,
  Sparkles,
  ScrollText,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { NavLink } from "@/lib/router";
import { SidebarSection } from "./SidebarSection";
import { SidebarNavItem } from "./SidebarNavItem";
import { SidebarProjects } from "./SidebarProjects";
import { SidebarAgents } from "./SidebarAgents";
import { useDialogActions } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import { heartbeatsApi } from "../api/heartbeats";
import { instanceSettingsApi } from "../api/instanceSettings";
import { queryKeys } from "../lib/queryKeys";
import { useInboxBadge } from "../hooks/useInboxBadge";
import { Button } from "@/components/ui/button";
import { PluginSlotOutlet } from "@/plugins/slots";
import { SidebarCompanyMenu } from "./SidebarCompanyMenu";
import { VoiceModeButton } from "./VoiceMode";

export function Sidebar() {
  const { openNewIssue } = useDialogActions();
  const { selectedCompanyId, selectedCompany } = useCompany();
  const inboxBadge = useInboxBadge(selectedCompanyId);
  const { data: experimentalSettings } = useQuery({
    queryKey: queryKeys.instance.experimentalSettings,
    queryFn: () => instanceSettingsApi.getExperimental(),
  });
  const { data: liveRuns } = useQuery({
    queryKey: queryKeys.liveRuns(selectedCompanyId!),
    queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 10_000,
  });
  const liveRunCount = liveRuns?.length ?? 0;
  const showWorkspacesLink = experimentalSettings?.enableIsolatedWorkspaces === true;

  const pluginContext = {
    companyId: selectedCompanyId,
    companyPrefix: selectedCompany?.issuePrefix ?? null,
  };

  return (
    <aside className="w-full h-full min-h-0 border-r-[2px] border-[#0d0c10] bg-[#fffaf0] flex flex-col p-3 gap-2.5">
      {/* Company switcher chunky card */}
      <div className="stack-card p-2.5 flex items-center gap-2.5 cursor-pointer">
        <div
          className="w-[30px] h-[30px] shrink-0 border-[2px] border-[#0d0c10]"
          style={{
            background: "conic-gradient(from 200deg, #FF4D2E, #FFC83A, #27D17F, #1FA7FF, #7C5CFF, #FF3FA4, #FF4D2E)",
          }}
        />
        <div className="flex-1 min-w-0 text-left">
          <div className="font-extrabold text-sm tracking-tight leading-tight truncate">
            {selectedCompany?.name ?? "Nessie"}
          </div>
          <div className="font-mono text-[9.5px] text-[#5a525e] tracking-wider font-bold">
            {selectedCompany?.issuePrefix ? `${selectedCompany.issuePrefix} · ` : ""}
            {liveRunCount} agents live
          </div>
        </div>
        <SidebarCompanyMenu />
        <Button
          asChild
          variant="ghost"
          size="icon-sm"
          className="text-[#5a525e] shrink-0 h-7 w-7"
          aria-label="Search"
          title="Search"
        >
          <NavLink to="/search">
            <Search className="h-4 w-4" />
          </NavLink>
        </Button>
      </div>

      {/* New issue button */}
      <button
        onClick={() => openNewIssue()}
        className="flex items-center gap-2 px-3 py-2 bg-[#0d0c10] text-[#fffaf0] border-[2px] border-[#0d0c10] font-bold text-[13px] tracking-tight"
        style={{ boxShadow: "4px 4px 0 0 #FF4D2E" }}
      >
        <span className="w-3.5 h-3.5 bg-[#FF4D2E] border-[1.5px] border-[#fffaf0] shrink-0" />
        <span className="truncate">New issue</span>
        <span className="flex-1" />
        <span className="font-mono text-[9.5px] text-[#888] border border-[#444] px-1">C</span>
      </button>

      {/* Voice mode — opens an in-app mic modal to talk to the CEO. */}
      <VoiceModeButton />

      <nav className="flex-1 min-h-0 overflow-y-auto scrollbar-auto-hide flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <SidebarNavItem to="/dashboard" label="Dashboard" swatchColor="#FF4D2E" liveCount={liveRunCount} />
          <SidebarNavItem
            to="/inbox"
            label="Inbox"
            swatchColor="#FF8A1A"
            badge={inboxBadge.inbox}
            badgeTone={inboxBadge.failedRuns > 0 ? "danger" : "default"}
            alert={inboxBadge.failedRuns > 0}
          />
          <PluginSlotOutlet
            slotTypes={["sidebar"]}
            context={pluginContext}
            className="flex flex-col gap-0.5"
            itemClassName="text-[13px] font-medium"
            missingBehavior="placeholder"
          />
        </div>

        <SidebarSection label="WORK">
          <SidebarNavItem to="/issues" label="Issues" swatchColor="#FFC83A" />
          <SidebarNavItem to="/issues/mine" label="My issues" swatchColor="#FFC83A" />
          <SidebarNavItem to="/routines" label="Routines" swatchColor="#27D17F" />
          <SidebarNavItem to="/goals" label="Goals" swatchColor="#1FA7FF" />
          {showWorkspacesLink ? (
            <SidebarNavItem to="/workspaces" label="Workspaces" swatchColor="#7C5CFF" />
          ) : null}
        </SidebarSection>

        <SidebarProjects />

        <SidebarAgents />

        <SidebarSection label="AGENTS">
          <SidebarNavItem to="/org" label="Org chart" swatchColor="#7C5CFF" />
          <SidebarNavItem to="/departments" label="Departments" swatchColor="#FF3FA4" />
          <SidebarNavItem to="/skills" label="Skills" swatchColor="#00C2B5" />
          <SidebarNavItem to="/activity" label="Activity" swatchColor="#A4D81F" />
        </SidebarSection>

        <SidebarSection label="OPERATOR">
          <SidebarNavItem to="/chief-of-staff" label="Chief of Staff" swatchColor="#FF6B9A" />
          <SidebarNavItem to="/briefs" label="Briefs" swatchColor="#FFB400" />
          <SidebarNavItem to="/dreams" label="Dream Journal" swatchColor="#7C5CFF" />
          <SidebarNavItem to="/companies/generate" label="Generate Company" swatchColor="#FFC83A" />
          <SidebarNavItem to="/clipmart" label="ClipMart" swatchColor="#1FA7FF" />
          <SidebarNavItem to="/plug-in-janitor" label="Plug-In Janitor" swatchColor="#FFA94D" />
          <SidebarNavItem to="/hiring" label="Hiring" swatchColor="#5B8DEF" />
          <SidebarNavItem to="/meetings" label="Meetings" swatchColor="#B872FF" />
          <SidebarNavItem to="/trust-layer" label="Trust Layer" swatchColor="#22C2A4" />
        </SidebarSection>

        <PluginSlotOutlet
          slotTypes={["sidebarPanel"]}
          context={pluginContext}
          className="flex flex-col gap-3"
          itemClassName="rounded-lg border border-border p-3"
          missingBehavior="placeholder"
        />
      </nav>
    </aside>
  );
}
