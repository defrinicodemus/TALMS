import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/data/profile";
import { createClient } from "@/lib/supabase/server";
import {
  assertExportPeriodUnchanged,
  getSchoolExportContext,
  readSchoolExportData,
  SchoolExportError,
} from "@/lib/data/school-export";
import { buildSchoolExport } from "@/lib/exports/school";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) throw new SchoolExportError("Sesi berakhir. Silakan masuk kembali.", 401);
    if (user.role !== "admin")
      throw new SchoolExportError("Hanya Admin yang dapat mengekspor data sekolah.", 403);
    const client = await createClient();
    const { school, period } = await getSchoolExportContext(client, user.id);
    if (!period)
      throw new SchoolExportError(
        "Tidak ada tahun ajaran aktif. Ekspor hanya tersedia untuk semester aktif.",
        409,
      );
    // This is a stale-page check, not a selector: the server always exports the active period.
    const expectedPeriod = request.nextUrl.searchParams.get("periodId");
    if (expectedPeriod && expectedPeriod !== period.id)
      throw new SchoolExportError(
        "Tahun ajaran aktif telah berubah. Muat ulang halaman lalu unduh kembali.",
        409,
      );
    const data = await readSchoolExportData(client, school, period);
    const result = buildSchoolExport(data);
    await assertExportPeriodUnchanged(client, school.id, period);
    return new NextResponse(new Uint8Array(result.bytes), {
      headers: {
        ...privateHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
      },
    });
  } catch (error) {
    if (!(error instanceof SchoolExportError) || error.status >= 500)
      console.error("school-export: failed to prepare download", error);
    const message =
      error instanceof SchoolExportError
        ? error.message
        : "File ekspor belum berhasil dibuat. Silakan coba lagi.";
    return NextResponse.json(
      { error: message },
      {
        status: error instanceof SchoolExportError ? error.status : 500,
        headers: privateHeaders,
      },
    );
  }
}
