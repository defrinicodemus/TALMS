"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { ArrowUp, ArrowDown, LockKeyhole, Trash2 } from "lucide-react";
import type { TeacherClassSubject, CurriculumPlanData } from "@/lib/data/curriculum";
import type { LearningObjectiveUsage } from "@/lib/data/learning-objective-usage";
import {
  saveCurriculumPlan,
  deleteCurriculumPlan,
  addLearningObjective,
  updateLearningObjective,
  deleteLearningObjective,
  moveLearningObjective,
  inspectCurriculumUsage,
} from "./actions";

function comboKey(combo: TeacherClassSubject) {
  return `${combo.classId}:${combo.subjectId}`;
}

function usageText(usage: LearningObjectiveUsage) {
  return [
    `${usage.materials} Materi`,
    `${usage.assignments} Tugas`,
    `${usage.quizzes} Kuis`,
    ...(usage.meetings ? [`${usage.meetings} Jurnal Pertemuan`] : []),
  ].join(" • ");
}

type EditTarget = { kind: "cp" } | { kind: "tp"; id: string; title: string };
type EditWarning = { target: EditTarget; usage: LearningObjectiveUsage };
type ActionResult = { ok: boolean; message: string };

export function CurriculumManager({
  combos,
  plansByKey,
}: {
  combos: TeacherClassSubject[];
  plansByKey: Record<string, CurriculumPlanData>;
}) {
  const [selectedKey, setSelectedKey] = useState(comboKey(combos[0]));
  const selectedCombo = combos.find((c) => comboKey(c) === selectedKey)!;
  const plan = plansByKey[selectedKey];

  return (
    <div className="space-y-6">
      <Card className="@container rounded-md border-0 p-4 shadow-soft @sm:p-6">
        <Label htmlFor="curriculum-combo" className="text-xs">
          Kelas & Mata Pelajaran
        </Label>
        <Select value={selectedKey} onValueChange={setSelectedKey}>
          <SelectTrigger id="curriculum-combo" className="mt-1 w-full sm:w-80">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {combos.map((combo) => (
              <SelectItem key={comboKey(combo)} value={comboKey(combo)}>
                {combo.className} · {combo.subjectName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Card>
      <PlanEditor key={`${selectedKey}:${plan.id ?? "new"}`} combo={selectedCombo} plan={plan} />
    </div>
  );
}

function PlanEditor({ combo, plan }: { combo: TeacherClassSubject; plan: CurriculumPlanData }) {
  const [cpText, setCpText] = useState(plan.cpText);
  const [editingCp, setEditingCp] = useState(!plan.id);
  const [newTitle, setNewTitle] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [warning, setWarning] = useState<EditWarning | null>(null);
  const [isPending, startTransition] = useTransition();
  const nextNumber = Math.max(-1, ...plan.objectives.map((o) => o.sortOrder)) + 2;

  function runAction(work: () => Promise<ActionResult>, onSuccess?: () => void) {
    startTransition(async () => {
      try {
        const result = await work();
        if (!result.ok) {
          toast.error(result.message);
          return;
        }
        toast.success(result.message);
        onSuccess?.();
      } catch {
        toast.error("Perubahan gagal disimpan. Coba lagi.");
      }
    });
  }

  function beginEdit(target: EditTarget) {
    if (target.kind === "cp") {
      setCpText(plan.cpText);
      setEditingCp(true);
    } else {
      setEditingId(target.id);
      setEditTitle(target.title);
    }
  }

  function requestEdit(target: EditTarget) {
    if (!plan.id) {
      beginEdit(target);
      return;
    }
    const planId = plan.id;
    startTransition(async () => {
      try {
        const result = await inspectCurriculumUsage(
          planId,
          target.kind === "tp" ? target.id : undefined,
        );
        if (!result.ok) {
          toast.error(result.message);
        } else if (result.usage.isUsed) {
          setWarning({ target, usage: result.usage });
        } else {
          beginEdit(target);
        }
      } catch {
        toast.error("Gagal memeriksa penggunaan TP. Coba lagi.");
      }
    });
  }

  function planFormData() {
    const formData = new FormData();
    formData.set("class_id", combo.classId);
    formData.set("subject_id", combo.subjectId);
    return formData;
  }

  function saveCp() {
    const formData = planFormData();
    formData.set("cp_text", cpText);
    runAction(
      () => saveCurriculumPlan(formData),
      () => setEditingCp(false),
    );
  }

  function addObjective() {
    if (isPending || !newTitle.trim()) return;
    const formData = planFormData();
    formData.set("title", newTitle.trim());
    runAction(
      () => addLearningObjective(formData),
      () => setNewTitle(""),
    );
  }

  function saveObjective(id: string) {
    const formData = new FormData();
    formData.set("id", id);
    formData.set("title", editTitle.trim());
    runAction(
      () => updateLearningObjective(formData),
      () => setEditingId(null),
    );
  }

  return (
    <>
      <Card className="@container rounded-md border-0 p-4 shadow-soft @sm:p-6">
        <h2 className="font-display text-base font-bold @sm:text-lg @md:text-xl">
          Capaian Pembelajaran (CP)
        </h2>
        <p className="text-sm text-muted-foreground">
          Masukkan CP dan TP dari perangkat pembelajaran yang Anda gunakan sebagai acuan aktivitas
          siswa.
        </p>
        {editingCp ? (
          <div className="space-y-3">
            <Label htmlFor="cp-text" className="sr-only">
              Isi Capaian Pembelajaran
            </Label>
            <Textarea
              id="cp-text"
              value={cpText}
              onChange={(e) => setCpText(e.target.value)}
              disabled={isPending}
              rows={5}
              className="text-sm"
              placeholder="Tuliskan capaian pembelajaran untuk kelas & mapel ini..."
            />
            <div className="flex flex-wrap gap-2">
              <Button disabled={isPending || !cpText.trim()} onClick={saveCp}>
                Simpan CP
              </Button>
              {plan.id && (
                <Button variant="outline" disabled={isPending} onClick={() => setEditingCp(false)}>
                  Batal
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="whitespace-pre-wrap break-words text-sm">
              {plan.cpText || "Isi CP belum ditambahkan."}
            </p>
            {plan.usage.isUsed && (
              <p className="text-xs text-muted-foreground">
                Memiliki TP yang digunakan · {usageText(plan.usage)}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={isPending}
                onClick={() => requestEdit({ kind: "cp" })}
              >
                {plan.cpText ? "Edit CP" : "Isi CP"}
              </Button>
              {plan.id && !plan.usage.isUsed && (
                <DeleteConfirmation
                  title="Hapus Capaian Pembelajaran?"
                  description="CP ini tidak memiliki TP yang digunakan dalam aktivitas pembelajaran. CP beserta seluruh TP di dalamnya akan dihapus secara permanen."
                  label="Hapus CP"
                  disabled={isPending}
                  onConfirm={() => runAction(() => deleteCurriculumPlan(plan.id!))}
                />
              )}
            </div>
          </div>
        )}
      </Card>

      <Card className="@container rounded-md border-0 p-4 shadow-soft @sm:p-6">
        <h2 className="font-display text-base font-bold @sm:text-lg @md:text-xl">
          Tujuan Pembelajaran (TP)
        </h2>
        <p className="text-sm text-muted-foreground">
          Urutan TP membentuk Learning Path siswa. TP yang sudah digunakan dikunci urutannya.
        </p>
        <div className="space-y-3">
          {plan.objectives.map((objective, index) => {
            const number = objective.sortOrder + 1;
            const isUsed = objective.usage.isUsed;
            const canMoveUp = index > 0 && !plan.objectives[index - 1].usage.isUsed;
            const canMoveDown =
              index < plan.objectives.length - 1 && !plan.objectives[index + 1].usage.isUsed;
            const editing = editingId === objective.id;
            return (
              <div key={objective.id} className="space-y-3 rounded-md border p-3 @sm:p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold">TP {number}</span>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {isUsed && (
                      <span title="Urutan TP dikunci karena sudah digunakan dalam aktivitas pembelajaran.">
                        <LockKeyhole
                          className="h-3.5 w-3.5"
                          aria-label="Urutan TP dikunci karena sudah digunakan dalam aktivitas pembelajaran."
                        />
                      </span>
                    )}
                    {isUsed ? "Digunakan" : "Belum digunakan"}
                  </span>
                </div>
                {editing ? (
                  <div className="space-y-2">
                    <Label htmlFor={`edit-${objective.id}`} className="sr-only">
                      Isi TP {number}
                    </Label>
                    <Textarea
                      id={`edit-${objective.id}`}
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      disabled={isPending}
                      autoFocus
                      rows={3}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={isPending || !editTitle.trim()}
                        onClick={() => saveObjective(objective.id)}
                      >
                        Simpan TP
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => setEditingId(null)}
                      >
                        Batal
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap break-words text-sm">{objective.title}</p>
                )}
                {isUsed && (
                  <p className="text-xs text-muted-foreground">{usageText(objective.usage)}</p>
                )}
                {!editing && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isPending || editingId !== null}
                      aria-label={`Edit TP ${number}`}
                      onClick={() =>
                        requestEdit({ kind: "tp", id: objective.id, title: objective.title })
                      }
                    >
                      Edit
                    </Button>
                    {!isUsed && (
                      <>
                        <DeleteConfirmation
                          title="Hapus Tujuan Pembelajaran?"
                          description="TP ini belum digunakan dalam aktivitas pembelajaran. TP akan dihapus secara permanen."
                          label={`Hapus TP ${number}`}
                          compact
                          disabled={isPending || editingId !== null}
                          onConfirm={() => runAction(() => deleteLearningObjective(objective.id))}
                        />
                        <div className="ml-auto flex gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            aria-label={`Pindahkan TP ${number} ke atas`}
                            title="Pindahkan ke atas"
                            disabled={isPending || editingId !== null || !canMoveUp}
                            onClick={() =>
                              runAction(() => moveLearningObjective(objective.id, "up"))
                            }
                          >
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            aria-label={`Pindahkan TP ${number} ke bawah`}
                            title="Pindahkan ke bawah"
                            disabled={isPending || editingId !== null || !canMoveDown}
                            onClick={() =>
                              runAction(() => moveLearningObjective(objective.id, "down"))
                            }
                          >
                            <ArrowDown className="h-4 w-4" />
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {plan.objectives.length === 0 && (
            <p className="text-sm text-muted-foreground">Belum ada Tujuan Pembelajaran.</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-objective">Tambah TP baru</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="new-objective"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder={`TP ${nextNumber}: ...`}
              disabled={isPending}
              className="min-w-0 flex-1"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addObjective();
                }
              }}
            />
            <Button
              className="shrink-0"
              disabled={isPending || !newTitle.trim()}
              onClick={addObjective}
            >
              + Tambah TP
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            TP baru ditambahkan di akhir. Susun TP yang belum digunakan tanpa melewati TP yang
            urutannya dikunci.
          </p>
        </div>
      </Card>

      <AlertDialog
        open={warning !== null}
        onOpenChange={(open) => {
          if (!open) setWarning(null);
        }}
      >
        <AlertDialogContent className="max-h-[90dvh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {warning?.target.kind === "cp"
                ? "Capaian Pembelajaran Sudah Digunakan"
                : "Tujuan Pembelajaran Sudah Digunakan"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  {warning?.target.kind === "cp"
                    ? "CP ini memiliki TP yang sudah digunakan dalam aktivitas pembelajaran. Pastikan perubahan tidak mengubah konteks pembelajaran yang telah berjalan."
                    : "TP ini sudah digunakan dalam aktivitas pembelajaran."}
                </p>
                {warning && (
                  <p className="font-medium text-foreground">{usageText(warning.usage)}</p>
                )}
                {warning?.target.kind === "tp" && (
                  <>
                    <p>
                      Perubahan pada TP akan terlihat pada materi, tugas, kuis, dan Learning Path
                      yang masih terhubung dengan TP ini.
                    </p>
                    <p>
                      Pastikan perubahan hanya berupa koreksi penulisan atau perbaikan yang tidak
                      mengubah makna tujuan pembelajaran.
                    </p>
                    <p>
                      Jika tujuan pembelajaran yang diinginkan berbeda secara substansial, sebaiknya
                      buat TP baru agar aktivitas pembelajaran yang sudah ada tetap sesuai dengan
                      tujuan sebelumnya.
                    </p>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (warning) beginEdit(warning.target);
              }}
            >
              Tetap Edit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function DeleteConfirmation({
  title,
  description,
  label,
  disabled,
  compact = false,
  onConfirm,
}: {
  title: string;
  description: string;
  label: string;
  disabled: boolean;
  compact?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size={compact ? "sm" : "default"}
          className="text-destructive"
          disabled={disabled}
          aria-label={label}
        >
          <Trash2 className="h-4 w-4" />
          {compact ? "Hapus" : label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Batal</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={disabled}
            onClick={onConfirm}
          >
            Hapus
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
