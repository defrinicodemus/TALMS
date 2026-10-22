import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/guard";
import { getAssignmentForStudent } from "@/lib/data/subjects";
import { PageHeader } from "@/components/PageHeader";
import { BackButton } from "../../BackButton";
import { KuisDetailContent } from "./KuisDetailContent";

export default async function KuisDetailPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const user = await requireRole(["student"]);
  const { assignmentId } = await params;

  const assignment = await getAssignmentForStudent(assignmentId, user.id);
  if (!assignment || assignment.kind !== "quiz") notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        icon="❓"
        title={assignment.title}
        subtitle="Kerjakan kuis dan pelajari pembahasannya setelah mengumpulkan."
        action={<BackButton href={`/subjects/${assignment.subjectId}?tab=kuis`} />}
      />
      <KuisDetailContent assignment={assignment} />
    </div>
  );
}
