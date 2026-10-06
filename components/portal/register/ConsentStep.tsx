"use client";

import Link from "next/link";
import { Control } from "react-hook-form";

import { Checkbox } from "@/components/ui/checkbox";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";

import { CONSENT_COPY, PRIVACY_PAGE_PATH } from "../consent-copy";

/** Three separate, unticked consents in plain language. */
export const ConsentStep = ({ control }: { control: Control<any> }) => (
  <div className="space-y-5">
    <p className="text-14-regular text-dark-700">
      Please read each choice. You need to agree to all three to create your profile, and you can
      withdraw any of them later under &ldquo;Privacy and data&rdquo;. Read the full{" "}
      <Link
        href={PRIVACY_PAGE_PATH}
        target="_blank"
        rel="noopener noreferrer"
        className="text-green-500 underline underline-offset-2"
      >
        privacy notice (opens in a new tab)
      </Link>
      .
    </p>

    {CONSENT_COPY.map((consent) => (
      <FormField
        key={consent.field}
        control={control}
        name={consent.field}
        render={({ field }) => (
          <FormItem className="rounded-xl border border-dark-500 bg-dark-400 p-4">
            <div className="flex items-start gap-4">
              <FormControl>
                <Checkbox
                  id={consent.field}
                  checked={!!field.value}
                  onCheckedChange={field.onChange}
                  className="mt-1 size-6"
                />
              </FormControl>
              <div className="min-h-11 space-y-1">
                <label htmlFor={consent.field} className="text-16-semibold block cursor-pointer text-white">
                  {consent.title}
                </label>
                <FormDescription className="text-14-regular !text-dark-700">
                  {consent.statement}
                </FormDescription>
              </div>
            </div>
            <FormMessage className="shad-error" />
          </FormItem>
        )}
      />
    ))}
  </div>
);
