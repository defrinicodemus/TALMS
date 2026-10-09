"use client";

import { useId } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type AcademicYearOption = {
  id: string;
  year_label: string;
  semester: string;
  is_active: boolean;
};

export type AcademicClassOption = {
  id: string;
  name: string;
  academicYearId: string;
};

export function AcademicClassSelector({
  years,
  classes,
  yearId,
  classId,
  onYearChange,
  onClassChange,
  disabled = false,
  className,
}: {
  years: AcademicYearOption[];
  classes: AcademicClassOption[];
  yearId: string;
  classId: string;
  onYearChange: (yearId: string) => void;
  onClassChange: (classId: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  const availableClasses = classes.filter((c) => c.academicYearId === yearId);

  return (
    <div className={cn("grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]", className)}>
      <div className="min-w-0 space-y-1">
        <Label htmlFor={`${id}-year`}>Tahun Ajaran / Semester</Label>
        <Select value={yearId} onValueChange={onYearChange} disabled={disabled || !years.length}>
          <SelectTrigger id={`${id}-year`} className="rounded-none">
            <SelectValue
              placeholder={years.length ? "Pilih tahun ajaran" : "Belum ada tahun ajaran"}
            />
          </SelectTrigger>
          <SelectContent>
            {years.map((year) => (
              <SelectItem key={year.id} value={year.id}>
                {year.year_label} · {year.semester === "ganjil" ? "Ganjil" : "Genap"}
                {year.is_active ? " · Aktif" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="min-w-0 space-y-1">
        <Label htmlFor={`${id}-class`}>Kelas</Label>
        <Select
          value={availableClasses.some((c) => c.id === classId) ? classId : ""}
          onValueChange={onClassChange}
          disabled={disabled || !availableClasses.length}
        >
          <SelectTrigger id={`${id}-class`} className="rounded-none">
            <SelectValue
              placeholder={
                !yearId
                  ? "Pilih tahun ajaran dahulu"
                  : availableClasses.length
                    ? "Pilih kelas"
                    : "Belum ada kelas"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {availableClasses.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
