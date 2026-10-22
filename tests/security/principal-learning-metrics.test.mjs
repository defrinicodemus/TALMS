import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../../src/lib/data/learningMetrics.ts", import.meta.url),
  "utf8",
);
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const metrics = {};
new Function("exports", code)(metrics);

const base = {
  studentIds: ["student-1"],
  subjectIds: ["subject-1"],
  lockedSubjectIds: new Set(),
  assignments: [
    {
      id: "task-1",
      subjectId: "subject-1",
      learningObjectiveId: "tp-1",
      dueAt: "2026-10-19T00:00:00.000Z",
    },
    {
      id: "task-2",
      subjectId: "subject-1",
      learningObjectiveId: "tp-2",
      dueAt: "2026-10-19T00:00:00.000Z",
    },
  ],
  submissions: [
    { assignmentId: "task-1", studentId: "student-1", status: "graded", score: 50 },
    { assignmentId: "task-2", studentId: "student-1", status: "graded", score: 48 },
  ],
  finalGrades: [],
  now: Date.parse("2026-10-20T00:00:00.000Z"),
};

test("monitoring uses the same per-TP average as Buku Nilai", () => {
  const result = metrics.calculateCurrentClassGrade(base);
  assert.equal(result.average, 49);
  assert.equal(result.isFinal, false);
});

test("closed missing work is zero while submitted work waiting for grading is excluded", () => {
  const missing = metrics.calculateCurrentClassGrade({
    ...base,
    submissions: [base.submissions[0]],
  });
  assert.equal(missing.average, 25);

  const waiting = metrics.calculateCurrentClassGrade({
    ...base,
    submissions: [
      base.submissions[0],
      { assignmentId: "task-2", studentId: "student-1", status: "submitted", score: null },
    ],
  });
  assert.equal(waiting.average, 50);
});

test("a locked Buku Nilai replaces live activity scores with its final snapshot", () => {
  const result = metrics.calculateCurrentClassGrade({
    ...base,
    lockedSubjectIds: new Set(["subject-1"]),
    finalGrades: [{ studentId: "student-1", subjectId: "subject-1", score: 90 }],
  });
  assert.equal(result.average, 90);
  assert.equal(result.finalGradebookCount, 1);
  assert.equal(result.totalGradebookCount, 1);
  assert.equal(result.isFinal, true);
});

test("school report averages final snapshots and keeps missing metrics empty", () => {
  assert.equal(
    metrics.calculateFinalClassAverage([
      { studentId: "student-1", subjectId: "subject-1", score: 50 },
      { studentId: "student-1", subjectId: "subject-2", score: 48 },
    ]),
    49,
  );
  assert.equal(metrics.percentOf(0, 0), null);
  assert.equal(metrics.percentOf(3, 4), 75);
});
