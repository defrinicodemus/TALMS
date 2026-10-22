import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { getCurrentUser } from "@/lib/data/profile";
import { getSchoolReportData } from "@/lib/data/schoolReport";
import { getSchool } from "@/lib/data/school";
import { SchoolReportPdfDocument } from "@/lib/pdf/SchoolReportPdfDocument";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

const SEMESTER_LABEL: Record<"ganjil" | "genap", string> = {
  ganjil: "Ganjil",
  genap: "Genap",
};

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
  }
  if (user.role !== "principal") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: privateHeaders });
  }

  try {
    const [school, data] = await Promise.all([getSchool(), getSchoolReportData()]);

    if (!data) {
      return NextResponse.json(
        { error: "Belum ada tahun ajaran aktif" },
        { status: 404, headers: privateHeaders },
      );
    }

    const printedAt = new Date().toLocaleDateString("id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Makassar",
    });

    const buffer = await renderToBuffer(
      <SchoolReportPdfDocument
        schoolName={school?.name ?? "Sekolah"}
        schoolLogoUrl={school?.logo_url ?? null}
        yearLabel={data.academicYearLabel}
        semesterLabel={SEMESTER_LABEL[data.semester]}
        printedAt={printedAt}
        data={data}
      />,
    );

    const fileYear = data.academicYearLabel.replace("/", "-");
    const fileSemester = data.semester;

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        ...privateHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="laporan-sekolah-${fileYear}-${fileSemester}.pdf"`,
      },
    });
  } catch (error) {
    console.error("school-report: failed to prepare PDF", error);
    return NextResponse.json(
      { error: "Laporan sekolah belum berhasil dibuat. Silakan coba lagi." },
      { status: 500, headers: privateHeaders },
    );
  }
}
