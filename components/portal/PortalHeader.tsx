import Image from "next/image";
import Link from "next/link";

import { cn } from "@/lib/utils";

import { SignOutButton } from "./SignOutButton";

type PortalSection = "dashboard" | "new-appointment" | "privacy";

const LINK_CLASS =
  "inline-flex min-h-11 items-center rounded-md px-3 text-14-medium text-dark-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500";

/**
 * Shared top bar for the patient portal: skip link, logo, section navigation and
 * sign-out. `minimal` (used before registration is complete) hides the section
 * links, which would only bounce back to the registration form.
 */
export const PortalHeader = ({
  userId,
  enforced,
  current,
  minimal = false,
}: {
  userId: string;
  enforced: boolean;
  current?: PortalSection;
  minimal?: boolean;
}) => {
  const base = `/patients/${encodeURIComponent(userId)}`;
  const links: { key: PortalSection; href: string; label: string }[] = [
    { key: "dashboard", href: base, label: "My appointments" },
    { key: "new-appointment", href: `${base}/new-appointment`, label: "New appointment" },
    { key: "privacy", href: `${base}/privacy`, label: "Privacy" },
  ];

  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-dark-500 pb-4">
      <a
        href="#main"
        className="sr-only rounded-md bg-green-500 px-4 py-2 text-white focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
      >
        Skip to main content
      </a>

      <Link
        href="/"
        className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
      >
        <Image
          src="/assets/icons/logo-full-pkp.png"
          height={48}
          width={140}
          alt="PKPCare home"
          className="h-10 w-auto"
        />
      </Link>

      <div className="flex flex-wrap items-center gap-1">
        {!minimal && (
          <nav aria-label="Patient portal">
            <ul className="flex flex-wrap items-center gap-1">
              {links.map((link) => (
                <li key={link.key}>
                  <Link
                    href={link.href}
                    aria-current={current === link.key ? "page" : undefined}
                    className={cn(
                      LINK_CLASS,
                      current === link.key && "bg-dark-400 text-white"
                    )}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
        {enforced ? (
          <SignOutButton />
        ) : (
          <Link href="/" className={LINK_CLASS}>
            Exit
          </Link>
        )}
      </div>
    </header>
  );
};
