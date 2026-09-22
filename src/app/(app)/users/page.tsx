import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { listStudentsWithAvg, listTeachersWithStats, getPrincipal } from "@/lib/data/people";
import { listClasses } from "@/lib/data/school";
import { requireRole } from "@/lib/auth/guard";
import { StudentsPanel } from "./StudentsPanel";
import { TeachersPanel } from "./TeachersPanel";
import { PrincipalPanel } from "./PrincipalPanel";

export default async function UsersPage() {
  await requireRole(["admin"]);

  const [students, teachers, principal, classes] = await Promise.all([
    listStudentsWithAvg(),
    listTeachersWithStats(),
    getPrincipal(),
    listClasses(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader 
        icon="👥"
        title="Manajemen Pengguna"
        subtitle="Kelola akun guru, siswa, dan kepala sekolah"
      />
      <Tabs defaultValue="siswa">
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
            <StudentsPanel students={students} classes={classes} />
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
      </Tabs>
    </div>
  );
}
