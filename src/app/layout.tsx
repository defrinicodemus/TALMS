import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { getSchool } from "@/lib/data/school";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const school = await getSchool();
  const name = school?.name?.trim() || "Sekolah";
  const title = `${name} — LMS`;
  const description = `Sistem belajar daring ${name} — ceria, ramah anak, dan terhubung.`;

  return {
    title: { default: title, template: `%s — LMS ${name}` },
    description,
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary" },
  };
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <body>
        {children}
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
