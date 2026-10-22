"use client";

import { useState, useTransition } from "react";
import { assignmentTimeInputs, formatAssignmentTime } from "@/lib/assignmentConstants";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { RichTextEditor } from "@/components/RichTextEditor";
import { ExpandRegion } from "@/components/ExpandRegion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  ListChecks,
  Trash2,
  ChevronDown,
  ChevronUp,
  Check,
  EyeOff,
  Eye,
  UploadCloud,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TeacherClassSubject } from "@/lib/data/teaching";
import type { LearningObjectiveRow } from "@/lib/data/curriculum";
import type { QuestionType, QuizQuestionRow, QuizRow, QuizType } from "@/lib/data/classroom";
import { QUIZ_STATUS_LABEL, QUIZ_STATUS_BADGE_CLASS } from "@/lib/quizStatus";
import {
  createQuiz,
  updateQuiz,
  deleteQuiz,
  setQuizActive,
  publishQuiz,
  addQuizQuestion,
  updateQuizQuestion,
  setQuizQuestionActive,
  deleteQuizQuestion,
} from "./actions";

function comboKey(classId: string, subjectId: string) {
  return `${classId}:${subjectId}`;
}

const QUIZ_TYPE_LABEL: Record<QuizType, string> = {
  latihan: "Kuis Latihan",
  ulangan_harian: "Ulangan Harian",
  uts: "UTS",
  uas: "UAS",
};
const QUIZ_TYPE_OPTIONS: { value: QuizType; label: string }[] = [
  { value: "latihan", label: "Kuis Latihan" },
  { value: "ulangan_harian", label: "Ulangan Harian" },
  { value: "uts", label: "UTS" },
  { value: "uas", label: "UAS" },
];

type BuilderQuestionType = "multiple_choice" | "true_false" | "drag_and_drop" | "sequence";

const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  multiple_choice: "Pilihan Ganda",
  true_false: "True or False",
  drag_and_drop: "Drag and Drop",
  sequence: "Langkah-langkah",
  short_answer: "Isian Singkat",
};
const QUESTION_TYPE_OPTIONS: { value: BuilderQuestionType; label: string }[] = [
  { value: "multiple_choice", label: "Pilihan Ganda" },
  { value: "true_false", label: "True or False" },
  { value: "drag_and_drop", label: "Drag and Drop" },
  { value: "sequence", label: "Langkah-langkah" },
];

const ADD_QUIZ_KEY = "__add_quiz__";
const ADD_QUESTION_KEY = "__add_question__";

async function requestQuizChange(action: () => Promise<{ ok: boolean; message: string }>) {
  try {
    return await action();
  } catch {
    return {
      ok: false,
      message:
        "Perubahan belum dapat dikonfirmasi. Isian tetap tersedia; periksa koneksi lalu coba lagi.",
    };
  }
}

function todayDateStr() {
  return assignmentTimeInputs(new Date().toISOString()).date;
}
function nowTimeStr() {
  return assignmentTimeInputs(new Date().toISOString()).time;
}
function formatDueDateTime(dueAt: string | null): string | null {
  return dueAt ? formatAssignmentTime(dueAt) : null;
}

