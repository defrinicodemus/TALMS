"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { updateOwnProfile } from "../actions";

const AVATAR_EMOJI_OPTIONS = [
  "🙂",
  "😀",
  "😎",
  "🤩",
  "🥳",
  "😺",
  "🐶",
  "🐱",
  "🦁",
  "🐯",
  "🐻",
  "🐼",
  "🦊",
  "🐨",
  "🐰",
  "🦄",
  "🐷",
  "🐔",
  "🦋",
  "🌟",
  "⭐",
  "🎈",
  "🍀",
  "🌈",
];

export function EditProfileDialog({
  name,
  avatar,
  isAdmin,
}: {
  name: string;
  avatar: string | null;
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"photo" | "avatar">("avatar");
  const [emoji, setEmoji] = useState(
    avatar && AVATAR_EMOJI_OPTIONS.includes(avatar) ? avatar : AVATAR_EMOJI_OPTIONS[0],
  );
  const [isPending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    if (next) {
      setMode("avatar");
      setEmoji(avatar && AVATAR_EMOJI_OPTIONS.includes(avatar) ? avatar : AVATAR_EMOJI_OPTIONS[0]);
    }
    setOpen(next);
  }

  function handleSubmit(formData: FormData) {
    formData.set("avatar_emoji", emoji);
    startTransition(async () => {
      const result = await updateOwnProfile(formData);
      if (result.ok) {
        toast.success(result.message);
        setOpen(false);
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-12 justify-start rounded-md">
          Data Diri
        </Button>
      </DialogTrigger>
      <DialogContent dismissOnOverlayOnly={isAdmin} className="rounded-md">
        <DialogHeader>
          <DialogTitle>Data Diri</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="space-y-4">
          {isAdmin && (
            <div>
              <Label>Nama Lengkap</Label>
              <Input name="full_name" defaultValue={name} className="mt-1" required />
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="radio"
                id="profile-mode-photo"
                checked={mode === "photo"}
                onChange={() => setMode("photo")}
                className="size-4 accent-primary"
              />
              <Label htmlFor="profile-mode-photo" className="cursor-pointer">
                Foto Profil
              </Label>
            </div>
            <div
              className={cn(
                "flex items-center gap-3 rounded-md border p-3 transition-opacity",
                mode !== "photo" && "opacity-50",
              )}
            >
              <div className="grid size-14 shrink-0 place-items-center rounded-md bg-muted text-2xl">
                🖼️
              </div>
              <div className="min-w-0">
                <Button type="button" variant="outline" size="sm" className="rounded-md" disabled>
                  Pilih Foto
                </Button>
                <p className="mt-1 text-xs text-muted-foreground">Maks. ukuran file 2MB</p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="radio"
                id="profile-mode-avatar"
                checked={mode === "avatar"}
                onChange={() => setMode("avatar")}
                className="size-4 accent-primary"
              />
              <Label htmlFor="profile-mode-avatar" className="cursor-pointer">
                Avatar
              </Label>
            </div>
            <div
              className={cn(
                "grid grid-cols-6 gap-2 rounded-md border p-3 transition-opacity",
                mode !== "avatar" && "opacity-50",
              )}
            >
              {AVATAR_EMOJI_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  disabled={mode !== "avatar"}
                  onClick={() => setEmoji(option)}
                  className={cn(
                    "grid h-10 w-10 place-items-center rounded-md border text-xl transition",
                    emoji === option
                      ? "border-primary bg-primary-soft/60"
                      : "border-transparent bg-muted/50 hover:bg-muted",
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <Button type="submit" className="w-full rounded-md" disabled={isPending}>
            {isPending ? "Menyimpan..." : "Simpan"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
