import { redirect } from "next/navigation";

import { isAdminAuthenticated } from "@/lib/auth/admin";

// Belt-and-suspenders: middleware guards first (edge), this layout confirms at
// the server-component layer so the admin page never renders for unauthed requests
// even if middleware is bypassed by a misconfigured CDN or during local dev.
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await isAdminAuthenticated())) {
    redirect("/?admin=true");
  }

  return <>{children}</>;
}
