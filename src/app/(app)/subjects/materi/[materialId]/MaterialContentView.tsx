import type { MaterialContentRow } from "@/lib/data/subjects";
import { MaterialMedia } from "@/components/MaterialMedia";
import { sanitizeRichText } from "@/lib/sanitizeRichText";

export function MaterialContentView({ material: m }: { material: MaterialContentRow }) {
  return (
    <section aria-label="Isi materi" className="min-w-0 rounded-2xl bg-card p-4 shadow-soft sm:p-6">
      {m.kind === "text" ? (
        m.content ? (
          <div
            className="rich-text-content mx-auto max-w-3xl overflow-x-auto break-words text-base leading-relaxed"
            dangerouslySetInnerHTML={{ __html: sanitizeRichText(m.content) }}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Belum ada isi materi. Hubungi guru untuk memeriksanya.
          </p>
        )
      ) : m.url ? (
        <MaterialMedia key={m.url} kind={m.kind} url={m.url} title={m.title} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Konten belum tersedia. Hubungi guru untuk memeriksanya.
        </p>
      )}
    </section>
  );
}
