import { NavLink } from "@/lib/router";
import { SIDEBAR_SCROLL_RESET_STATE } from "../lib/navigation-scroll";
import { cn } from "../lib/utils";
import { useSidebar } from "../context/SidebarContext";
import type { LucideIcon } from "lucide-react";

interface SidebarNavItemProps {
  to: string;
  label: string;
  icon?: LucideIcon;
  swatchColor?: string;
  end?: boolean;
  className?: string;
  badge?: number;
  badgeTone?: "default" | "danger";
  textBadge?: string;
  textBadgeTone?: "default" | "amber";
  alert?: boolean;
  liveCount?: number;
}

export function SidebarNavItem({
  to,
  label,
  icon: Icon,
  swatchColor,
  end,
  className,
  badge,
  badgeTone = "default",
  textBadge,
  textBadgeTone = "default",
  alert = false,
  liveCount,
}: SidebarNavItemProps) {
  const { isMobile, setSidebarOpen } = useSidebar();

  return (
    <NavLink
      to={to}
      state={SIDEBAR_SCROLL_RESET_STATE}
      end={end}
      onClick={() => { if (isMobile) setSidebarOpen(false); }}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-2.5 px-3 py-[6px] text-[13.5px] transition-all",
          isActive ? "stack-nav-active" : "stack-nav-idle text-[#0d0c10] hover:bg-[#FFF1B8]/40",
          className,
        )
      }
    >
      {swatchColor ? (
        <span
          className="relative shrink-0 w-3.5 h-3.5 border-[1.5px] border-[#0d0c10]"
          style={{ background: swatchColor }}
        />
      ) : Icon ? (
        <span className="relative shrink-0">
          <Icon className="h-4 w-4" />
          {alert && (
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 bg-[#FF4D2E] border border-[#fffaf0]" />
          )}
        </span>
      ) : null}
      <span className="flex-1 truncate font-semibold">{label}</span>
      {textBadge && (
        <span
          className={cn(
            "ml-auto px-1.5 py-0.5 text-[10px] font-extrabold leading-none border-[1.5px] border-[#0d0c10]",
            textBadgeTone === "amber"
              ? "bg-[#FFC83A] text-[#0d0c10]"
              : "bg-[#0d0c10] text-[#fffaf0]",
          )}
        >
          {textBadge}
        </span>
      )}
      {liveCount != null && liveCount > 0 && (
        <span className="ml-auto flex items-center gap-1.5">
          <span className="w-2 h-2 bg-[#27D17F] border border-[#0d0c10] stack-pulse" />
          <span className="text-[10px] font-extrabold text-[#0d0c10] bg-[#27D17F] px-1.5 py-0.5 border-[1.5px] border-[#0d0c10]">
            {liveCount} LIVE
          </span>
        </span>
      )}
      {badge != null && badge > 0 && (
        <span
          className={cn(
            "ml-auto px-1.5 py-0.5 text-[10px] font-extrabold leading-none",
            badgeTone === "danger"
              ? "bg-[#FF4D2E] text-[#fffaf0] border-[1.5px] border-[#0d0c10]"
              : "bg-[#0d0c10] text-[#fffaf0]",
          )}
        >
          {badge}
        </span>
      )}
    </NavLink>
  );
}
