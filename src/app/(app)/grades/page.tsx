import { requireRole } from "@/lib/auth/guard";
import { getStudentGradeContext, getStudentGrades } from "@/lib/data/gradebook";
import { getSchoolReportData } from "@/lib/data/schoolReport";
import { StudentGradesView } from "./StudentGradesView";
import { SchoolGradesReport } from "./SchoolGradesReport";

export default async function GradesPage() {
  const user = await requireRole(["student", "principal"]);

  if (user.role === "student") {
    const [subjects, context] = await Promise.all([
      getStudentGrades(user.id, user.classId ?? null),
      getStudentGradeContext(user.classId ?? null),
    ]);
    return <StudentGradesView subjects={subjects} context={context} />;
  }

  const data = await getSchoolReportData();
  return <SchoolGradesReport data={data} />;
}
