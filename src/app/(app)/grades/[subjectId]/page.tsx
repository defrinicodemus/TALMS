import { redirect, notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/guard";
import { getStudentGradeContext, getStudentSubjectGradeDetail } from "@/lib/data/gradebook";
import { SubjectGradeDetailView } from "./SubjectGradeDetailView";

export default async function SubjectGradeDetailPage({
  params,
}: {
  params: Promise<{ subjectId: string }>;
}) {
  const user = await requireRole(["student"]);
  if (!user.classId) redirect("/grades");

  const { subjectId } = await params;
  const [detail, context] = await Promise.all([
    getStudentSubjectGradeDetail(user.id, user.classId, subjectId),
    getStudentGradeContext(user.classId),
  ]);
  if (!detail) notFound();

  return <SubjectGradeDetailView detail={detail} context={context} />;
}
