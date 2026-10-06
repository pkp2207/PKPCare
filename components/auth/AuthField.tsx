import Image from "next/image";
import type { InputHTMLAttributes } from "react";

import { Input } from "@/components/ui/input";

type AuthFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & {
  id: string;
  label: string;
  iconSrc?: string;
  invalid?: boolean;
};

// Plain labelled input in the same visual style as CustomFormField (which has no
// `type` prop, so it cannot render password / email inputs).
export const AuthField = ({
  id,
  label,
  iconSrc,
  invalid,
  ...inputProps
}: AuthFieldProps) => (
  <div className="flex flex-col gap-2">
    <label htmlFor={id} className="shad-input-label">
      {label}
    </label>
    <div className="flex rounded-md border border-dark-500 bg-dark-400">
      {iconSrc && (
        <Image
          src={iconSrc}
          height={24}
          width={24}
          alt=""
          aria-hidden="true"
          className="ml-2"
        />
      )}
      <Input
        id={id}
        aria-invalid={invalid || undefined}
        className="shad-input border-0"
        {...inputProps}
      />
    </div>
  </div>
);
