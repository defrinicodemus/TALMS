import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Database, KeyRound, School } from "lucide-react";
import { getSchool } from "@/lib/data/school";
import { listAllUsersForReset } from "@/lib/data/people";
import { requireRole } from "@/lib/auth/guard";
import { ResetPasswordPanel } from "./ResetPasswordPanel";
import { LogoUploader } from "./LogoUploader";
import { SchoolSettingsForm } from "./SchoolSettingsForm";

export default async function SettingsPage() {
  await requireRole(["admin"]);

  const [school, users] = await Promise.all([getSchool(), listAllUsersForReset()]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon="⚙️"
        title="Pengaturan Sistem"
        subtitle="Profil sekolah, reset password, dan backup"
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

          <Card className="rounded-none border-0 p-6 shadow-soft">
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-primary" />
              <h2 className="font-display text-xl font-bold">Backup Data Sistem</h2>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Cadangkan seluruh data sistem dalam satu klik.
            </p>
            <Button className="mt-4 rounded-none">Unduh Backup (.zip)</Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
