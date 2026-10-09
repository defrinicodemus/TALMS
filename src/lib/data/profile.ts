import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AuthUser } from "@/lib/auth-context";
import { ACADEMIC_MAINTENANCE_PATH, isAcademicAccessOpen } from "@/lib/auth/academic-access";

// Unguarded identity for the maintenance page and access-status endpoint.
export const getSessionUser = cache(async (): Promise<AuthUser | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select(
      "id, full_name, role, nisn, nip, avatar_emoji, class_id, classes!profiles_class_id_fkey(name)",
    )
    .eq("id", user.id)
    .single();
  if (error) console.error("getCurrentUser: profile fetch failed", error);
  if (!profile) return null;

  const cls = profile.classes as unknown as { name: string } | null;

  return {
    id: profile.id,
    name: profile.full_name,
    role: profile.role,
    nisn: profile.nisn ?? undefined,
    nip: profile.nip ?? undefined,
    // A placement in an inactive class is retained in the database, but must
    // not become the student's operational context after a semester change.
    classId: cls ? (profile.class_id ?? undefined) : undefined,
    className: cls?.name ?? undefined,
    avatar: profile.avatar_emoji ?? undefined,
  };
});

// Shared by pages and server actions, including calls from an already-open tab.
export const getCurrentUser = cache(async (): Promise<AuthUser | null> => {
  const user = await getSessionUser();
  if (user && user.role !== "admin" && !(await isAcademicAccessOpen(await createClient()))) {
    redirect(ACADEMIC_MAINTENANCE_PATH);
  }
  return user;
});
