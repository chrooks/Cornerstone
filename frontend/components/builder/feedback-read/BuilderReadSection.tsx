import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function BuilderReadLabel({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="text-[0.625rem] font-semibold uppercase tracking-[0.18em] text-[#0e0907]/40">
      {children}
    </p>
  );
}

interface BuilderReadSectionProps {
  idBase: string;
  label: string;
  count?: string | number | null;
  className?: string;
  headerClassName?: string;
  children: ReactNode;
}

export function BuilderReadSection({
  idBase,
  label,
  count,
  className,
  headerClassName,
  children,
}: BuilderReadSectionProps) {
  return (
    <section id={idBase} className={cn("border border-[#d9d0c9]/70 bg-[#f7f7f7] px-3 py-3", className)}>
      <div id={`${idBase}-header`} className={cn("flex items-center justify-between gap-3", headerClassName)}>
        <BuilderReadLabel id={`${idBase}-label`}>{label}</BuilderReadLabel>
        {count != null && (
          <span id={`${idBase}-count`} className="font-mono text-[0.625rem] tabular-nums text-[#0e0907]/35">
            {count}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}
