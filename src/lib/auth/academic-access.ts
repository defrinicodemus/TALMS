import type { SupabaseClient } from "@supabase/supabase-js";

export const ACADEMIC_MAINTENANCE_PATH = "/academic-maintenance";
export const ACADEMIC_MAINTENANCE_MESSAGE =
  "Sekolah sedang menyiapkan semester berikutnya. Akses pembelajaran dan monitoring ditutup sementara.";

// Fail closed on query errors as well as when no period is active.
// The RPC checks the signed-in profile's school; admins retain access.
export async function isAcademicAccessOpen(client: SupabaseClient): Promise<boolean> {
  const { data, error } = await client.rpc("academic_access_open");
  return !error && data === true;
}
