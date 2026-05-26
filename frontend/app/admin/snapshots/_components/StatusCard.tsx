"use client";

/**
 * StatusCard — read-only status card with a deep-link.
 *
 * Used for Skill mapping → /admin/calibration and Compositing → /admin/review.
 */

import Link from "next/link";
import { cn } from "@/lib/utils";

interface StatusCardProps {
  id: string;
  title: string;
  description: string;
  href: string;
  /** Optional badge text to show alongside the title. */
  badge?: React.ReactNode;
}

export function StatusCard({ id, title, description, href, badge }: StatusCardProps) {
  return (
    <article
      id={id}
      className="rounded-[6px] border border-[#d9d0c9] p-6"
      style={{ backgroundColor: "#f7f7f7" }}
    >
      <div id={`${id}-header`} className="flex items-start justify-between gap-2 mb-2">
        <h3 id={`${id}-title`} className="font-semibold text-sm text-[#0e0907]">{title}</h3>
        {badge}
      </div>
      <p id={`${id}-desc`} className="text-xs text-neutral-500 leading-relaxed mb-4">
        {description}
      </p>
      <Link
        id={`${id}-link`}
        href={href}
        className={cn(
          "inline-block text-xs font-medium text-[#a34400] underline-offset-2",
          "hover:underline transition-colors",
        )}
      >
        Open {title} →
      </Link>
    </article>
  );
}
