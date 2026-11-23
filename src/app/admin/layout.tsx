import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAdmin } from "@/lib/admin/auth";
import { AdminNav } from "@/components/admin/admin-ui";

export const metadata: Metadata = { title: "Admin · Athena", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Second check behind the middleware: non-admins get the 404 page.
  if (!(await getAdmin())) notFound();
  return (
    <div className="min-h-screen bg-background">
      <AdminNav />
      <main className="mx-auto max-w-7xl px-6 py-6">{children}</main>
    </div>
  );
}
