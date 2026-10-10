import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { getCurrentUser } from "@/lib/data/profile";
import { logout } from "../actions";
import { ChangePasswordDialog } from "./ChangePasswordDialog";
import { EditProfileDialog } from "./EditProfileDialog";

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="space-y-6">
      <PageHeader
        icon="👤"
        title="Profil Saya"
        subtitle="Informasi akun dan pengaturan"
        rounded="blunt"
      />
      <Card className="@container rounded-md border-0 p-4 shadow-soft @sm:p-6 @lg:p-8">
        <div className="flex flex-wrap items-center gap-4 @sm:gap-6">
          <div className="grid size-16 shrink-0 place-items-center rounded-md gradient-primary text-2xl text-primary-foreground shadow-glow @sm:size-20 @sm:text-4xl @lg:size-24 @lg:text-5xl">
            {user.avatar ?? "🙂"}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-base font-bold @sm:text-lg @md:text-xl">
              {user.name}
            </h2>
            <div className="mt-1 text-[13px] capitalize text-muted-foreground @sm:text-sm">
              {user.role}
            </div>
            <div className="mt-3 flex flex-wrap gap-2 @sm:gap-4">
              {user.nisn && <Info label="NISN" value={user.nisn} />}
              {user.nip && <Info label="NIP" value={user.nip} />}
              {user.className && <Info label="Kelas" value={user.className} />}
            </div>
          </div>
          <form action={logout}>
            <Button variant="outline" type="submit" className="rounded-md text-[13px] @sm:text-sm">
              <LogOut className="mr-2 size-[clamp(0.875rem,0.8rem+0.4cqw,1.125rem)]" /> Keluar
            </Button>
          </form>
        </div>
      </Card>

      <Card className="@container rounded-md border-0 p-4 shadow-soft @sm:p-6">
        <h3 className="font-display text-base font-bold @sm:text-lg @md:text-xl">
          Pengaturan Akun
        </h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <ChangePasswordDialog isAdmin={user.role === "admin"} />
          <EditProfileDialog
            name={user.name}
            avatar={user.avatar ?? null}
            isAdmin={user.role === "admin"}
          />
        </div>
      </Card>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/50 px-3 py-2">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground @sm:text-[10px]">
        {label}
      </div>
      <div className="text-[13px] font-semibold @sm:text-sm">{value}</div>
    </div>
  );
}
