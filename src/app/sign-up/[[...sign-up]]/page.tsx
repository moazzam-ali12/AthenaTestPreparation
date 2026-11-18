import { Suspense } from "react";
import { SignUp } from "@clerk/nextjs";
import { InviteBanner } from "@/components/beta/invite-banner";

export default function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-4 py-8">
      {/* /sign-up?invite=CODE → beta cohort (checked here, redeemed on first sync) */}
      <Suspense fallback={null}>
        <InviteBanner />
      </Suspense>
      <SignUp />
    </div>
  );
}
