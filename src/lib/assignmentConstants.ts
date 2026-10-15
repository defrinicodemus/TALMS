export const ASSIGNMENT_MAX_PHOTO_MB = 2;
export const ASSIGNMENT_MAX_TEXT_LENGTH = 20000;
export const ASSIGNMENT_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const ASSIGNMENT_PHOTO_BUCKET = "assignment-submissions";

export function assignmentMethods(methods: string[] | null, kind: string): ("text" | "photo")[] {
  const valid = [...new Set(methods ?? [])].filter(
    (method): method is "text" | "photo" => method === "text" || method === "photo",
  );
  return valid.length ? valid : kind === "photo" ? ["photo"] : ["text"];
}

export function assignmentPhotoPath(content: string | null): string | null {
  const prefix = `${ASSIGNMENT_PHOTO_BUCKET}/`;
  if (!content?.startsWith(prefix)) return null;
  const path = content.slice(prefix.length);
  return /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(path) ? path : null;
}

export function assignmentWebUrl(content: string | null): string | null {
  if (!content || /\s/.test(content)) return null;
  try {
    const url = new URL(content);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function isLegacyAssignmentPhoto(content: string | null) {
  const url = assignmentWebUrl(content);
  return !!url && /\.(png|jpe?g|webp|gif)$/i.test(new URL(url).pathname);
}

export function formatAssignmentTime(value: string | null) {
  if (!value) return "Tidak ada tenggat";
  return `${new Date(value).toLocaleString("id-ID", {
    timeZone: "Asia/Makassar",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })} WITA`;
}

export function assignmentTimeInputs(value: string | null) {
  if (!value) return { date: "", time: "23:59" };
  const local = new Date(new Date(value).getTime() + 8 * 60 * 60 * 1000).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

export function parseAssignmentDeadline(date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const value = new Date(`${date}T${time}:00+08:00`);
  if (!Number.isFinite(value.getTime()) || assignmentTimeInputs(value.toISOString()).date !== date)
    return null;
  return value.toISOString();
}
