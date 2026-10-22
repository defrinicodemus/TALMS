import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { ACADEMIC_MAINTENANCE_PATH, isAcademicAccessOpen } from "@/lib/auth/academic-access";

export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // This endpoint performs the same authentication and academic access check
  // itself. Skipping the middleware avoids doing both checks twice for every
  // visible-tab poll while keeping the endpoint protected.
  if (pathname === "/api/academic-status") {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isLoginRoute = pathname === "/login";

  function redirectTo(path: string) {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = "";
    const response = NextResponse.redirect(url, request.method === "POST" ? 303 : 307);
    for (const cookie of supabaseResponse.cookies.getAll()) response.cookies.set(cookie);
    return response;
  }

  if (!user) {
    if (pathname === "/" || !isLoginRoute) return redirectTo("/login");
    return supabaseResponse;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const open = profile?.role === "admin" || (await isAcademicAccessOpen(supabase));
  if (pathname === "/" || isLoginRoute) {
    return redirectTo(open ? "/dashboard" : ACADEMIC_MAINTENANCE_PATH);
  }
  if (!open && pathname !== ACADEMIC_MAINTENANCE_PATH) {
    if (pathname.startsWith("/api/")) {
      const response = NextResponse.json(
        { error: "Akses ditutup sementara untuk administrasi pergantian semester." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
      for (const cookie of supabaseResponse.cookies.getAll()) response.cookies.set(cookie);
      return response;
    }
    // Server actions have their own guard in getCurrentUser. Let Next.js
    // serialize its redirect correctly; logout must remain available too.
    if (request.method !== "POST") return redirectTo(ACADEMIC_MAINTENANCE_PATH);
  }

  return supabaseResponse;
}
