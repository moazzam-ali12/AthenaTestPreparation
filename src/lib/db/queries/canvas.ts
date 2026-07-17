import { supabase } from "@/lib/supabase/client";

export type CanvasIntegration = {
  id: string;
  userId: string;
  canvasInstanceUrl: string;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  canvasUserId: string;
  canvasUserName: string | null;
  canvasUserEmail: string | null;
  selectedCourseId: string | null;
  selectedCourseName: string | null;
  selectedAssignmentId: string | null;
  selectedAssignmentName: string | null;
  lastSyncedAt: Date | null;
  connectedAt: Date;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapIntegration(row: any): CanvasIntegration {
  return {
    id: row.id,
    userId: row.user_id,
    canvasInstanceUrl: row.canvas_instance_url,
    accessToken: row.access_token,
    refreshToken: row.refresh_token ?? null,
    tokenExpiresAt: row.token_expires_at ? new Date(row.token_expires_at) : null,
    canvasUserId: row.canvas_user_id,
    canvasUserName: row.canvas_user_name ?? null,
    canvasUserEmail: row.canvas_user_email ?? null,
    selectedCourseId: row.selected_course_id ?? null,
    selectedCourseName: row.selected_course_name ?? null,
    selectedAssignmentId: row.selected_assignment_id ?? null,
    selectedAssignmentName: row.selected_assignment_name ?? null,
    lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at) : null,
    connectedAt: new Date(row.connected_at),
  };
}

export async function getCanvasIntegration(userId: string): Promise<CanvasIntegration | null> {
  const { data } = await supabase
    .from("canvas_integrations")
    .select("*")
    .eq("user_id", userId)
    .single();
  return data ? mapIntegration(data) : null;
}

export async function saveCanvasIntegration(data: {
  userId: string;
  canvasInstanceUrl: string;
  accessToken: string;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
  canvasUserId: string;
  canvasUserName?: string;
  canvasUserEmail?: string;
}): Promise<CanvasIntegration> {
  const { data: row, error } = await supabase
    .from("canvas_integrations")
    .upsert(
      {
        user_id: data.userId,
        canvas_instance_url: data.canvasInstanceUrl,
        access_token: data.accessToken,
        refresh_token: data.refreshToken ?? null,
        token_expires_at: data.tokenExpiresAt?.toISOString() ?? null,
        canvas_user_id: data.canvasUserId,
        canvas_user_name: data.canvasUserName ?? null,
        canvas_user_email: data.canvasUserEmail ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    )
    .select()
    .single();

  if (error || !row) throw new Error(error?.message ?? "Failed to save Canvas integration");
  return mapIntegration(row);
}

export async function updateCanvasIntegration(
  userId: string,
  data: Partial<{
    accessToken: string;
    refreshToken: string;
    tokenExpiresAt: Date;
    selectedCourseId: string;
    selectedCourseName: string;
    selectedAssignmentId: string;
    selectedAssignmentName: string;
    lastSyncedAt: Date;
  }>
): Promise<void> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (data.accessToken !== undefined) update.access_token = data.accessToken;
  if (data.refreshToken !== undefined) update.refresh_token = data.refreshToken;
  if (data.tokenExpiresAt !== undefined) update.token_expires_at = data.tokenExpiresAt.toISOString();
  if (data.selectedCourseId !== undefined) update.selected_course_id = data.selectedCourseId;
  if (data.selectedCourseName !== undefined) update.selected_course_name = data.selectedCourseName;
  if (data.selectedAssignmentId !== undefined) update.selected_assignment_id = data.selectedAssignmentId;
  if (data.selectedAssignmentName !== undefined) update.selected_assignment_name = data.selectedAssignmentName;
  if (data.lastSyncedAt !== undefined) update.last_synced_at = data.lastSyncedAt.toISOString();

  const { error } = await supabase
    .from("canvas_integrations")
    .update(update)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function deleteCanvasIntegration(userId: string): Promise<void> {
  const { error } = await supabase
    .from("canvas_integrations")
    .delete()
    .eq("user_id", userId);
  if (error) throw error;
}
