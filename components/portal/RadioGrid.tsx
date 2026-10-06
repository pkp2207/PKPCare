"use client";

import { Check } from "lucide-react";
import { useRef } from "react";

import { cn } from "@/lib/utils";

import { nextRadioIndex } from "./slots";

export type RadioOption = {
  value: string;
  label: string;
  /** Extra text announced with the option (e.g. "3 times available"). */
  hint?: string;
};

/**
 * Keyboard-operable radio group rendered as a grid of buttons (slots, days,
 * visit type). Follows the WAI-ARIA radio pattern: one tab stop (the checked
 * option, or the first), arrow keys / Home / End move AND select, Space/Enter
 * selects. Targets are at least 44px tall. Selection is shown with a check
 * icon and a thicker border, never colour alone.
 */
export const RadioGrid = ({
  label,
  options,
  value,
  onChange,
  className,
  optionClassName,
  disabled = false,
}: {
  label: string;
  options: readonly RadioOption[];
  value: string | null | undefined;
  onChange: (value: string) => void;
  className?: string;
  optionClassName?: string;
  disabled?: boolean;
}) => {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const tabStop = selectedIndex >= 0 ? selectedIndex : 0;

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextRadioIndex(event.key, index, options.length);
    if (next === null) return;
    event.preventDefault();
    refs.current[next]?.focus();
    onChange(options[next].value);
  };

  return (
    <div role="radiogroup" aria-label={label} className={className}>
      {options.map((option, index) => {
        const checked = index === selectedIndex;
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option.hint ? `${option.label}, ${option.hint}` : undefined}
            tabIndex={index === tabStop ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md border px-3 py-2 text-14-medium transition-colors motion-reduce:transition-none",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-dark-300",
              "disabled:cursor-not-allowed disabled:opacity-50",
              checked
                ? "border-2 border-green-500 bg-green-600 text-white"
                : "border-dark-500 bg-dark-400 text-white hover:border-green-500",
              optionClassName
            )}
          >
            {checked && <Check className="size-4 shrink-0" aria-hidden="true" />}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
};
