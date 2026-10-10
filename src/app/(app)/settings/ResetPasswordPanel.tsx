"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { resetPasswordToDefault } from "../users/actions";

type UserRow = { id: string; name: string; role: string; identifier: string | null };
const ROLE_LABELS: Record<string, string> = {
  student: "Siswa",
  teacher: "Guru",
  principal: "Kepala Sekolah",
  admin: "Admin",
};

export function ResetPasswordPanel({ users }: { users: UserRow[] }) {
  const [query, setQuery] = useState("");
  const [isPending, startTransition] = useTransition();
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return users.filter(
      (u) => u.name.toLowerCase().includes(q) || (u.identifier ?? "").toLowerCase().includes(q),
    );
  }, [users, query]);

  function handleReset(u: UserRow) {
    if (submitting.current || !u.identifier?.trim()) return;
    submitting.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const result = await resetPasswordToDefault(u.id);
        if (result.ok) {
          toast.success(result.message);
          setSelectedUser(null);
        } else {
          setError(result.message);
          toast.error(result.message);
        }
      } catch {
        setError("Hasil reset belum dapat dipastikan. Periksa akun sebelum mencoba kembali.");
      } finally {
        submitting.current = false;
      }
    });
  }

  return (
    <>
      <div className="mt-4">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari nama atau NISN/NIP..."
          aria-label="Cari pengguna berdasarkan nama atau NISN/NIP"
          disabled={isPending}
        />
      </div>
      {query.trim() && (
        <div className="mt-3 space-y-2">
          {results.length > 8 && (
            <p className="text-xs text-muted-foreground">
              Menampilkan 8 dari {results.length} pengguna. Persempit pencarian dengan nama atau
              NISN/NIP.
            </p>
          )}
          {results.slice(0, 8).map((u) => (
            <div
              key={u.id}
              className="flex items-center justify-between gap-3 rounded-none border px-3 py-2"
            >
              <div className="min-w-0">
                <div className="break-words text-sm font-medium">{u.name}</div>
                <div className="break-words text-xs text-muted-foreground">
                  {ROLE_LABELS[u.role] ?? u.role} · NISN/NIP: {u.identifier || "-"}
                </div>
                {!u.identifier?.trim() && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    NISN/NIP belum tersedia; reset otomatis tidak dapat dilakukan.
                  </p>
                )}
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="shrink-0 rounded-none"
                disabled={isPending || !u.identifier?.trim()}
                onClick={() => {
                  setError(null);
                  setSelectedUser(u);
                }}
              >
                Reset
              </Button>
            </div>
          ))}
          {results.length === 0 && (
            <p className="text-sm text-muted-foreground">Tidak ditemukan.</p>
          )}
        </div>
      )}
      <AlertDialog
        open={Boolean(selectedUser)}
        onOpenChange={(open) => {
          if (!open && !submitting.current) setSelectedUser(null);
        }}
      >
        <AlertDialogContent aria-busy={isPending}>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset password {selectedUser?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedUser && (ROLE_LABELS[selectedUser.role] ?? selectedUser.role)} · NISN/NIP:{" "}
              {selectedUser?.identifier}. Password akan dikembalikan ke NISN/NIP tersebut. Password
              sebelumnya akan diganti. Minta pengguna segera mengganti password setelah masuk.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Batal</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={(event) => {
                event.preventDefault();
                if (selectedUser) handleReset(selectedUser);
              }}
            >
              {isPending ? "Mereset..." : "Reset Password"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
