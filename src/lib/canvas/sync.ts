import { getCanvasIntegration, updateCanvasIntegration } from "@/lib/db/queries/canvas";
import { createCanvasClient, CanvasApiError } from "@/lib/canvas/client";
import { refreshCanvasToken } from "@/lib/canvas/oauth";

type QuestSyncData = {
  questDate: string;
  correctCount: number;
  totalQuestions: number;
  xpEarned: number;
};

export async function syncQuestToCanvas(
  userId: string,
  data: QuestSyncData
): Promise<{ synced: boolean; reason?: string }> {
  const integration = await getCanvasIntegration(userId);
  if (!integration) return { synced: false, reason: "no_integration" };
  if (!integration.selectedCourseId || !integration.selectedAssignmentId) {
    return { synced: false, reason: "not_configured" };
  }

  let accessToken = integration.accessToken;

  // Refresh token if it expires within 60 seconds
  if (
    integration.tokenExpiresAt &&
    integration.tokenExpiresAt.getTime() < Date.now() + 60_000
  ) {
    try {
      const refreshed = await refreshCanvasToken(integration);
      accessToken = refreshed.accessToken;
      await updateCanvasIntegration(userId, {
        accessToken: refreshed.accessToken,
        ...(refreshed.refreshToken ? { refreshToken: refreshed.refreshToken } : {}),
        ...(refreshed.tokenExpiresAt ? { tokenExpiresAt: refreshed.tokenExpiresAt } : {}),
      });
    } catch {
      return { synced: false, reason: "token_refresh_failed" };
    }
  }

  const client = createCanvasClient(integration.canvasInstanceUrl, accessToken);
  const pct = Math.round((data.correctCount / data.totalQuestions) * 100);

  const submissionBody = [
    `<h3>Athena Daily Quest — ${data.questDate}</h3>`,
    `<p><strong>Score:</strong> ${data.correctCount}/${data.totalQuestions} (${pct}%)</p>`,
    `<p><strong>XP Earned:</strong> ${data.xpEarned}</p>`,
    `<p><em>Submitted automatically by Athena</em></p>`,
  ].join("\n");

  try {
    await client.submitAssignment(
      integration.selectedCourseId,
      integration.selectedAssignmentId,
      submissionBody,
    );
  } catch (err) {
    if (err instanceof CanvasApiError) {
      return { synced: false, reason: `canvas_api_${err.statusCode}` };
    }
    return { synced: false, reason: "unknown_error" };
  }

  // If an instructor token is configured, also push a numeric grade
  const instructorToken = process.env.CANVAS_INSTRUCTOR_TOKEN;
  if (instructorToken && integration.canvasUserId) {
    try {
      const instructorClient = createCanvasClient(
        integration.canvasInstanceUrl,
        instructorToken,
      );
      await instructorClient.postGrade(
        integration.selectedCourseId,
        integration.selectedAssignmentId,
        integration.canvasUserId,
        `${pct}%`,
      );
    } catch {
      // Grade passback is best-effort; the submission already succeeded
    }
  }

  await updateCanvasIntegration(userId, { lastSyncedAt: new Date() });
  return { synced: true };
}
