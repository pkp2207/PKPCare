"use client";

import { Button } from "@/components/ui/button";

import { BTN_SECONDARY } from "../styles";
import { FIELD_LABELS, maskValue, WIZARD_STEPS } from "../wizard";

const MASKED = new Set(["insurancePolicyNumber", "identificationNumber"]);

const display = (field: string, value: unknown): string => {
  if (field === "identificationDocument") {
    const file = Array.isArray(value) ? (value[0] as File | undefined) : undefined;
    return file ? file.name : "";
  }
  if (field === "birthDate") {
    const date = value instanceof Date ? value : new Date(String(value ?? ""));
    return Number.isNaN(date.getTime())
      ? ""
      : date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  }
  if (typeof value === "boolean") return value ? "Agreed" : "Not agreed";
  const text = String(value ?? "").trim();
  return MASKED.has(field) ? maskValue(text) : text;
};

/** Read-only summary with an Edit button per section. */
export const ReviewStep = ({
  values,
  onEdit,
}: {
  values: Record<string, unknown>;
  onEdit: (stepIndex: number) => void;
}) => (
  <div className="space-y-8">
    {WIZARD_STEPS.filter((step) => step.fields.length > 0).map((step) => {
      const index = WIZARD_STEPS.findIndex((s) => s.id === step.id);
      return (
        <section
          key={step.id}
          aria-labelledby={`review-${step.id}`}
          className="space-y-3 rounded-xl border border-dark-500 bg-dark-400 p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <h3 id={`review-${step.id}`} className="text-16-semibold text-white">
              {step.title}
            </h3>
            <Button
              type="button"
              className={BTN_SECONDARY}
              onClick={() => onEdit(index)}
              aria-label={`Edit ${step.title}`}
            >
              Edit
            </Button>
          </div>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {step.fields.map((field) => (
              <div key={field} className="min-w-0">
                <dt className="text-12-regular text-dark-700">{FIELD_LABELS[field] ?? field}</dt>
                <dd className="text-14-medium break-words text-white">
                  {display(field, values[field]) || (
                    <span className="text-dark-700">Not provided</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      );
    })}
  </div>
);
