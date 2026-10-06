import { AdminShell } from "@/components/admin/AdminShell";
import { requireStaffPage } from "@/lib/auth/guards";

// Per-request auth: never prerender anything under /admin.
export const dynamic = "force-dynamic";

// Belt-and-suspenders: middleware guards first (edge, incl. per-path role rules in
// lib/auth/access.ts), this layout confirms at the server-component layer so the
// admin page never renders for unauthed requests even if middleware is bypassed by
// a misconfigured CDN or during local dev. Any staff role may enter /admin; pages
// with narrower rules must call requireStaffPage(...roles) / requireRole(...roles).
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireStaffPage();

  return <AdminShell session={session}>{children}</AdminShell>;
}
