import Link from "next/link";

import { Button } from "@/components/ui/button";

type ErrorStateProps = {
  title?: string;
  message?: string;
  href?: string;
  linkLabel?: string;
};

/** Friendly full-page error for server pages whose data could not be loaded. */
export const ErrorState = ({
  title = "Something went wrong",
  message = "We couldn't load this page. Please try again.",
  href = "/",
  linkLabel = "Back to home",
}: ErrorStateProps) => {
  return (
    <div
      role="alert"
      className="flex h-screen max-h-screen flex-col items-center justify-center gap-6 px-[5%] text-center"
    >
      <h1 className="header">{title}</h1>
      <p className="text-dark-700">{message}</p>
      <Button variant="outline" className="shad-primary-btn" asChild>
        <Link href={href}>{linkLabel}</Link>
      </Button>
    </div>
  );
};
