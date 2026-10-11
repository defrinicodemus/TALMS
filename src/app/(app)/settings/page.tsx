import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { KeyRound, School } from "lucide-react";
import { getSchool } from "@/lib/data/school";
import { listAllUsersForReset } from "@/lib/data/people";
import { requireRole } from "@/lib/auth/guard";
import { ResetPasswordPanel } from "./ResetPasswordPanel";
import { LogoUploader } from "./LogoUploader";
import { SchoolSettingsForm } from "./SchoolSettingsForm";
import { SchoolExportPanel } from "./SchoolExportPanel";
import { createClient } from "@/lib/supabase/server";
import { getSchoolExportContext, SchoolExportError } from "@/lib/data/school-export";

export default async function SettingsPage() {
  const admin = await requireRole(["admin"]);

  const [school, users, exportStatus] = await Promise.all([
    getSchool(),
    listAllUsersForReset(),
    createClient()
      .then((client) => getSchoolExportContext(client, admin.id))
      .then(({ period }) => ({ period, error: null }))
      .catch((error: unknown) => ({
        period: null,
        error:
          error instanceof SchoolExportError
            ? error.message
            : "Status ekspor belum dapat dimuat. Silakan muat ulang halaman.",
      })),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon="⚙️"
        title="Pengaturan Sistem"
        subtitle="Profil sekolah, reset password, dan ekspor data sekolah"
        rounded="none"
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="rounded-none border-0 p-6 shadow-soft">
          <div className="flex items-center gap-2">
            <School className="h-5 w-5 text-primary" />
            <h2 className="font-display text-xl font-bold">Profil Sekolah</h2>
          </div>
          <div className="mt-4">
            <LogoUploader logoUrl={school?.logo_url ?? null} />
          </div>
          <SchoolSettingsForm
            name={school?.name ?? ""}
            address={school?.address ?? ""}
            phone={school?.phone ?? ""}
          />
        </Card>

        <div className="space-y-6">
          <Card className="rounded-none border-0 p-6 shadow-soft">
            <div className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" />
              <h2 className="font-display text-xl font-bold">Reset Password</h2>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Cari pengguna dan reset password mereka ke NISN/NIP default.
            </p>
            <ResetPasswordPanel users={users} />
          </Card>

          <SchoolExportPanel period={exportStatus.period} loadError={exportStatus.error} />
        </div>
      </div>
    </div>
  );
}
