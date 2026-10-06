import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

import { WIZARD_STEPS } from "../wizard";

/** Step indicator: a labelled ordered list, current step marked aria-current. */
export const WizardProgress = ({ current }: { current: number }) => (
  <nav aria-label="Registration progress">
    <p className="text-14-medium mb-3 text-dark-700">
      Step {current + 1} of {WIZARD_STEPS.length}: {WIZARD_STEPS[current].title}
    </p>
    <ol className="flex gap-2">
      {WIZARD_STEPS.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li
            key={step.id}
            aria-current={active ? "step" : undefined}
            className="flex min-w-0 flex-1 flex-col gap-2"
          >
            <span
              className={cn(
                "h-1.5 rounded-full",
                done || active ? "bg-green-500" : "bg-dark-500"
              )}
              aria-hidden="true"
            />
            <span
              className={cn(
                "flex items-center gap-1 truncate text-12-semibold",
                active ? "text-white" : "text-dark-700"
              )}
            >
              {done && <Check className="size-3 shrink-0" aria-hidden="true" />}
              <span className="hidden sm:inline">{step.title}</span>
              <span className="sr-only sm:hidden">
                {step.title}
                {done ? " (completed)" : active ? " (current)" : ""}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  </nav>
);
