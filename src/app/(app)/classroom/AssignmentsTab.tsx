"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
  FileText,
  Camera,
  Type,
  Trash2,
  ChevronDown,
  ChevronUp,
  EyeOff,
  Eye,
  Paperclip,
  Download,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TeacherClassSubject } from "@/lib/data/teaching";
import type { LearningObjectiveRow } from "@/lib/data/curriculum";
import type { AssignmentMethod, AssignmentRow } from "@/lib/data/classroom";
import {
  ASSIGNMENT_MAX_PHOTO_MB,
  ASSIGNMENT_PHOTO_TYPES,
  formatAssignmentTime,
  assignmentTimeInputs,
} from "@/lib/assignmentConstants";
import { validateFileUpload } from "@/lib/validateUpload";
import {
  createAssignment,
  updateAssignment,
  deleteAssignment,
  setAssignmentActive,
  removeAssignmentAttachmentImage,
} from "./actions";

function comboKey(classId: string, subjectId: string) {
  return `${classId}:${subjectId}`;
}

const METHOD_LABEL: Record<AssignmentMethod, string> = {
  text: "Teks",
  photo: "Upload Foto",
};

const ADD_ASSIGNMENT_KEY = "__add_assignment__";

function methodIcon(methods: AssignmentMethod[]) {
  if (methods.length === 1 && methods[0] === "photo") return Camera;
  if (methods.length === 1 && methods[0] === "text") return Type;
  return FileText;
}

function validatePhoto(file: File) {
  const result = validateFileUpload(file, {
    allowedTypes: ASSIGNMENT_PHOTO_TYPES,
    maxSizeMB: ASSIGNMENT_MAX_PHOTO_MB,
  });
  if (!result.ok || !file.size) {
    toast.error(result.ok ? "Pilih gambar yang tidak kosong." : result.message);
    return false;
  }
  return true;
}

export function AssignmentsTab({
  combos,
  assignmentsByKey,
  objectivesByKey,
}: {
  combos: TeacherClassSubject[];
  assignmentsByKey: Record<string, AssignmentRow[]>;
  objectivesByKey: Record<string, LearningObjectiveRow[]>;
}) {
  const [selectedKey, setSelectedKey] = useState(comboKey(combos[0].classId, combos[0].subjectId));
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const selectedCombo = combos.find((c) => comboKey(c.classId, c.subjectId) === selectedKey)!;
  const assignments = assignmentsByKey[selectedKey] ?? [];
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

      <AddAssignmentCard
        key={selectedKey}
        classId={selectedCombo.classId}
        subjectId={selectedCombo.subjectId}
        objectives={objectives}
        isExpanded={expandedKey === ADD_ASSIGNMENT_KEY}
        onToggle={() => toggle(ADD_ASSIGNMENT_KEY)}
      />

      <Card className="rounded-md border-0 p-2 shadow-soft">
        <div className="space-y-1">
          {assignments.map((a) => (
            <AssignmentListItem
              key={a.id}
              assignment={a}
              objectives={objectives}
              isExpanded={expandedKey === a.id}
              onToggle={() => toggle(a.id)}
            />
          ))}
          {assignments.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">Belum ada tugas.</p>
          )}
        </div>
      </Card>
    </div>
  );
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="@container space-y-3 rounded-md border p-4">
      <div>
        <h4 className="text-sm font-semibold">{title}</h4>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}

