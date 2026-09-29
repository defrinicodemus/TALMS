"use client";

import { useMemo, useState, useTransition } from "react";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { resetPasswordToDefault } from "../users/actions";

type UserRow = { id: string; name: string; role: string; identifier: string | null };

export function ResetPasswordPanel({ users }: { users: UserRow[] }) {
  const [query, setQuery] = useState("");
  const [isPending, startTransition] = useTransition();
  const [resettingId, setResettingId] = useState<string | null>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return users
      .filter(
        (u) => u.name.toLowerCase().includes(q) || (u.identifier ?? "").toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [users, query]);

  function handleReset(u: UserRow) {
    setResettingId(u.id);
    startTransition(async () => {
      const result = await resetPasswordToDefault(u.id);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
      setResettingId(null);
    });
  }

  return (
    <>
      <div className="mt-4">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari nama atau NISN/NIP..."
        />
      </div>
      {query.trim() && (
        <div className="mt-3 space-y-2">
          {results.map((u) => (
            <div
              key={u.id}
              className="flex items-center justify-between gap-3 rounded-none border px-3 py-2"
            >
              <div>
                <div className="text-sm font-medium">{u.name}</div>
                <div className="text-xs capitalize text-muted-foreground">
                  {u.role} · {u.identifier ?? "-"}
                </div>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-none"
                    disabled={isPending && resettingId === u.id}
                  >
                    {isPending && resettingId === u.id ? "Mereset..." : "Reset"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reset password {u.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Password akan dikembalikan ke NISN/NIP default mereka ({u.identifier ?? "-"}
                      ). Password lama tidak akan berfungsi lagi.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Batal</AlertDialogCancel>
                    <AlertDialogAction onClick={() => handleReset(u)}>Reset</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))}
          {results.length === 0 && (
            <p className="text-sm text-muted-foreground">Tidak ditemukan.</p>
          )}
        </div>
      )}
    </>
  );
}
