import { Plus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  icon: LucideIcon;
  message: string;
  action?: string;
  onAction?: () => void;
}

export function EmptyState({ icon: Icon, message, action, onAction }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="bg-[#FFF8E8] border-[2px] border-[#0d0c10] p-4 mb-4" style={{ boxShadow: "3px 3px 0 0 #0d0c10" }}>
        <Icon className="h-10 w-10 text-[#5a525e]" />
      </div>
      <p className="text-sm font-semibold text-[#5a525e] mb-4">{message}</p>
      {action && onAction && (
        <Button onClick={onAction}>
          <Plus className="h-4 w-4 mr-1.5" />
          {action}
        </Button>
      )}
    </div>
  );
}