function AddAssignmentCard({
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
  const [title, setTitle] = useState("");
  const [, setDescription] = useState("");
  const [methods, setMethods] = useState<AssignmentMethod[]>(["text"]);
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("23:59");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [isPending, startTransition] = useTransition();
  const [editorKey, setEditorKey] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  function toggleMethod(method: AssignmentMethod, checked: boolean) {
    setMethods((prev) =>
      checked ? [...prev.filter((m) => m !== method), method] : prev.filter((m) => m !== method),
    );
  }

  function resetForm() {
    formRef.current?.reset();
    setTitle("");
    setDescription("");
    setMethods(["text"]);
    setDueDate("");
    setDueTime("23:59");
    setImageFile(null);
    setEditorKey((k) => k + 1);
  }

  function handleSubmit(status: "draft" | "published") {
    if (!formRef.current) return;
    if (!formRef.current.reportValidity()) return;
    if (methods.length === 0) {
      toast.error("Pilih minimal satu teknik pengumpulan.");
      return;
    }

    const formData = new FormData(formRef.current);
    formData.set("class_id", classId);
    formData.set("subject_id", subjectId);
    formData.set("status", status);
    for (const m of methods) formData.append("allowed_methods", m);
    if (imageFile) formData.set("attachment_image", imageFile);

    startTransition(async () => {
      try {
        const result = await createAssignment(formData);
        if (result.ok) {
          toast.success(result.message);
          resetForm();
          onToggle();
        } else toast.error(result.message);
      } catch {
        toast.error(
          "Penyimpanan belum dapat dikonfirmasi. Isian tetap tersedia; periksa daftar tugas sebelum mencoba lagi.",
        );
      }
    });
  }

  const noObjectives = objectives.length === 0;
  const dueDateLabel = dueDate
    ? new Date(`${dueDate}T00:00:00`).toLocaleDateString("id-ID", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <Card className="@container overflow-hidden rounded-md border-0 shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 @sm:p-6">
        <div>
          <h3 className="font-display text-base font-bold @sm:text-lg @md:text-xl">
            Tambah Tugas Pembelajaran
          </h3>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Buat tugas lengkap dengan instruksi, teknik pengumpulan, jadwal, dan lampiran pendukung
            untuk siswa.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="shrink-0 rounded-md"
          onClick={onToggle}
          disabled={isPending}
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
        <div className="space-y-4 border-t px-4 pb-4 pt-4 @sm:px-6 @sm:pb-6">
          {noObjectives ? (
            <p className="text-sm text-muted-foreground">
              Belum ada Tujuan Pembelajaran (TP) untuk kelas & mapel ini. Isi dulu lewat menu Kelola
              Kurikulum.
            </p>
          ) : (
            <form ref={formRef} className="space-y-4" inert={isPending} aria-busy={isPending}>
              {/* 1. Informasi Dasar Tugas */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>Judul Tugas *</Label>
                  <Input
                    name="title"
                    className="mt-1"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                    maxLength={200}
                  />
                </div>
                <div>
                  <Label>Tujuan Pembelajaran (TP) *</Label>
                  <Select name="learning_objective_id" required>
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
                <Label>Deskripsi / Instruksi Tugas</Label>
                <div className="mt-1">
                  <RichTextEditor
                    key={editorKey}
                    name="description"
                    variant="simple"
                    placeholder="Tulis instruksi tugas untuk siswa di sini..."
                    onChange={setDescription}
                  />
                </div>
              </div>

              {/* 2. Pengaturan Pengumpulan */}
              <SectionCard
                title="Pengaturan Pengumpulan"
                description="Pilih metode yang diizinkan. Jika keduanya dipilih, siswa cukup mengirim teks atau satu foto."
              >
                <div className="flex flex-wrap gap-4">
                  {(["text", "photo"] as AssignmentMethod[]).map((m) => (
                    <label key={m} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={methods.includes(m)}
                        onCheckedChange={(checked) => toggleMethod(m, checked === true)}
                      />
                      {METHOD_LABEL[m]}
                    </label>
                  ))}
                </div>
                {methods.includes("photo") && (
                  <p className="text-xs text-muted-foreground">
                    Satu foto JPG, PNG, atau WebP, maksimal {ASSIGNMENT_MAX_PHOTO_MB} MB.
                  </p>
                )}
              </SectionCard>

              {/* 3. Jadwal Tugas */}
              <SectionCard
                title="Jadwal Tugas"
                description="Semua waktu menggunakan WITA. Setelah tenggat, pengumpulan dan perubahan jawaban ditutup. Guru dapat memperpanjang tenggat lewat Edit."
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label>Batas Pengumpulan *</Label>
                    <Input
                      name="due_date"
                      type="date"
                      className="mt-1"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <Label>Jam Batas Pengumpulan (WITA) *</Label>
                    <Input
                      name="due_time"
                      type="time"
                      className="mt-1"
                      value={dueTime}
                      onChange={(e) => setDueTime(e.target.value)}
                      required
                    />
                  </div>
                </div>
              </SectionCard>

              {/* 4. Lampiran Guru (Opsional) */}
              <SectionCard
                title="Lampiran Guru (Opsional)"
                description={`Siswa bisa membuka lampiran ini sebelum mengerjakan. Maksimal 1 gambar JPG, PNG, atau WebP, ${ASSIGNMENT_MAX_PHOTO_MB} MB.`}
              >
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const selected = e.target.files?.[0] ?? null;
                    e.target.value = "";
                    if (selected && validatePhoto(selected)) setImageFile(selected);
                  }}
                />
                {imageFile ? (
                  <ul className="space-y-1.5">
                    <PendingFileRow name={imageFile.name} onRemove={() => setImageFile(null)} />
                  </ul>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-md"
                    onClick={() => imageInputRef.current?.click()}
                  >
                    <Paperclip className="mr-1.5 h-4 w-4" /> Upload Gambar
                  </Button>
                )}
              </SectionCard>

              {/* 5. Preview Ringkas */}
              <div className="rounded-md bg-primary-soft/20 p-4">
                <h4 className="font-display text-sm font-bold">Ringkasan Tugas</h4>
                <div className="mt-2 space-y-1 text-sm">
                  <div>
                    <span className="text-muted-foreground">Judul: </span>
                    {title.trim() || "-"}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Metode: </span>
                    {methods.length > 0
                      ? methods.map((m) => `✓ ${METHOD_LABEL[m]}`).join("  ")
                      : "-"}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Deadline: </span>
                    {dueDateLabel ? `${dueDateLabel} - ${dueTime} WITA` : "-"}
                  </div>
                </div>
              </div>

              {/* 6. Tombol Aksi */}
              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="rounded-md"
                  disabled={isPending}
                  onClick={() => handleSubmit("draft")}
                >
                  {isPending ? "Menyimpan..." : "Simpan Draft"}
                </Button>
                <Button
                  type="button"
                  className="rounded-md"
                  disabled={isPending}
                  onClick={() => handleSubmit("published")}
                >
                  {isPending ? "Menyimpan..." : "Publikasikan Tugas"}
                </Button>
              </div>
            </form>
          )}
        </div>
      </ExpandRegion>
    </Card>
  );
}

