import Image from "next/image";
import Link from "next/link";

import type { StaffSession } from "@/lib/auth/admin";

import { AdminNav } from "./AdminNav";
import { ROLE_LABELS } from "./nav";
import { SignOutButton } from "./SignOutButton";

/**
 * Landmarks: skip link, banner (header), navigation, main. The skip link is
 * the first focusable element and jumps to #main-content.
 */
export function AdminShell({
  session,
  children,
}: {
  session: StaffSession;
  children: React.ReactNode;
}) {
  const who = session.name ?? session.email ?? "Legacy passkey session";

  return (
    <div className="mx-auto flex max-w-7xl flex-col">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-green-500 px-4 py-2 font-semibold text-black focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
      >
        Skip to main content
      </a>

      <header className="sticky top-3 z-20 mx-3 mb-6 rounded-2xl bg-dark-200 px-[5%] py-4 shadow-lg xl:px-12">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link href="/" aria-label="PKPCare home">
            <Image
              src="/assets/icons/logo-full-pkp.png"
              height={32}
              width={162}
              alt="PKPCare"
              className="h-10 w-fit"
            />
          </Link>
          <div className="flex items-center gap-3">
            <p className="text-14-regular text-dark-700">
              <span className="sr-only">Signed in as </span>
              <span className="text-light-200">{who}</span>
            </p>
            <span className="text-12-semibold rounded-full border border-dark-500 px-3 py-1 text-light-200">
              {ROLE_LABELS[session.role]}
            </span>
            <SignOutButton />
          </div>
        </div>
        <div className="mt-3">
          <AdminNav role={session.role} />
        </div>
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        className="flex flex-col space-y-8 px-[5%] pb-12 outline-none xl:px-12"
      >
        {children}
      </main>
    </div>
  );
}
