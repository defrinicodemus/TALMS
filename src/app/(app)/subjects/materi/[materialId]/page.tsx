import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/guard";
import { getMaterialForStudent } from "@/lib/data/subjects";
import { PageHeader } from "@/components/PageHeader";
import { BackButton } from "../../BackButton";
import { MaterialContentView } from "./MaterialContentView";
import { MaterialReadButton } from "./MaterialReadButton";

export default async function MaterialDetailPage({
  params,
}: {
  params: Promise<{ materialId: string }>;
}) {
  const user = await requireRole(["student"]);
  const { materialId } = await params;

  const material = await getMaterialForStudent(materialId, user.id);
  if (!material) notFound();

  return (
    <div className="min-w-0 space-y-6 [overflow-wrap:anywhere]">
      <PageHeader
        icon="📚"
        title={material.title}
        subtitle="Pelajari materi, lalu tandai sudah dibaca untuk menyimpan progresmu."
        action={<BackButton href={`/subjects/${material.subjectId}?tab=materi`} />}
      />
      {material.learningObjectiveTitle && (
        <div className="rounded-2xl border bg-card p-4 sm:p-6">
          <h2 className="text-sm font-semibold">Tujuan Pembelajaran (TP)</h2>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">
            {material.learningObjectiveTitle}
          </p>
        </div>
      )}
      <MaterialContentView material={material} />
      <MaterialReadButton key={material.id} materialId={material.id} viewed={material.viewed} />
    </div>
  );
}
