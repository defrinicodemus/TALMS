"use client";

import { useRef, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { publishAnnouncement } from "../actions";
import { ANNOUNCEMENT_CATEGORIES } from "@/lib/announcement-categories";

export function PublishAnnouncementForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await publishAnnouncement(formData);
      if (result.ok) {
        toast.success(result.message);
        formRef.current?.reset();
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <form ref={formRef} action={handleSubmit} className="mt-4 space-y-3">
      <div>
        <Label>Kategori</Label>
        <Select name="category" defaultValue="Umum">
          <SelectTrigger className="mt-1 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ANNOUNCEMENT_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Input name="title" className="rounded-none" placeholder="Judul pengumuman" required />
      <Textarea name="body" className="rounded-none" placeholder="Isi pengumuman..." rows={6} required />
      <Button type="submit" className="w-full rounded-none" disabled={isPending}>
        {isPending ? "Menerbitkan..." : "Terbitkan"}
      </Button>
    </form>
  );
}
