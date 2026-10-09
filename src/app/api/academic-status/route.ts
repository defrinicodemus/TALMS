import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/data/profile";
import { createClient } from "@/lib/supabase/server";
import { isAcademicAccessOpen } from "@/lib/auth/academic-access";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ open: false }, { status: 401 });
  const open = user.role === "admin" || (await isAcademicAccessOpen(await createClient()));
  return NextResponse.json(
    { open },
    { status: open ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
