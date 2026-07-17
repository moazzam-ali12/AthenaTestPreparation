import { TopNavWrapper } from "@/components/layout/top-nav-wrapper";
import { MobileNav } from "@/components/layout/mobile-nav";
import { FloatingAITutorWrapper } from "@/components/shared/floating-ai-tutor-wrapper";

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <TopNavWrapper />
      {/* pb-16 reserves space for the mobile bottom nav on small screens */}
      <main className="pb-16 md:pb-0">{children}</main>
      <FloatingAITutorWrapper />
      <MobileNav />
    </div>
  );
}