function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5 rounded-md bg-muted p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition",
            value === o.value
              ? "bg-card text-primary shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function QuizzesTab({
  combos,
  quizzesByKey,
  questionsByQuizId,
  objectivesByKey,
}: {
  combos: TeacherClassSubject[];
  quizzesByKey: Record<string, QuizRow[]>;
  questionsByQuizId: Record<string, QuizQuestionRow[]>;
  objectivesByKey: Record<string, LearningObjectiveRow[]>;
}) {
  const [selectedKey, setSelectedKey] = useState(comboKey(combos[0].classId, combos[0].subjectId));
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const selectedCombo = combos.find((c) => comboKey(c.classId, c.subjectId) === selectedKey)!;
  const quizzes = quizzesByKey[selectedKey] ?? [];
  const objectives = objectivesByKey[selectedKey] ?? [];

  function toggle(key: string) {
    setExpandedKey((current) => (current === key ? null : key));
  }

  return (
    <div className="space-y-6">
      <Card className="@container rounded-md border-0 p-4 shadow-soft @sm:p-6">
        <div>
          <Label className="text-xs">Kelas & Mata Pelajaran</Label>
          <Select
            value={selectedKey}
            onValueChange={(v) => {
              setSelectedKey(v);
              setExpandedKey(null);
            }}
          >
            <SelectTrigger className="mt-1 w-full sm:w-80">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {combos.map((c) => (
                <SelectItem
                  key={comboKey(c.classId, c.subjectId)}
                  value={comboKey(c.classId, c.subjectId)}
                >
                  {c.className} · {c.subjectName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      <AddQuizCard
        classId={selectedCombo.classId}
        subjectId={selectedCombo.subjectId}
        objectives={objectives}
        isExpanded={expandedKey === ADD_QUIZ_KEY}
        onToggle={() => toggle(ADD_QUIZ_KEY)}
      />

      <Card className="rounded-md border-0 p-2 shadow-soft">
        <div className="space-y-1">
          {quizzes.map((q) => (
            <QuizListItem
              key={q.id}
              quiz={q}
              questions={questionsByQuizId[q.id] ?? []}
              objectives={objectives}
              isExpanded={expandedKey === q.id}
              onToggle={() => toggle(q.id)}
            />
          ))}
          {quizzes.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">Belum ada kuis.</p>
          )}
        </div>
      </Card>
    </div>
  );
}

interface QuizFormValues {
  title: string;
  quizType: QuizType;
  learningObjectiveId: string;
  description: string;
  dueDate: string;
  dueTime: string;
  timerMinutes: string;
  passingGrade: string;
}

function emptyQuizFormValues(): QuizFormValues {
  return {
    title: "",
    quizType: "latihan",
    learningObjectiveId: "",
    description: "",
    dueDate: "",
    dueTime: "23:59",
    timerMinutes: "",
    passingGrade: "",
  };
}

function quizToFormValues(quiz: QuizRow): QuizFormValues {
  const due = assignmentTimeInputs(quiz.dueAt);
  return {
    title: quiz.title,
    quizType: quiz.quizType ?? "latihan",
    learningObjectiveId: quiz.learningObjectiveId ?? "",
    description: quiz.description ?? "",
    dueDate: due.date,
    dueTime: due.time,
    timerMinutes: quiz.timerMinutes != null ? String(quiz.timerMinutes) : "",
    passingGrade: quiz.passingGrade != null ? String(quiz.passingGrade) : "",
  };
}

function buildQuizFormData(values: QuizFormValues): FormData {
  const formData = new FormData();
  formData.set("title", values.title.trim());
  formData.set("quiz_type", values.quizType);
  formData.set("learning_objective_id", values.learningObjectiveId);
  formData.set("description", values.description);
  formData.set("due_date", values.dueDate);
  formData.set("due_time", values.dueTime);
  if (values.timerMinutes) formData.set("timer_minutes", values.timerMinutes);
  if (values.passingGrade) formData.set("passing_grade", values.passingGrade);
  return formData;
}

function QuizFormFields({
  values,
  onChange,
  objectives,
  editorKey,
  locked = false,
}: {
  values: QuizFormValues;
  onChange: (patch: Partial<QuizFormValues>) => void;
  objectives: LearningObjectiveRow[];
  editorKey: number;
  locked?: boolean;
}) {
  const minDate = todayDateStr();
  const minTime = values.dueDate === minDate ? nowTimeStr() : undefined;
  return (
    <div className="space-y-4">
      <div>
        <Label>Judul Kuis/Ujian *</Label>
        <Input
          name="title"
          className="mt-1"
          value={values.title}
          onChange={(e) => onChange({ title: e.target.value })}
          required
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label>Tipe Kuis</Label>
          <Select
            disabled={locked}
            value={values.quizType}
            onValueChange={(v) => onChange({ quizType: v as QuizType })}
          >
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {QUIZ_TYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Tujuan Pembelajaran (TP) *</Label>
          <Select
            disabled={locked}
            value={values.learningObjectiveId}
            onValueChange={(v) => onChange({ learningObjectiveId: v })}
          >
            <SelectTrigger className="mt-1">
              <SelectValue placeholder="Pilih TP" />
            </SelectTrigger>
            <SelectContent>
              {objectives.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label>Deskripsi / Instruksi</Label>
        <div className="mt-1">
          <RichTextEditor
            key={editorKey}
            name="description"
            variant="simple"
            defaultValue={values.description}
            placeholder="Tulis instruksi pengerjaan kuis di sini..."
            onChange={(html) => onChange({ description: html })}
          />
        </div>
      </div>
      {locked && (
        <p className="text-sm text-muted-foreground">
          Kuis sudah dipublikasikan. Hanya judul, instruksi, dan tenggat yang dapat diedit.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Estimasi adalah perkiraan durasi dari guru, bukan hitung mundur. Pengumpulan ditutup pada
        tenggat.
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label>Estimasi pengerjaan (menit)</Label>
          <Input
            disabled={locked}
            name="timer_minutes"
            type="number"
            min={1}
            placeholder="mis. 30"
            className="mt-1"
            value={values.timerMinutes}
            onChange={(e) => onChange({ timerMinutes: e.target.value })}
          />
        </div>
        <div>
          <Label>Tenggat Kuis (WITA) *</Label>
          <div className="mt-1 space-y-2">
            <Input
              name="due_date"
              type="date"
              min={minDate}
              value={values.dueDate}
              onChange={(e) => onChange({ dueDate: e.target.value })}
              required
            />
            <Input
              name="due_time"
              type="time"
              min={minTime}
              value={values.dueTime}
              onChange={(e) => onChange({ dueTime: e.target.value })}
              required
            />
          </div>
        </div>
        <div>
          <Label>Passing Grade (KKM)</Label>
          <Input
            disabled={locked}
            name="passing_grade"
            type="number"
            min={0}
            max={100}
            placeholder="mis. 70"
            className="mt-1"
            value={values.passingGrade}
            onChange={(e) => onChange({ passingGrade: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}

function AddQuizCard({
  classId,
  subjectId,
  objectives,
  isExpanded,
  onToggle,
}: {
  classId: string;
  subjectId: string;
  objectives: LearningObjectiveRow[];
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const [values, setValues] = useState<QuizFormValues>(emptyQuizFormValues);
  const [isPending, startTransition] = useTransition();
  const [editorKey, setEditorKey] = useState(0);

  function patch(p: Partial<QuizFormValues>) {
    setValues((prev) => ({ ...prev, ...p }));
  }

  function resetForm() {
    setValues(emptyQuizFormValues());
    setEditorKey((k) => k + 1);
  }

  function handleSubmit() {
    if (!values.title.trim()) {
      toast.error("Judul kuis wajib diisi.");
      return;
    }
    if (!values.learningObjectiveId) {
      toast.error("Tujuan Pembelajaran (TP) wajib dipilih.");
      return;
    }
    if (!values.dueDate || !values.dueTime) {
      toast.error("Tenggat kuis wajib diisi.");
      return;
    }

    const formData = buildQuizFormData(values);
    formData.set("class_id", classId);
    formData.set("subject_id", subjectId);

    startTransition(async () => {
      const result = await requestQuizChange(() => createQuiz(formData));
      if (result.ok) {
        toast.success(result.message);
        resetForm();
        onToggle();
      } else {
        toast.error(result.message);
      }
    });
  }

  const noObjectives = objectives.length === 0;

  return (
    <Card className="@container overflow-hidden rounded-md border-0 shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 @sm:p-6">
        <div>
          <h3 className="font-display text-base font-bold @sm:text-lg @md:text-xl">
            Buat Kuis & Ujian
          </h3>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Isi info dasar kuis, tenggat waktu, dan KKM. Soal-soal bisa ditambahkan setelah kuis
            tersimpan.
          </p>
        </div>
        <Button type="button" variant="outline" className="shrink-0 rounded-md" onClick={onToggle}>
          {isExpanded ? "Tutup Form" : "Buka Form"}
          {isExpanded ? (
            <ChevronUp className="ml-1.5 h-4 w-4" />
          ) : (
            <ChevronDown className="ml-1.5 h-4 w-4" />
          )}
        </Button>
      </div>

      <ExpandRegion expanded={isExpanded}>
        <div className="space-y-4 border-t px-4 pb-4 pt-4 @sm:px-6 @sm:pb-6">
          {noObjectives ? (
            <p className="text-sm text-muted-foreground">
              Belum ada Tujuan Pembelajaran (TP) untuk kelas & mapel ini. Isi dulu lewat menu Kelola
              Kurikulum.
            </p>
          ) : (
            <>
              <QuizFormFields
                values={values}
                onChange={patch}
                objectives={objectives}
                editorKey={editorKey}
              />
              <div className="flex justify-end pt-2">
                <Button
                  type="button"
                  className="rounded-md"
                  disabled={isPending}
                  onClick={handleSubmit}
                >
                  {isPending ? "Menyimpan..." : "Simpan Kuis"}
                </Button>
              </div>
            </>
          )}
        </div>
      </ExpandRegion>
    </Card>
  );
}

interface OptionDraft {
  text: string;
  isCorrect: boolean;
}
interface PairDraft {
  dragText: string;
  targetText: string;
}

interface QuestionFormValues {
  questionType: BuilderQuestionType;
  points: string;
  questionText: string;
  explanation: string;
  options: OptionDraft[];
  trueFalseAnswer: "benar" | "salah";
  pairs: PairDraft[];
  steps: string[];
}

function emptyQuestionFormValues(): QuestionFormValues {
  return {
    questionType: "multiple_choice",
    points: "",
    questionText: "",
    explanation: "",
    options: [
      { text: "", isCorrect: true },
      { text: "", isCorrect: false },
      { text: "", isCorrect: false },
    ],
    trueFalseAnswer: "benar",
    pairs: [
      { dragText: "", targetText: "" },
      { dragText: "", targetText: "" },
    ],
    steps: ["", "", ""],
  };
}

function questionToFormValues(q: QuizQuestionRow): QuestionFormValues {
  const fallback = emptyQuestionFormValues();
  const questionType: BuilderQuestionType =
    q.questionType === "short_answer" ? "multiple_choice" : q.questionType;
  return {
    questionType,
    points: String(q.points),
    questionText: q.questionText,
    explanation: q.explanation ?? "",
    options:
      q.options.length > 0
        ? q.options.map((o) => ({ text: o.text, isCorrect: o.isCorrect }))
        : fallback.options,
    trueFalseAnswer: q.correctAnswerText === "salah" ? "salah" : "benar",
    pairs:
      q.pairs.length > 0
        ? q.pairs.map((p) => ({ dragText: p.dragText, targetText: p.targetText }))
        : fallback.pairs,
    steps: q.steps.length > 0 ? q.steps.map((s) => s.stepText) : fallback.steps,
  };
}

function buildQuestionFormData(values: QuestionFormValues): FormData {
  const formData = new FormData();
  formData.set("question_type", values.questionType);
  formData.set("points", values.points);
  formData.set("question_text", values.questionText.trim());
  formData.set("explanation", values.explanation.trim());
  if (values.questionType === "multiple_choice") {
    const correctIndex = values.options.findIndex((o) => o.isCorrect);
    formData.set("correct_index", String(correctIndex));
    for (const o of values.options) formData.append("option_text", o.text.trim());
  } else if (values.questionType === "true_false") {
    formData.set("correct_answer_text", values.trueFalseAnswer);
  } else if (values.questionType === "drag_and_drop") {
    for (const p of values.pairs) {
      formData.append("pair_drag_text", p.dragText.trim());
      formData.append("pair_target_text", p.targetText.trim());
    }
  } else if (values.questionType === "sequence") {
    for (const s of values.steps) formData.append("step_text", s.trim());
  }
  return formData;
}

function OptionsEditor({
  options,
  onChange,
}: {
  options: OptionDraft[];
  onChange: (next: OptionDraft[]) => void;
}) {
  function updateText(i: number, text: string) {
    onChange(options.map((o, idx) => (idx === i ? { ...o, text } : o)));
  }
  function setCorrect(i: number) {
    onChange(options.map((o, idx) => ({ ...o, isCorrect: idx === i })));
  }
  function remove(i: number) {
    if (options.length <= 2) return;
    const next = options.filter((_, idx) => idx !== i);
    if (!next.some((o) => o.isCorrect)) next[0].isCorrect = true;
    onChange(next);
  }
  function add() {
    if (options.length >= 6) return;
    onChange([...options, { text: "", isCorrect: false }]);
  }
  return (
    <div className="space-y-2">
      <Label>Opsi Jawaban</Label>
      {options.map((o, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="radio"
            checked={o.isCorrect}
            onChange={() => setCorrect(i)}
            aria-label={`Opsi ${i + 1} benar`}
          />
          <Input
            value={o.text}
            onChange={(e) => updateText(i, e.target.value)}
            placeholder={`Opsi ${i + 1}`}
            className="flex-1"
          />
          <button
            type="button"
            onClick={() => remove(i)}
            disabled={options.length <= 2}
            className="shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-30"
            aria-label={`Hapus opsi ${i + 1}`}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Tandai bulatan di kiri untuk opsi yang benar.
        </p>
        {options.length < 6 && (
          <Button type="button" size="sm" variant="ghost" onClick={add}>
            + Tambah Opsi
          </Button>
        )}
      </div>
    </div>
  );
}

function TrueFalseEditor({
  value,
  onChange,
}: {
  value: "benar" | "salah";
  onChange: (v: "benar" | "salah") => void;
}) {
  return (
    <div>
      <Label>Jawaban Benar</Label>
      <div className="mt-1">
        <SegmentedTabs
          options={[
            { value: "benar", label: "Benar" },
            { value: "salah", label: "Salah" },
          ]}
          value={value}
          onChange={onChange}
        />
      </div>
    </div>
  );
}

function PairsEditor({
  pairs,
  onChange,
}: {
  pairs: PairDraft[];
  onChange: (next: PairDraft[]) => void;
}) {
  function update(i: number, field: "dragText" | "targetText", v: string) {
    onChange(pairs.map((p, idx) => (idx === i ? { ...p, [field]: v } : p)));
  }
  function remove(i: number) {
    if (pairs.length <= 2) return;
    onChange(pairs.filter((_, idx) => idx !== i));
  }
  function add() {
    if (pairs.length >= 8) return;
    onChange([...pairs, { dragText: "", targetText: "" }]);
  }
  return (
    <div className="space-y-2">
      <Label>Pasangan Drag & Target</Label>
      {pairs.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={p.dragText}
            onChange={(e) => update(i, "dragText", e.target.value)}
            placeholder={`Blok Drag ${i + 1}`}
            className="flex-1"
          />
          <span className="shrink-0 text-muted-foreground">↔</span>
          <Input
            value={p.targetText}
            onChange={(e) => update(i, "targetText", e.target.value)}
            placeholder={`Blok Target ${i + 1}`}
            className="flex-1"
          />
          <button
            type="button"
            onClick={() => remove(i)}
            disabled={pairs.length <= 2}
            className="shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-30"
            aria-label={`Hapus pair ${i + 1}`}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Blok drag dan blok target akan diacak otomatis di halaman siswa.
        </p>
        {pairs.length < 8 && (
          <Button type="button" size="sm" variant="ghost" onClick={add}>
            + Tambah Pair
          </Button>
        )}
      </div>
    </div>
  );
}

function StepsEditor({ steps, onChange }: { steps: string[]; onChange: (next: string[]) => void }) {
  function update(i: number, v: string) {
    onChange(steps.map((s, idx) => (idx === i ? v : s)));
  }
  function remove(i: number) {
    if (steps.length <= 2) return;
    onChange(steps.filter((_, idx) => idx !== i));
  }
  function add() {
    if (steps.length >= 8) return;
    onChange([...steps, ""]);
  }
  return (
    <div className="space-y-2">
      <Label>Langkah-langkah (urutan yang benar)</Label>
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-soft/50 text-xs font-bold">
            {i + 1}
          </div>
          <Input
            value={s}
            onChange={(e) => update(i, e.target.value)}
            placeholder={`Langkah ${i + 1}`}
            className="flex-1"
          />
          <button
            type="button"
            onClick={() => remove(i)}
            disabled={steps.length <= 2}
            className="shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-30"
            aria-label={`Hapus langkah ${i + 1}`}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Masukkan langkah sesuai urutan yang benar. Urutan akan diacak di halaman siswa.
        </p>
        {steps.length < 8 && (
          <Button type="button" size="sm" variant="ghost" onClick={add}>
            + Tambah Langkah
          </Button>
        )}
      </div>
    </div>
  );
}

function QuestionFormFields({
  values,
  onChange,
  remainingBudget,
}: {
  values: QuestionFormValues;
  onChange: (patch: Partial<QuestionFormValues>) => void;
  remainingBudget: number;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label>Tipe Pertanyaan</Label>
          <Select
            value={values.questionType}
            onValueChange={(v) => onChange({ questionType: v as BuilderQuestionType })}
          >
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {QUESTION_TYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Bobot Poin *</Label>
          <Input
            name="points"
            type="number"
            min={1}
            max={Math.max(1, remainingBudget)}
            value={values.points}
            onChange={(e) => onChange({ points: e.target.value })}
            className="mt-1"
          />
          <p className="mt-1 text-xs text-muted-foreground">Sisa kuota: {remainingBudget} poin</p>
        </div>
      </div>
      <div>
        <Label>Pertanyaan *</Label>
        <Textarea
          name="question_text"
          value={values.questionText}
          onChange={(e) => onChange({ questionText: e.target.value })}
          rows={3}
          className="mt-1"
        />
      </div>

      {values.questionType === "multiple_choice" && (
        <OptionsEditor options={values.options} onChange={(options) => onChange({ options })} />
      )}
      {values.questionType === "true_false" && (
        <TrueFalseEditor
          value={values.trueFalseAnswer}
          onChange={(v) => onChange({ trueFalseAnswer: v })}
        />
      )}
      {values.questionType === "drag_and_drop" && (
        <PairsEditor pairs={values.pairs} onChange={(pairs) => onChange({ pairs })} />
      )}
      {values.questionType === "sequence" && (
        <StepsEditor steps={values.steps} onChange={(steps) => onChange({ steps })} />
      )}

      <div>
        <Label>Penjelasan (opsional)</Label>
        <Textarea
          value={values.explanation}
          onChange={(e) => onChange({ explanation: e.target.value })}
          rows={2}
          className="mt-1"
          placeholder="Penjelasan tambahan tentang jawaban soal ini..."
        />
      </div>
    </div>
  );
}

function AddQuestionCard({
  assignmentId,
  remainingBudget,
  isExpanded,
  onToggle,
}: {
  assignmentId: string;
  remainingBudget: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const [values, setValues] = useState<QuestionFormValues>(emptyQuestionFormValues);
  const [isPending, startTransition] = useTransition();

  function patch(p: Partial<QuestionFormValues>) {
    setValues((prev) => ({ ...prev, ...p }));
  }

  function resetForm() {
    setValues(emptyQuestionFormValues());
  }

  function handleSubmit() {
    if (!values.questionText.trim()) {
      toast.error("Pertanyaan wajib diisi.");
      return;
    }
    const points = Number(values.points);
    if (!Number.isFinite(points) || points <= 0) {
      toast.error("Bobot poin wajib diisi.");
      return;
    }
    if (points > remainingBudget) {
      toast.error(`Bobot poin melebihi sisa kuota (${remainingBudget} poin).`);
      return;
    }
    const formData = buildQuestionFormData(values);
    formData.set("assignment_id", assignmentId);
    startTransition(async () => {
      const result = await requestQuizChange(() => addQuizQuestion(formData));
      if (result.ok) {
        toast.success(result.message);
        resetForm();
        onToggle();
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <Card className="@container overflow-hidden rounded-md border shadow-none">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h4 className="text-sm font-semibold">Tambah Pertanyaan</h4>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Pilih jenis soal, isi bobot poin, pertanyaan, dan jawabannya di bawah ini.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0 rounded-md"
          onClick={onToggle}
        >
          {isExpanded ? "Tutup Form" : "Buka Form"}
          {isExpanded ? (
            <ChevronUp className="ml-1.5 h-4 w-4" />
          ) : (
            <ChevronDown className="ml-1.5 h-4 w-4" />
          )}
        </Button>
      </div>
      <ExpandRegion expanded={isExpanded}>
        <div className="space-y-4 border-t p-4">
          {remainingBudget <= 0 ? (
            <p className="text-sm text-muted-foreground">
              Kuota poin soal sudah habis (100/100 poin digunakan). Kurangi bobot poin soal lain
              atau nonaktifkan salah satu soal untuk menambah soal baru.
            </p>
          ) : (
            <>
              <QuestionFormFields
                values={values}
                onChange={patch}
                remainingBudget={remainingBudget}
              />
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  className="rounded-md"
                  disabled={isPending}
                  onClick={handleSubmit}
                >
                  {isPending ? "Menyimpan..." : "Simpan Pertanyaan"}
                </Button>
              </div>
            </>
          )}
        </div>
      </ExpandRegion>
    </Card>
  );
}

function QuestionPreview({ question }: { question: QuizQuestionRow }) {
  return (
    <div className="space-y-2 text-sm">
      {question.questionType === "multiple_choice" && (
        <ul className="space-y-1">
          {question.options.map((o) => (
            <li
              key={o.id}
              className={cn(
                "flex items-center gap-1.5",
                o.isCorrect ? "font-semibold text-primary" : "text-muted-foreground",
              )}
            >
              {o.isCorrect && <Check className="h-3.5 w-3.5 shrink-0" />}
              {o.text}
            </li>
          ))}
        </ul>
      )}
      {question.questionType === "true_false" && (
        <p className="text-primary">
          Jawaban benar: {question.correctAnswerText === "salah" ? "Salah" : "Benar"}
        </p>
      )}
      {question.questionType === "drag_and_drop" && (
        <ul className="space-y-1 text-muted-foreground">
          {question.pairs.map((p) => (
            <li key={p.id}>
              {p.dragText} <span className="text-primary">↔</span> {p.targetText}
            </li>
          ))}
        </ul>
      )}
      {question.questionType === "sequence" && (
        <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
          {question.steps.map((s) => (
            <li key={s.id}>{s.stepText}</li>
          ))}
        </ol>
      )}
      {question.explanation && (
        <p className="rounded-md bg-muted/40 p-2 text-xs italic text-muted-foreground">
          Penjelasan: {question.explanation}
        </p>
      )}
    </div>
  );
}

function QuestionListItem({
  question,
  remainingBudget,
  isExpanded,
  onToggle,
  locked,
}: {
  question: QuizQuestionRow;
  remainingBudget: number;
  isExpanded: boolean;
  onToggle: () => void;
  locked: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<QuestionFormValues>(() => questionToFormValues(question));

  function patch(p: Partial<QuestionFormValues>) {
    setValues((prev) => ({ ...prev, ...p }));
  }

  function handleToggle() {
    setEditing(false);
    setValues(questionToFormValues(question));
    onToggle();
  }

  function handleEdit() {
    setEditing(true);
    setValues(questionToFormValues(question));
  }

  function handleCancelEdit() {
    setEditing(false);
    setValues(questionToFormValues(question));
  }

  function handleSave() {
    if (!values.questionText.trim()) {
      toast.error("Pertanyaan wajib diisi.");
      return;
    }
    const points = Number(values.points);
    if (!Number.isFinite(points) || points <= 0) {
      toast.error("Bobot poin wajib diisi.");
      return;
    }
    if (points > remainingBudget) {
      toast.error(`Bobot poin melebihi sisa kuota (${remainingBudget} poin).`);
      return;
    }
    const formData = buildQuestionFormData(values);
    formData.set("id", question.id);
    startTransition(async () => {
      const result = await requestQuizChange(() => updateQuizQuestion(formData));
      if (result.ok) {
        toast.success(result.message);
        setEditing(false);
      } else {
        toast.error(result.message);
      }
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await requestQuizChange(() => deleteQuizQuestion(question.id));
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    });
  }

  function handleToggleActive() {
    startTransition(async () => {
      const result = await requestQuizChange(() =>
        setQuizQuestionActive(question.id, !question.isActive),
      );
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    });
  }

  return (
    <div className="@container rounded-md border">
      <button
        type="button"
        onClick={handleToggle}
        className="flex w-full items-center gap-2 p-3 text-left hover:bg-muted/40"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{question.questionText}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span className="rounded-md bg-muted px-2 py-0.5">
              {QUESTION_TYPE_LABEL[question.questionType]}
            </span>
            <span className="rounded-md bg-muted px-2 py-0.5">{question.points} poin</span>
            {!question.isActive && (
              <span className="rounded-md bg-amber-100 px-2 py-0.5 font-medium text-amber-700">
                Nonaktif
              </span>
            )}
          </div>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            isExpanded && "rotate-180",
          )}
        />
      </button>

      <ExpandRegion expanded={isExpanded}>
        <div className="space-y-3 border-t p-3">
          {editing && !locked ? (
            <QuestionFormFields
              values={values}
              onChange={patch}
              remainingBudget={remainingBudget}
            />
          ) : (
            <QuestionPreview question={question} />
          )}
          {!locked && (
            <div className="flex flex-wrap gap-2">
              {editing ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-md"
                    disabled={isPending}
                    onClick={handleCancelEdit}
                  >
                    Batal
                  </Button>
                  <Button
                    size="sm"
                    className="rounded-md"
                    disabled={isPending}
                    onClick={handleSave}
                  >
                    {isPending ? "Menyimpan..." : "Simpan Perubahan"}
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="outline" className="rounded-md" onClick={handleEdit}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-md"
                    disabled={isPending}
                    onClick={handleToggleActive}
                  >
                    {question.isActive ? (
                      <>
                        <EyeOff className="mr-1.5 h-4 w-4" /> Nonaktifkan
                      </>
                    ) : (
                      <>
                        <Eye className="mr-1.5 h-4 w-4" /> Aktifkan
                      </>
                    )}
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="outline" className="rounded-md text-destructive">
                        <Trash2 className="mr-1.5 h-4 w-4" /> Hapus
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Hapus soal ini?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Aksi ini tidak bisa dibatalkan.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Batal</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete}>Hapus</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}
            </div>
          )}
        </div>
      </ExpandRegion>
    </div>
  );
}

function QuizListItem({
  quiz,
  questions,
  objectives,
  isExpanded,
  onToggle,
}: {
  quiz: QuizRow;
  questions: QuizQuestionRow[];
  objectives: LearningObjectiveRow[];
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [publishConfirm, setPublishConfirm] = useState(false);
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<QuizFormValues>(() => quizToFormValues(quiz));
  const [editorKey, setEditorKey] = useState(0);
  const [questionExpandedKey, setQuestionExpandedKey] = useState<string | null>(null);

  function patch(p: Partial<QuizFormValues>) {
    setValues((prev) => ({ ...prev, ...p }));
  }

  function handleToggle() {
    setEditing(false);
    setValues(quizToFormValues(quiz));
    setEditorKey((k) => k + 1);
    onToggle();
  }

  function handleEdit() {
    setEditing(true);
    setValues(quizToFormValues(quiz));
    setEditorKey((k) => k + 1);
  }

  function handleCancelEdit() {
    setEditing(false);
    setValues(quizToFormValues(quiz));
    setEditorKey((k) => k + 1);
  }

  function handleSaveChanges() {
    if (
      !values.title.trim() ||
      (!quiz.isPublished && !values.learningObjectiveId) ||
      !values.dueDate ||
      !values.dueTime
    ) {
      toast.error("Judul, TP, dan tenggat kuis wajib diisi.");
      return;
    }
    const formData = buildQuizFormData(values);
    formData.set("id", quiz.id);
    startTransition(async () => {
      const result = await requestQuizChange(() => updateQuiz(formData));
      if (result.ok) {
        toast.success(result.message);
        setEditing(false);
      } else {
        toast.error(result.message);
      }
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await requestQuizChange(() => deleteQuiz(quiz.id));
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    });
  }

  function handleToggleActive() {
    startTransition(async () => {
      const result = await requestQuizChange(() => setQuizActive(quiz.id, !quiz.isActive));
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    });
  }

  function handlePublish() {
    startTransition(async () => {
      const result = await requestQuizChange(() => publishQuiz(quiz.id));
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    });
  }

  function toggleQuestion(key: string) {
    setQuestionExpandedKey((cur) => (cur === key ? null : key));
  }

  const dueLabel = formatDueDateTime(quiz.dueAt);
  const remainingBudget = Math.max(0, 100 - quiz.totalPoints);
  const hasSubmissions = quiz.submissionCount > 0;
  const cannotDeactivate = quiz.isActive && hasSubmissions;

  return (
    <div className="@container rounded-md border">
      <button
        type="button"
        onClick={handleToggle}
        className="flex w-full items-center gap-2 p-3 text-left hover:bg-muted/40"
      >
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary-soft/50 @sm:h-9 @sm:w-9">
          <ListChecks className="h-3.5 w-3.5 @sm:h-4 @sm:w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{quiz.title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className={cn(
                "rounded-md px-2 py-0.5 font-semibold",
                QUIZ_STATUS_BADGE_CLASS[quiz.status],
              )}
            >
              {QUIZ_STATUS_LABEL[quiz.status]}
            </span>
            {quiz.quizType && (
              <span className="rounded-md bg-muted px-2 py-0.5">
                {QUIZ_TYPE_LABEL[quiz.quizType]}
              </span>
            )}
            {quiz.learningObjectiveTitle && (
              <span className="truncate rounded-md bg-muted px-2 py-0.5">
                {quiz.learningObjectiveTitle}
              </span>
            )}
            <span className="rounded-md bg-muted px-2 py-0.5">
              {quiz.questionCount} soal · {quiz.totalPoints}/100 poin
            </span>
            {dueLabel && (
              <span className="rounded-md bg-warning/15 px-2 py-0.5 text-warning">
                Tenggat {dueLabel}
              </span>
            )}
          </div>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            isExpanded && "rotate-180",
          )}
        />
      </button>

      <ExpandRegion expanded={isExpanded}>
        <div className="space-y-5 border-t p-4">
          <div className="space-y-3">
            {editing ? (
              <QuizFormFields
                locked={quiz.isPublished}
                values={values}
                onChange={patch}
                objectives={objectives}
                editorKey={editorKey}
              />
            ) : (
              <div className="space-y-2 rounded-md bg-muted/40 p-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Tipe: </span>
                  {quiz.quizType ? QUIZ_TYPE_LABEL[quiz.quizType] : "-"}
                </div>
                <div>
                  <span className="text-muted-foreground">TP: </span>
                  {quiz.learningObjectiveTitle ?? "-"}
                </div>
                {quiz.description && (
                  <div
                    className="rich-text-content text-muted-foreground"
                    dangerouslySetInnerHTML={{ __html: quiz.description }}
                  />
                )}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                  <span>⏱ Estimasi: {quiz.timerMinutes ? `${quiz.timerMinutes} Menit` : "-"}</span>
                  <span>Tenggat: {dueLabel ?? "-"}</span>
                  <span>KKM: {quiz.passingGrade ?? "-"}</span>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {editing ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-md"
                    disabled={isPending}
                    onClick={handleCancelEdit}
                  >
                    Batal
                  </Button>
                  <Button
                    size="sm"
                    className="rounded-md"
                    disabled={isPending}
                    onClick={handleSaveChanges}
                  >
                    {isPending ? "Menyimpan..." : "Simpan Edit"}
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="outline" className="rounded-md" onClick={handleEdit}>
                    Edit
                  </Button>
                  {quiz.isPublished && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-md"
                      disabled={isPending || cannotDeactivate}
                      title={
                        cannotDeactivate
                          ? "Kuis sudah memiliki jawaban. Gunakan tenggat untuk menutup pengerjaan."
                          : undefined
                      }
                      onClick={handleToggleActive}
                    >
                      {quiz.isActive ? (
                        <>
                          <EyeOff className="mr-1.5 h-4 w-4" /> Nonaktifkan
                        </>
                      ) : (
                        <>
                          <Eye className="mr-1.5 h-4 w-4" /> Aktifkan
                        </>
                      )}
                    </Button>
                  )}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-md text-destructive"
                        disabled={isPending || hasSubmissions}
                        title={
                          hasSubmissions
                            ? "Kuis tidak dapat dihapus karena sudah memiliki jawaban siswa."
                            : undefined
                        }
                      >
                        <Trash2 className="mr-1.5 h-4 w-4" /> Hapus
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Hapus kuis &quot;{quiz.title}&quot;?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Aksi ini tidak bisa dibatalkan. Semua soal di kuis ini akan ikut terhapus.
                          Kuis hanya bisa dihapus jika belum ada siswa yang mengerjakan.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Batal</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete}>Hapus</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  {!quiz.isPublished && (
                    <Button
                      size="sm"
                      className="rounded-md"
                      disabled={isPending || quiz.totalPoints !== 100}
                      title={
                        quiz.totalPoints !== 100
                          ? "Total bobot soal harus tepat 100 poin"
                          : undefined
                      }
                      onClick={() => setPublishConfirm(true)}
                    >
                      <UploadCloud className="mr-1.5 h-4 w-4" /> Publikasikan Kuis
                    </Button>
                  )}
                </>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {hasSubmissions
                ? `${quiz.submissionCount} jawaban tersimpan. Gunakan tenggat untuk menutup pengerjaan; kuis tidak dapat dinonaktifkan atau dihapus.`
                : "Nonaktifkan untuk menarik kuis yang belum dikerjakan siswa. Setelah ada jawaban, gunakan tenggat untuk menutup pengerjaan."}
            </p>
          </div>

          <div className="space-y-4 border-t pt-4">
            {quiz.isPublished && (
              <p className="rounded-lg bg-muted p-3 text-sm">
                Soal dikunci sejak publikasi untuk menjaga jawaban dan nilai siswa. Buat kuis baru
                jika ingin mengubah soal.
              </p>
            )}
            <div>
              <h3 className="font-display text-sm font-bold">Bank Soal</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Kelola daftar soal untuk kuis ini. Setiap soal punya bobot poin sendiri, dan total
                seluruh bobot harus mencapai 100 poin sebelum kuis bisa dipublikasikan.
              </p>
            </div>

            <div className="space-y-1.5 rounded-md border p-3">
              <div className="flex items-center justify-between text-xs font-medium">
                <span>Total Bobot Kuis</span>
                <span>{quiz.totalPoints} / 100 poin</span>
              </div>
              <Progress
                value={Math.min(100, quiz.totalPoints)}
                className={quiz.totalPoints === 100 ? "[&>div]:bg-emerald-500" : undefined}
              />
              {quiz.totalPoints !== 100 && (
                <p className="pt-1 text-xs text-amber-700">
                  ⚠ Kuis belum dapat dipublikasikan. Total bobot soal masih {quiz.totalPoints} dari
                  100 poin. Tambahkan {remainingBudget} poin lagi.
                </p>
              )}
            </div>

            {!quiz.isPublished && (
              <AddQuestionCard
                assignmentId={quiz.id}
                remainingBudget={remainingBudget}
                isExpanded={questionExpandedKey === ADD_QUESTION_KEY}
                onToggle={() => toggleQuestion(ADD_QUESTION_KEY)}
              />
            )}

            <div className="space-y-2">
              {questions.map((q) => (
                <QuestionListItem
                  locked={quiz.isPublished}
                  key={q.id}
                  question={q}
                  remainingBudget={
                    q.isActive ? Math.max(0, 100 - quiz.totalPoints + q.points) : 100
                  }
                  isExpanded={questionExpandedKey === q.id}
                  onToggle={() => toggleQuestion(q.id)}
                />
              ))}
              {questions.length === 0 && (
                <p className="text-sm text-muted-foreground">Belum ada soal di kuis ini.</p>
              )}
            </div>

            {!quiz.isPublished && (
              <div className="flex justify-center">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-md"
                  onClick={() => toggleQuestion(ADD_QUESTION_KEY)}
                >
                  <Plus className="mr-1.5 h-4 w-4" /> Tambah Pertanyaan
                </Button>
              </div>
            )}
          </div>
        </div>
      </ExpandRegion>
      <AlertDialog open={publishConfirm} onOpenChange={setPublishConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publikasikan kuis?</AlertDialogTitle>
            <AlertDialogDescription>
              Pastikan soal dan kunci jawaban sudah benar. Setelah dipublikasikan, soal, bobot, TP,
              dan pengaturan penilaian dikunci. Judul, instruksi, serta tenggat tetap dapat
              diperbarui.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Periksa Lagi</AlertDialogCancel>
            <AlertDialogAction disabled={isPending} onClick={handlePublish}>
              Publikasikan Kuis
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
