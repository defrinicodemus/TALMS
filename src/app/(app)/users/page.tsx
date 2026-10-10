import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UsersTabs } from "./UsersTabs";
import { listStudentsWithAvg, listTeachersWithStats, getPrincipal } from "@/lib/data/people";
import { listAcademicYears, listClasses } from "@/lib/data/school";
import { requireRole } from "@/lib/auth/guard";
import { StudentsPanel } from "./StudentsPanel";
import { TeachersPanel } from "./TeachersPanel";
import { PrincipalPanel } from "./PrincipalPanel";

export default async function UsersPage() {
  await requireRole(["admin"]);

  const [students, teachers, principal, classes, years] = await Promise.all([
    listStudentsWithAvg(),
    listTeachersWithStats(),
    getPrincipal(),
    listClasses(),
    listAcademicYears(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon="👥"
        title="Manajemen Pengguna"
        subtitle="Kelola akun guru, siswa, dan kepala sekolah"
      />
      <UsersTabs>
        <TabsList className="rounded-none bg-muted p-1">
          <TabsTrigger value="siswa" className="rounded-none">
            Siswa
          </TabsTrigger>
          <TabsTrigger value="guru" className="rounded-none">
            Guru
          </TabsTrigger>
          <TabsTrigger value="kepsek" className="rounded-none">
            Kepala Sekolah
          </TabsTrigger>
        </TabsList>

        <TabsContent value="siswa" className="mt-4">
          <Card className="rounded-none border-0 p-6 shadow-soft">
            <StudentsPanel students={students} classes={classes} years={years} />
          </Card>
        </TabsContent>

        <TabsContent value="guru" className="mt-4">
          <Card className="rounded-none border-0 p-6 shadow-soft">
            <TeachersPanel teachers={teachers} />
          </Card>
        </TabsContent>

        <TabsContent value="kepsek" className="mt-4">
          <Card className="rounded-none border-0 p-6 shadow-soft">
            <PrincipalPanel principal={principal} />
          </Card>
        </TabsContent>
      </UsersTabs>
    </div>
  );
}