function PendingFileRow({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <li className="flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-1.5 text-sm">
      <span className="truncate">{name}</span>
      <button
        type="button"
        onClick={onRemove}
        className="shrink-0 text-muted-foreground hover:text-destructive"
        aria-label={`Hapus ${name}`}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

function AssignmentListItem({
  assignment,
  objectives,
  isExpanded,
  onToggle,
}: {
  assignment: AssignmentRow;
  objectives: LearningObjectiveRow[];
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const Icon = methodIcon(assignment.allowedMethods);
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(assignment.title);
  const [description, setDescription] = useState(assignment.description ?? "");
  const [dueDate, setDueDate] = useState(assignmentTimeInputs(assignment.dueAt).date);
  const [dueTime, setDueTime] = useState(assignmentTimeInputs(assignment.dueAt).time);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [learningObjectiveId, setLearningObjectiveId] = useState(
    assignment.learningObjectiveId ?? "",
  );
  const [editorKey, setEditorKey] = useState(0);

  function handleToggle() {
    setEditing(false);
    setTitle(assignment.title);
    setDescription(assignment.description ?? "");
    setDueDate(assignmentTimeInputs(assignment.dueAt).date);
    setDueTime(assignmentTimeInputs(assignment.dueAt).time);
    setImageFile(null);
    setLearningObjectiveId(assignment.learningObjectiveId ?? "");
    setEditorKey((k) => k + 1);
    onToggle();
  }

  function handleSaveChanges() {
    const formData = new FormData();
    formData.set("id", assignment.id);
    formData.set("title", title);
    formData.set("description", description);
    formData.set("learning_objective_id", learningObjectiveId);
    if (dueDate || assignment.dueAt) {
      formData.set("due_date", dueDate);
      formData.set("due_time", dueTime);
    }
    if (imageFile) formData.set("attachment_image", imageFile);
    startTransition(async () => {
      try {
        const result = await updateAssignment(formData);
        if (result.ok) {
          toast.success(result.message);
          setEditing(false);
          setImageFile(null);
        } else toast.error(result.message);
      } catch {
        toast.error(
          "Perubahan belum dapat dikonfirmasi. Isian tetap tersedia; muat ulang untuk memeriksa.",
        );
      }
    });
  }

  function handleDelete() {
    startTransition(async () => {
      try {
        const result = await deleteAssignment(assignment.id);
        if (result.ok) toast.success(result.message);
        else toast.error(result.message);
      } catch {
        toast.error("Penghapusan belum dapat dikonfirmasi. Muat ulang untuk memeriksa.");
      }
    });
  }

  function handleToggleActive() {
    startTransition(async () => {
      try {
        const result = await setAssignmentActive(assignment.id, !assignment.isPublished);
        if (result.ok) toast.success(result.message);
        else toast.error(result.message);
      } catch {
        toast.error("Status tugas belum dapat diperbarui. Coba lagi.");
      }
    });
  }

  function handleRemoveAttachmentImage() {
    startTransition(async () => {
      try {
        const result = await removeAssignmentAttachmentImage(assignment.id);
        if (result.ok) toast.success(result.message);
        else toast.error(result.message);
      } catch {
        toast.error("Lampiran belum dapat dihapus. Coba lagi.");
      }
    });
  }

  const dueLabel = formatAssignmentTime(assignment.dueAt);
  const hasSubmissions = assignment.submissionCount > 0;
  const cannotDeactivate = assignment.isPublished && hasSubmissions;

  return (
    <div className="@container rounded-md border">
      <button
        type="button"
        onClick={handleToggle}
        disabled={isPending}
        className="flex w-full items-center gap-2 p-3 text-left hover:bg-muted/40"
      >
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary-soft/50 @sm:h-9 @sm:w-9">
          <Icon className="h-3.5 w-3.5 @sm:h-4 @sm:w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{assignment.title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {assignment.allowedMethods.map((m) => (
              <span key={m} className="rounded-md bg-muted px-2 py-0.5">
                {METHOD_LABEL[m]}
              </span>
            ))}
            {assignment.learningObjectiveTitle && (
              <span className="truncate rounded-md bg-muted px-2 py-0.5">
                {assignment.learningObjectiveTitle}
              </span>
            )}
            {dueLabel && (
              <span className="rounded-md bg-warning/15 px-2 py-0.5 text-warning">
                Tenggat {dueLabel}
              </span>
            )}
            {!assignment.isPublished && (
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
        <div className="space-y-3 border-t p-4">
          {editing ? (
            <div className="space-y-3" inert={isPending} aria-busy={isPending}>
              <div>
                <Label>Judul Tugas</Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1"
                  maxLength={200}
                />
              </div>
              <div>
                <Label>Tujuan Pembelajaran (TP)</Label>
                <Select value={learningObjectiveId} onValueChange={setLearningObjectiveId}>
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
              <div>
                <Label>Deskripsi / Instruksi Tugas</Label>
                <div className="mt-1">
                  <RichTextEditor
                    key={editorKey}
                    name="description"
                    variant="simple"
                    defaultValue={assignment.description ?? ""}
                    placeholder="Tulis instruksi tugas untuk siswa di sini..."
                    onChange={setDescription}
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Batas Pengumpulan</Label>
                  <Input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Jam Batas (WITA)</Label>
                  <Input
                    type="time"
                    value={dueTime}
                    onChange={(e) => setDueTime(e.target.value)}
                    className="mt-1"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Perpanjang tenggat untuk membuka kembali pengumpulan. Jawaban yang sudah dinilai
                tetap terkunci.
              </p>
              <div className="space-y-2">
                <Label>
                  {assignment.attachmentImageUrl ? "Ganti Lampiran Guru" : "Tambah Lampiran Guru"}
                </Label>
                <Input
                  type="file"
                  accept={ASSIGNMENT_PHOTO_TYPES.join(",")}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file && validatePhoto(file)) setImageFile(file);
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Maksimal {ASSIGNMENT_MAX_PHOTO_MB} MB. Lampiran lama dipertahankan sampai
                  perubahan berhasil disimpan.
                </p>
                {imageFile && (
                  <ul>
                    <PendingFileRow name={imageFile.name} onRemove={() => setImageFile(null)} />
                  </ul>
                )}
              </div>
            </div>
          ) : (
            <>
              {assignment.description ? (
                <div
                  className="rich-text-content rounded-md bg-muted/40 p-3 text-sm text-muted-foreground"
                  dangerouslySetInnerHTML={{ __html: assignment.description }}
                />
              ) : (
                <p className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
                  Tidak ada instruksi tambahan.
                </p>
              )}
              {assignment.allowedMethods.includes("photo") && (
                <p className="text-xs text-muted-foreground">
                  Maksimal ukuran foto: {ASSIGNMENT_MAX_PHOTO_MB} MB
                </p>
              )}
              {assignment.attachmentImageUrl && (
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Lampiran
                  </Label>
                  <ul className="mt-1.5 space-y-1.5">
                    <li className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm">
                      <a
                        href={assignment.attachmentImageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex min-w-0 items-center gap-1.5 text-primary hover:underline"
                      >
                        <Download className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">
                          {assignment.attachmentImageName ?? "Lampiran"}
                        </span>
                      </a>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={isPending}
                            aria-label="Hapus lampiran"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Hapus lampiran guru?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Lampiran tidak lagi ditampilkan pada tugas. Jawaban siswa tetap
                              tersimpan.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Batal</AlertDialogCancel>
                            <AlertDialogAction onClick={handleRemoveAttachmentImage}>
                              Hapus Lampiran
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </li>
                  </ul>
                </div>
              )}
            </>
          )}

          <div className="flex flex-wrap gap-2">
            {editing && (
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() => {
                  setEditing(false);
                  setTitle(assignment.title);
                  setDescription(assignment.description ?? "");
                  setLearningObjectiveId(assignment.learningObjectiveId ?? "");
                  setDueDate(assignmentTimeInputs(assignment.dueAt).date);
                  setDueTime(assignmentTimeInputs(assignment.dueAt).time);
                  setImageFile(null);
                  setEditorKey((k) => k + 1);
                }}
              >
                Batal Edit
              </Button>
            )}
            {editing ? (
              <Button
                size="sm"
                className="rounded-md"
                disabled={isPending || !title.trim() || !learningObjectiveId}
                onClick={handleSaveChanges}
              >
                {isPending ? "Menyimpan..." : "Simpan Perubahan"}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="rounded-md"
                disabled={isPending}
                onClick={() => {
                  setDueDate(assignmentTimeInputs(assignment.dueAt).date);
                  setDueTime(assignmentTimeInputs(assignment.dueAt).time);
                  setEditing(true);
                }}
              >
                Edit
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="rounded-md"
              disabled={isPending || editing || cannotDeactivate}
              title={
                cannotDeactivate
                  ? "Tugas sudah memiliki pengumpulan. Gunakan tenggat untuk menutup pengumpulan."
                  : undefined
              }
              onClick={handleToggleActive}
            >
              {assignment.isPublished ? (
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
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-md text-destructive"
                  disabled={isPending || editing || hasSubmissions}
                  title={
                    hasSubmissions
                      ? "Tugas tidak dapat dihapus karena sudah memiliki pengumpulan siswa."
                      : undefined
                  }
                >
                  <Trash2 className="mr-1.5 h-4 w-4" /> Hapus
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Hapus tugas &quot;{assignment.title}&quot;?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Aksi ini tidak bisa dibatalkan. Tugas hanya bisa dihapus jika belum ada siswa
                    yang mengumpulkan.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Batal</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete}>Hapus</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
          <p className="text-xs text-muted-foreground">
            {hasSubmissions
              ? `${assignment.submissionCount} pengumpulan tersimpan. Gunakan tenggat untuk menutup pengumpulan; tugas tidak dapat dinonaktifkan atau dihapus.`
              : "Nonaktifkan menyembunyikan tugas dari siswa. Untuk menutup pengumpulan sambil tetap menampilkan jawaban dan nilai, gunakan tenggat."}
          </p>
        </div>
      </ExpandRegion>
    </div>
  );
}
