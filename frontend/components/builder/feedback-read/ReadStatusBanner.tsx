import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { BuilderReadLabel } from "./BuilderReadSection";

interface ReadStatusBannerAction {
  id: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  tone?: "primary" | "secondary";
}

interface ReadStatusBannerProps {
  idBase: string;
  label: string;
  copy: string;
  action?: ReadStatusBannerAction;
  children?: ReactNode;
}

export function ReadStatusBanner({ idBase, label, copy, action, children }: ReadStatusBannerProps) {
  return (
    <section id={idBase} className="border border-[#d9d0c9]/70 bg-[#f0f0f0]/45 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <BuilderReadLabel id={`${idBase}-label`}>{label}</BuilderReadLabel>
          <p id={`${idBase}-copy`} className="mt-2 text-[0.75rem] leading-snug text-[#0e0907]/55">
            {copy}
          </p>
          {children}
        </div>
        {action && (
          <button
            id={action.id}
            type="button"
            disabled={action.disabled}
            title={action.title}
            onClick={action.onClick}
            className={cn(
              "shrink-0 border px-2.5 py-1.5 text-[0.6875rem] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45",
              action.tone === "primary"
                ? "border-[#ffa05c]/50 bg-[#ffa05c]/20 text-[#0e0907] hover:bg-[#ffa05c]/35"
                : "border-[#d9d0c9] text-[#a34400] hover:border-[#ffa05c]/70 hover:bg-[#ffa05c]/10",
            )}
          >
            {action.label}
          </button>
        )}
      </div>
    </section>
  );
}
