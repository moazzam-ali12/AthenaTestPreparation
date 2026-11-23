import { TopNavWrapper } from "@/components/layout/top-nav-wrapper";
import { MobileNav } from "@/components/layout/mobile-nav";
import { FloatingAITutorWrapper } from "@/components/shared/floating-ai-tutor-wrapper";
import { UpgradeBanner } from "@/components/dashboard/upgrade-banner";
import { UpgradeModalProvider } from "@/components/trial/upgrade-modal-provider";
import { FeedbackButton } from "@/components/beta/feedback-button";
import { SentryUser } from "@/components/providers/sentry-user";

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <UpgradeModalProvider>
      <div className="min-h-screen">
        <SentryUser />
        <TopNavWrapper />
        {/* Reserves space for the mobile bottom nav (+ iPhone home-indicator inset) */}
        <main className="pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
          <UpgradeBanner />
          {children}
        </main>
        <FloatingAITutorWrapper />
        <FeedbackButton />
        <MobileNav />
      </div>
    </UpgradeModalProvider>
  );
}
