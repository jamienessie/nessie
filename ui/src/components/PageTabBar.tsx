import type { ReactNode } from "react";
import { useSidebar } from "../context/SidebarContext";

export interface PageTabItem {
  value: string;
  label: ReactNode;
}

interface PageTabBarProps {
  items: PageTabItem[];
  value?: string;
  onValueChange?: (value: string) => void;
  align?: "center" | "start";
}

export function PageTabBar({ items, value, onValueChange, align = "center" }: PageTabBarProps) {
  const { isMobile } = useSidebar();

  if (isMobile && value !== undefined && onValueChange) {
    return (
      <select
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        className="h-9 border-[2px] border-[#0d0c10] bg-[#fffaf0] px-2 py-1 text-base focus:outline-none focus:ring-1 focus:ring-[#0d0c10]"
        style={{ boxShadow: "3px 3px 0 0 #0d0c10" }}
      >
        {items.map((item) => (
          <option key={item.value} value={item.value}>
            {typeof item.label === "string" ? item.label : item.value}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className={`inline-flex items-center border-[2px] border-[#0d0c10] bg-[#fffaf0] ${align === "start" ? "justify-start" : ""}`} style={{ boxShadow: "3px 3px 0 0 #0d0c10" }}>
      {items.map((item, i) => {
        const isActive = value === item.value;
        return (
          <button
            key={item.value}
            onClick={() => onValueChange?.(item.value)}
            className={`px-3 py-1.5 text-[13px] font-bold transition-all ${
              isActive
                ? "bg-[#FFF1B8] text-[#0d0c10]"
                : "text-[#5a525e] hover:bg-[#FFF8E8]"
            } ${i > 0 ? "border-l-[2px] border-[#0d0c10]" : ""}`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
