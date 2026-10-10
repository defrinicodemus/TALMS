"use server";

import { assertRole } from "@/lib/auth/guard";
import { getCurrentUser } from "@/lib/data/profile";
import { getAcademicStructure } from "@/lib/data/academic";
import { summarizeAcademicReadiness, type AcademicReadiness } from "@/lib/academic-readiness";

export async function getAcademicYearReadiness(
  yearId: string,
): Promise<{ ok: true; summary: AcademicReadiness } | { ok: false; message: string }> {
  const roleError = assertRole(await getCurrentUser(), ["admin"]);
  if (roleError) return { ok: false, message: roleError.message };
  try {
    const { years, classes, students, subjects, assignments } = await getAcademicStructure();
    if (!years.some((year) => year.id === yearId)) {
      return { ok: false, message: "Tahun ajaran tidak ditemukan. Muat ulang halaman." };
    }
    return {
      ok: true,
      summary: summarizeAcademicReadiness(yearId, classes, students, subjects, assignments),
    };
  } catch {
    return {
      ok: false,
      message: "Ringkasan belum dapat dimuat. Coba lagi sebelum mengaktifkan periode.",
    };
  }
}
