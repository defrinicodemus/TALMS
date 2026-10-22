import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAcademicAccessOpen } from "@/lib/auth/academic-access";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ open: false }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) return NextResponse.json({ open: false }, { status: 401 });

  const open = profile.role === "admin" || (await isAcademicAccessOpen(supabase));
  return NextResponse.json(
    { open },
    { status: open ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
