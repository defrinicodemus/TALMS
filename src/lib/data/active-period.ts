import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// Shared scope for operational dashboards. Historical reports keep their
// explicit year selection. RLS also limits these classes to the user's school.
export const getActiveClassIds = cache(async (): Promise<string[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("classes")
    .select("id, academic_years!inner(is_active)")
    .eq("academic_years.is_active", true);
  if (error) throw new Error("Gagal memuat kelas tahun ajaran aktif.");
  return (data ?? []).map((row) => row.id);
});
