"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface InfoButtonProps {
  title: string;
  description: string;
}

export function InfoButton({ title, description }: InfoButtonProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, close]);

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Info: ${title}`}
        className="border-border text-muted-foreground hover:border-foreground hover:text-foreground focus-visible:ring-ring ml-2 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border text-[11px] font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        i
      </button>
      {open && (
        <div className="border-border bg-popover text-popover-foreground absolute top-7 left-0 z-50 w-72 rounded-xl border p-3 shadow-xl sm:w-80">
          <p className="mb-1 text-xs font-semibold">{title}</p>
          <p className="text-muted-foreground text-[11px] leading-relaxed">
            {description}
          </p>
        </div>
      )}
    </div>
  );
}

interface SectionHeaderProps {
  title: string;
  info: string;
  subtitle?: string;
  className?: string;
}

export function SectionHeader({
  title,
  info,
  subtitle,
  className,
}: SectionHeaderProps) {
  return (
    <div className={className}>
      <div className="flex items-center">
        <h2 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
          {title}
        </h2>
        <InfoButton title={title} description={info} />
      </div>
      {subtitle && (
        <p className="text-muted-foreground mt-1 text-[11px]">{subtitle}</p>
      )}
    </div>
  );
}
