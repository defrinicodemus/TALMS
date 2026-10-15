function parseWebUrl(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
      ? url
      : null;
  } catch {
    return null;
  }
}

export function extractYoutubeId(value: string): string | null {
  const url = parseWebUrl(value);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.split("/")[1];
  else if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host)) {
    id =
      url.pathname === "/watch"
        ? url.searchParams.get("v")
        : (url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)\/?$/)?.[1] ?? null);
  }
  return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
}

export function getGoogleSlidesEmbedUrl(value: string): string | null {
  const url = parseWebUrl(value);
  if (!url || url.hostname !== "docs.google.com") return null;
  const match = url.pathname.match(
    /^\/presentation\/(?:u\/\d+\/)?d\/(e\/)?([a-zA-Z0-9_-]+)(?:\/(?:edit|view|preview|present|pub|pubembed|embed))?\/?$/,
  );
  // "e" by itself is the broken URL produced by the previous published-link parser.
  if (
    !match ||
    ["e", "embed", "pub", "pubembed", "edit", "view", "preview", "present"].includes(match[2])
  )
    return null;
  return `https://docs.google.com/presentation/d/${match[1] ?? ""}${match[2]}/embed`;
}

export function getCanvaEmbedUrl(value: string): string | null {
  const url = parseWebUrl(value);
  if (!url || !["canva.com", "www.canva.com"].includes(url.hostname) || url.port) return null;
  // Public/smart embed links may include a share token between the design ID and /view.
  // Preserve that token; never embed the editor or accept arbitrary pasted HTML.
  const match = url.pathname.match(/^\/design\/([a-zA-Z0-9_-]+)(\/[a-zA-Z0-9_-]+)?\/view\/?$/);
  if (!match) return null;
  return `https://www.canva.com/design/${match[1]}${match[2] ?? ""}/view?embed`;
}

export const SLIDESHOW_LINK_ERROR =
  "Gunakan tautan Google Slides atau tautan tampilan/embed Canva (/view), bukan tautan edit Canva atau kode HTML.";

export function getMaterialMediaUrl(kind: string, value: string): string | null {
  if (kind === "video") {
    const id = extractYoutubeId(value);
    return id ? `https://www.youtube.com/embed/${id}` : null;
  }
  if (kind === "slideshow") return getGoogleSlidesEmbedUrl(value) ?? getCanvaEmbedUrl(value);
  if (kind === "pdf" || kind === "image") {
    // blob URLs are created locally for a selected file, never fetched by the server.
    if (value.startsWith("blob:")) return value;
    return parseWebUrl(value)?.href ?? null;
  }
  return null;
}

export function getMaterialOpenUrl(kind: string, value: string): string | null {
  const url = getMaterialMediaUrl(kind, value);
  if (!url) return null;
  if (kind === "video") return `https://www.youtube.com/watch?v=${extractYoutubeId(url)}`;
  if (kind === "slideshow") {
    if (new URL(url).hostname === "www.canva.com") return url.replace(/\?embed$/, "");
    return url.replace(/\/embed$/, url.includes("/d/e/") ? "/pub" : "/view");
  }
  return url;
}

export function getMaterialDownloadUrl(value: string, filename: string): string | null {
  const url = parseWebUrl(value);
  if (!url || !url.pathname.includes("/storage/v1/object/public/learning-materials/")) return null;
  // Supabase's download parameter supplies Content-Disposition across origins.
  const name = filename.replace(/[\\/:*?"<>|]/g, "_").trim() || "materi";
  const extension = url.pathname.match(/\.(pdf|png|jpe?g|webp)$/i)?.[0].toLowerCase() ?? "";
  url.searchParams.set(
    "download",
    name.toLowerCase().endsWith(extension) ? name : `${name}${extension}`,
  );
  return url.href;
}
