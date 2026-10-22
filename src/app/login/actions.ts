"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function login(formData: FormData) {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!username || !password) {
    redirect(`/login?error=${encodeURIComponent("Nama pengguna dan kata sandi wajib diisi.")}`);
  }

  const supabase = await createClient();
  const notFoundError = "Akun tidak ditemukan. Pastikan mengisi data dengan benar.";

  const { data: email } = await supabase.rpc("email_for_username", { p_username: username });
  if (!email) {
    redirect(`/login?error=${encodeURIComponent(notFoundError)}`);
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    redirect(`/login?error=${encodeURIComponent(notFoundError)}`);
  }

  redirect("/dashboard?welcome=1");
}
