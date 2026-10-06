"use client";

import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

export const OtpCodeField = ({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) => (
  <div className="flex flex-col gap-2">
    <label htmlFor={id} className="shad-input-label">
      {label}
    </label>
    <InputOTP
      id={id}
      maxLength={6}
      value={value}
      onChange={onChange}
      disabled={disabled}
      inputMode="numeric"
      autoComplete="one-time-code"
      autoFocus
    >
      <InputOTPGroup className="shad-otp">
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <InputOTPSlot key={index} className="shad-otp-slot" index={index} />
        ))}
      </InputOTPGroup>
    </InputOTP>
  </div>
);
