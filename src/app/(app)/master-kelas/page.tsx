import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { getMasterKelasData } from "@/lib/data/masterKelas";
import { requireRole } from "@/lib/auth/guard";
import { MasterKelasManager } from "./MasterKelasManager";

export const metadata: Metadata = { title: "Master Kelas" };

export default async function MasterKelasPage() {
  await requireRole(["admin"]);

  const data = await getMasterKelasData();

  return (
    <div className="space-y-6">
      <PageHeader
        icon="🗂️"
        title="Master Kelas"
        subtitle="Pembagian guru per mata pelajaran dan siswa per kelas"
        rounded="none"
      />
      <MasterKelasManager {...data} />
    </div>
  );
}
