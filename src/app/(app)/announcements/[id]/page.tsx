import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { getAnnouncementById } from "@/lib/data/announcements";
import { getCurrentUser } from "@/lib/data/profile";
import { getCategoryBadgeClass } from "@/lib/announcement-categories";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default async function AnnouncementDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params;
  const { page } = await searchParams;
  const [announcement, user] = await Promise.all([getAnnouncementById(id), getCurrentUser()]);
  if (!announcement) notFound();

  const backHref = page ? `/announcements?page=${page}` : "/announcements";

  return (
    <div className="space-y-6">
      <PageHeader
        icon="📣"
        title="Detail Pengumuman"
        rounded={user?.role === "admin" ? "none" : "blunt"}
      />
      <Link
        href={backHref}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
      >
        <ArrowLeft className="h-4 w-4" /> Kembali ke Pengumuman
      </Link>
      <Card className="@container rounded-md border-0 p-4 shadow-soft @sm:p-6 @lg:p-8">
        <span
          className={`inline-flex w-fit rounded-md px-2.5 py-0.5 text-[10px] font-semibold @sm:text-xs ${getCategoryBadgeClass(announcement.category)}`}
        >
          {announcement.category}
        </span>
        <h1 className="mt-3 font-display text-base font-bold @sm:text-lg @md:text-xl">
          {announcement.title}
        </h1>
        <div className="mt-2 text-[11px] text-muted-foreground @sm:text-xs">
          {formatDate(announcement.created_at)}
        </div>
        <p className="mt-6 whitespace-pre-wrap text-[13px] leading-relaxed @sm:text-sm">
          {announcement.body}
        </p>
      </Card>
    </div>
  );
}
