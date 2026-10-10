import { Suspense } from "react";
import type { Metadata } from "next";
import { getSchool } from "@/lib/data/school";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: "Masuk",
};

export default async function LoginPage() {
  const school = await getSchool();

  return (
    <Suspense fallback={null}>
      <LoginForm
        schoolName={school?.name ?? null}
        logoUrl={school?.logo_url ?? null}
        schoolAddress={school?.address ?? null}
        schoolPhone={school?.phone ?? null}
      />
    </Suspense>
  );
}
