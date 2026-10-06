import Image from "next/image";

import { BTN_PRIMARY } from "./portal/styles";
import { Button } from "./ui/button";

interface ButtonProps {
  isLoading: boolean;
  className?: string;
  children: React.ReactNode;
  /** Text shown while loading (announced by screen readers). */
  loadingText?: string;
}

const SubmitButton = ({
  isLoading,
  className,
  children,
  loadingText = "Loading...",
}: ButtonProps) => {
  return (
    <Button
      type="submit"
      disabled={isLoading}
      aria-busy={isLoading}
      className={className ?? `${BTN_PRIMARY} w-full`}
    >
      {isLoading ? (
        <span className="flex items-center gap-4">
          <Image
            src="/assets/icons/loader.svg"
            alt=""
            aria-hidden="true"
            width={24}
            height={24}
            className="animate-spin motion-reduce:animate-none"
          />
          {loadingText}
        </span>
      ) : (
        children
      )}
    </Button>
  );
};

export default SubmitButton;
