"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { Role } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";

import { isNavItemCurrent, navItemsForRole } from "./nav";
import { ui } from "./ui";

export function AdminNav({ role }: { role: Role }) {
  const pathname = usePathname() ?? "";
  const items = navItemsForRole(role);

  return (
    <nav aria-label="Admin sections">
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => {
          const current = isNavItemCurrent(item, pathname);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "text-14-medium inline-flex min-h-11 items-center rounded-full border px-4 py-2 transition-colors",
                  ui.focus,
                  current
                    ? "border-green-500 bg-dark-400 text-white"
                    : "border-transparent text-dark-700 hover:text-white"
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
