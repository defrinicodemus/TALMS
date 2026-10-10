export type TransferKind = "semester" | "promotion";
export type TransferYear = { id: string; year_label: string; semester: string };
export type StudentTransfer = {
  kind: TransferKind;
  sourceYearId: string;
  targetYearId: string;
  mappings: { sourceClassId: string; targetClassId: string; studentIds: string[] }[];
};

export function academicYearStart(label: string): number | null {
  const match = /^(\d{4})\s*\/\s*(\d{4})$/.exec(label.trim());
  if (!match || Number(match[2]) !== Number(match[1]) + 1) return null;
  return Number(match[1]);
}

export function isTransferTarget(source: TransferYear, target: TransferYear, kind: TransferKind) {
  const sourceStart = academicYearStart(source.year_label);
  const targetStart = academicYearStart(target.year_label);
  if (source.id === target.id || sourceStart === null || targetStart === null) return false;
  return kind === "semester"
    ? source.semester === "ganjil" && target.semester === "genap" && targetStart === sourceStart
    : source.semester === "genap" &&
        target.semester === "ganjil" &&
        targetStart === sourceStart + 1;
}

export function transferYearLabel(year: TransferYear) {
  return `${year.year_label} · ${year.semester === "ganjil" ? "Ganjil" : "Genap"}`;
}
