// Server-only: the trial AI-tutor daily message cap, shared by the tutor stream routes.
import { consumeTrialDaily, refundTrialDaily } from "@/lib/db/queries/trial";
import { getAccess, type AccessInput } from "@/lib/subscription";
import { nextUtcMidnight, trialTutorDailyCap } from "@/lib/trial";
import { trialTutorLimitResponse } from "@/lib/trial-gate";

type TutorCapUser = AccessInput & { id: string };

export type TutorCharge =
  | { blocked: Response; refund?: never }
  /** `refund` gives the message back when the LLM call fails. No-op when nothing was charged. */
  | { blocked: null; refund: () => Promise<void> };

const noRefund = async () => {};

/**
 * Charges one tutor message to a trial user's daily cap BEFORE the LLM call.
 * Pro (and trial users when the mode's cap is null) is never charged; expired
 * users never get here because the middleware already answers 402.
 * The cap is the trial-mode cost guard (see trialTutorDailyCap in src/lib/trial.ts).
 */
export async function chargeTutorMessage(user: TutorCapUser | null): Promise<TutorCharge> {
  const cap = trialTutorDailyCap();
  if (!user || cap === null || getAccess(user).tier !== "trial") {
    return { blocked: null, refund: noRefund };
  }
  const result = await consumeTrialDaily(user.id, "tutor_msg", cap);
  if (!result.allowed) return { blocked: trialTutorLimitResponse(nextUtcMidnight()) };

  let refunded = false;
  return {
    blocked: null,
    refund: async () => {
      if (refunded) return;
      refunded = true;
      await refundTrialDaily(user.id, "tutor_msg", result.usageDay);
    },
  };
}

/** Passes an upstream SSE body through, refunding the message if the upstream stream errors. */
export function refundOnStreamError(
  body: ReadableStream<Uint8Array>,
  refund: () => Promise<void>
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (err) {
        await refund();
        controller.error(err);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}
