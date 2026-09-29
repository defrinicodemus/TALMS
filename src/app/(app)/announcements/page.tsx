import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { listAnnouncementsPage } from "@/lib/data/announcements";
import { getCurrentUser } from "@/lib/data/profile";
import { getCategoryBadgeClass } from "@/lib/announcement-categories";
import { PublishAnnouncementForm } from "./PublishAnnouncementForm";

const PAGE_SIZE = 5;

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function getPageNumbers(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "ellipsis")[] = [1];
  if (current > 3) pages.push("ellipsis");
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) {
    pages.push(p);
  }
  if (current < total - 2) pages.push("ellipsis");
  pages.push(total);
  return pages;
}

export default async function AnnouncementsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);

  const [{ items, totalCount }, user] = await Promise.all([
    listAnnouncementsPage(page, PAGE_SIZE),
    getCurrentUser(),
  ]);
  const isAdmin = user?.role === "admin";
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <PageHeader
        icon="📣"
        title="Pengumuman"
        subtitle={isAdmin ? "Buat dan kelola pengumuman sekolah" : "Daftar pengumuman sekolah"}

      />
      <div className="grid gap-6 lg:grid-cols-3">
        {isAdmin && (
          <Card className="@container rounded-none border-0 p-4 shadow-soft @sm:p-6 lg:col-span-1">
            <h2 className="font-display text-base font-bold @sm:text-lg @md:text-xl">
              Buat Pengumuman
            </h2>
            <PublishAnnouncementForm />
          </Card>
        )}
        <div className={isAdmin ? "space-y-3 lg:col-span-2" : "space-y-3 lg:col-span-3"}>
          {items.map((a) => (
            <Card key={a.id} className="@container rounded-none border-0 p-4 shadow-soft @sm:p-6">
              <span
                className={`inline-flex w-fit rounded-none px-2.5 py-0.5 text-[10px] font-semibold @sm:text-xs ${getCategoryBadgeClass(a.category)}`}
              >
                {a.category}
              </span>
              <h3 className="mt-2 font-display text-base font-bold @sm:text-lg @md:text-xl">
                {a.title}
              </h3>
              <div className="mt-1 text-[11px] text-muted-foreground @sm:text-xs">
                {formatDate(a.created_at)}
              </div>
              <p className="mt-2 line-clamp-2 text-[13px] text-muted-foreground @sm:text-sm">
                {a.body}
              </p>
              <Link
                href={`/announcements/${a.id}?page=${page}`}
                className="mt-3 inline-block text-[13px] font-medium text-primary hover:underline @sm:text-sm"
              >
                Baca Selengkapnya →
              </Link>
            </Card>
          ))}
          {items.length === 0 && (
            <p className="text-sm text-muted-foreground">Belum ada pengumuman.</p>
          )}

          {totalPages > 1 && (
            <div className="@container flex justify-center pt-4">
              <div className="flex items-center gap-1 rounded-full border bg-card p-1.5 shadow-soft">
                <PagChevron page={page - 1} disabled={page <= 1} direction="prev" />
                {getPageNumbers(page, totalPages).map((p, i) =>
                  p === "ellipsis" ? (
                    <span
                      key={`ellipsis-${i}`}
                      className="grid size-8 place-items-center text-sm text-muted-foreground @sm:size-9"
                    >
                      …
                    </span>
                  ) : (
                    <Link
                      key={p}
                      href={`/announcements?page=${p}`}
                      className={cn(
                        "grid size-8 place-items-center rounded-md text-[13px] font-medium transition-colors @sm:size-9 @sm:text-sm",
                        p === page
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      {p}
                    </Link>
                  ),
                )}
                <PagChevron page={page + 1} disabled={page >= totalPages} direction="next" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PagChevron({
  page,
  disabled,
  direction,
}: {
  page: number;
  disabled: boolean;
  direction: "prev" | "next";
}) {
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  const label = direction === "prev" ? "Halaman sebelumnya" : "Halaman selanjutnya";
  const base = "grid size-8 place-items-center rounded-none transition-colors @sm:size-9";

  if (disabled) {
    return (
      <span className={cn(base, "cursor-not-allowed text-muted-foreground opacity-40")}>
        <Icon className="size-4" />
        <span className="sr-only">{label}</span>
      </span>
    );
  }
  return (
    <Link
      href={`/announcements?page=${page}`}
      aria-label={label}
      className={cn(base, "text-muted-foreground hover:bg-muted hover:text-foreground")}
    >
      <Icon className="size-4" />
    </Link>
  );
}
