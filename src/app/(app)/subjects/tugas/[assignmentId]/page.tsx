import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/guard";
import { getAssignmentForStudent } from "@/lib/data/subjects";
import { PageHeader } from "@/components/PageHeader";
import { BackButton } from "../../BackButton";
import { TugasDetailContent } from "./TugasDetailContent";

export default async function TugasDetailPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const user = await requireRole(["student"]);
  const { assignmentId } = await params;

  const assignment = await getAssignmentForStudent(assignmentId, user.id);
  if (!assignment || assignment.kind === "quiz" || !user.classId) notFound();

  return (
    <div className="min-w-0 space-y-6 [overflow-wrap:anywhere]">
      <PageHeader
        icon="📝"
        title={assignment.title}
        subtitle="Baca instruksi, lalu kumpulkan jawabanmu sebelum tenggat."
        action={<BackButton href={`/subjects/${assignment.subjectId}?tab=tugas`} />}
      />
      {assignment.learningObjectiveTitle && (
        <section className="rounded-2xl border bg-card p-4 sm:p-6">
          <h2 className="text-sm font-semibold">Tujuan Pembelajaran (TP)</h2>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">
            {assignment.learningObjectiveTitle}
          </p>
        </section>
      )}
      <TugasDetailContent
        key={`${assignment.id}:${assignment.submissionUpdatedAt}:${assignment.status}:${assignment.dueAt}`}
        assignment={assignment}
      />
    </div>
  );
}
