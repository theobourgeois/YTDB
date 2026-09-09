"use client";

import { cn } from "@/lib/utils";

type Props<T extends string> = {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
};

/** The small segmented control used to switch what a view is showing. */
export function PaneToggle<T extends string>({ value, options, onChange, label }: Props<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex h-7 items-center rounded-md border bg-muted/50 p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-full rounded-sm px-2 text-xs transition-colors",
            option.value === value
              ? "bg-background text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
