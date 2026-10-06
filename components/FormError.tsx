import { cn } from "@/lib/utils";

type FormErrorProps = {
  message?: string | null;
  className?: string;
  /** Lets an input point at the message with aria-describedby. */
  id?: string;
};

/**
 * Inline, accessible error for server/action failures. Renders nothing when
 * there is no message so it can sit permanently in a form layout.
 */
export const FormError = ({ message, className, id }: FormErrorProps) => {
  if (!message) return null;

  return (
    <p id={id} role="alert" className={cn("shad-error text-14-regular", className)}>
      {message}
    </p>
  );
};
