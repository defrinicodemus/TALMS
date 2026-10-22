import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

async function compile(path) {
  return ts.transpileModule(await readFile(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
const [accessCode, profileCode, middlewareCode, statusRouteCode] = await Promise.all([
  compile("../../src/lib/auth/academic-access.ts"),
  compile("../../src/lib/data/profile.ts"),
  compile("../../src/lib/supabase/middleware.ts"),
  compile("../../src/app/api/academic-status/route.ts"),
]);

function setup({ role = "student", open = false, error = null, classVisible = true } = {}) {
  const calls = { auth: 0, profile: 0, rpc: 0 };
  const profile = role
    ? {
        id: "user",
        role,
        full_name: "Test",
        class_id: "class",
        classes: classVisible ? { name: "4A" } : null,
      }
    : null;
  const client = {
    auth: {
      getUser: async () => {
        calls.auth++;
        return { data: { user: role ? { id: "user" } : null } };
      },
    },
    rpc: async (name) => {
      calls.rpc++;
      assert.equal(name, "academic_access_open");
      return { data: open, error };
    },
    from(table) {
      calls.profile++;
      assert.equal(table, "profiles");
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        single: async () => ({ data: profile }),
        maybeSingle: async () => ({ data: profile }),
      };
    },
  };
  function response(kind, data, status = 200) {
    return { kind, data, status, cookies: { set() {} } };
  }
  const modules = {
    react: { cache: (fn) => fn },
    "@/lib/supabase/server": { createClient: async () => client },
    "next/navigation": {
      redirect: (path) => {
        throw new Error(`REDIRECT:${path}`);
      },
    },
    "@supabase/ssr": { createServerClient: () => client },
    "next/server": {
      NextResponse: {
        next: () => ({ ...response("next"), cookies: { getAll: () => [], set() {} } }),
        redirect: (url, status) => response("redirect", url.pathname, status),
        json: (data, options) => response("json", data, options.status),
      },
    },
  };
  function evaluate(code) {
    const exports = {};
    new Function("require", "exports", code)((name) => {
      assert.ok(Object.hasOwn(modules, name), `Unexpected dependency: ${name}`);
      return modules[name];
    }, exports);
    return exports;
  }
  modules["@/lib/auth/academic-access"] = evaluate(accessCode);
  return {
    profile: evaluate(profileCode),
    middleware: evaluate(middlewareCode),
    statusRoute: evaluate(statusRouteCode),
    calls,
  };
}
function request(path, method = "GET") {
  return {
    method,
    nextUrl: { pathname: path, clone: () => new URL(`https://lms.example${path}`) },
    cookies: { getAll: () => [], set() {} },
  };
}

for (const role of ["student", "teacher", "principal"]) {
  test(`${role}: the shared page/action identity guard redirects while closed`, async () => {
    const { profile } = setup({ role });
    assert.equal((await profile.getSessionUser()).role, role); // maintenance/login identity
    await assert.rejects(profile.getCurrentUser(), { message: "REDIRECT:/academic-maintenance" });
    assert.equal((await setup({ role, open: true }).profile.getCurrentUser()).role, role);
  });
  test(`${role}: middleware blocks direct pages/PDF, but permits maintenance and logout`, async () => {
    const { middleware } = setup({ role });
    for (const path of ["/dashboard", "/subjects/tugas/id", "/classroom", "/teacher-monitoring"]) {
      const result = await middleware.updateSession(request(path));
      assert.equal(result.kind, "redirect");
      assert.equal(result.data, "/academic-maintenance");
    }
    assert.equal((await middleware.updateSession(request("/api/reports/school-pdf"))).status, 503);
    assert.equal((await middleware.updateSession(request("/api/academic-status"))).kind, "next");
    assert.equal((await middleware.updateSession(request("/"))).data, "/academic-maintenance");
    assert.equal((await middleware.updateSession(request("/academic-maintenance"))).kind, "next");
    assert.equal(
      (await middleware.updateSession(request("/academic-maintenance", "POST"))).kind,
      "next",
    );
    // POST actions reach the shared identity guard, allowing Next.js to encode redirects.
    assert.equal((await middleware.updateSession(request("/subjects", "POST"))).kind, "next");
  });
}

test("access-query failure fails closed for a non-admin and does not lock out admin", async () => {
  const error = { message: "unavailable" };
  await assert.rejects(setup({ open: true, error }).profile.getCurrentUser(), /REDIRECT/);
  const { profile, middleware } = setup({ role: "admin", error });
  assert.equal((await profile.getCurrentUser()).role, "admin");
  assert.equal((await middleware.updateSession(request("/academic"))).kind, "next");
  assert.equal((await middleware.updateSession(request("/"))).data, "/dashboard");
});

test("unauthenticated users can reach login but not maintenance or protected pages", async () => {
  const { profile, middleware } = setup({ role: null });
  assert.equal(await profile.getCurrentUser(), null);
  assert.equal((await middleware.updateSession(request("/login"))).kind, "next");
  assert.equal((await middleware.updateSession(request("/"))).data, "/login");
  assert.equal((await middleware.updateSession(request("/academic-maintenance"))).data, "/login");
});

test("after reopening, requests and login redirects return to the normal app", async () => {
  const { middleware } = setup({ open: true });
  assert.equal((await middleware.updateSession(request("/subjects"))).kind, "next");
  assert.equal((await middleware.updateSession(request("/login"))).data, "/dashboard");
  assert.equal((await middleware.updateSession(request("/"))).data, "/dashboard");
});

test("academic status endpoint authenticates exactly once after its middleware bypass", async () => {
  const bypass = setup({ role: "student", open: true });
  assert.equal(
    (await bypass.middleware.updateSession(request("/api/academic-status"))).kind,
    "next",
  );
  assert.deepEqual(bypass.calls, { auth: 0, profile: 0, rpc: 0 });

  const allowed = setup({ role: "student", open: true });
  const allowedResult = await allowed.statusRoute.GET();
  assert.equal(allowedResult.status, 200);
  assert.deepEqual(allowedResult.data, { open: true });
  assert.deepEqual(allowed.calls, { auth: 1, profile: 1, rpc: 1 });

  const admin = setup({ role: "admin", error: { message: "unavailable" } });
  const adminResult = await admin.statusRoute.GET();
  assert.equal(adminResult.status, 200);
  assert.deepEqual(adminResult.data, { open: true });
  assert.deepEqual(admin.calls, { auth: 1, profile: 1, rpc: 0 });

  const anonymous = setup({ role: null });
  const anonymousResult = await anonymous.statusRoute.GET();
  assert.equal(anonymousResult.status, 401);
  assert.deepEqual(anonymousResult.data, { open: false });
  assert.deepEqual(anonymous.calls, { auth: 1, profile: 0, rpc: 0 });
});

test("an inactive stored placement cannot become the student operational class", async () => {
  const { profile } = setup({ open: true, classVisible: false });
  const user = await profile.getCurrentUser();
  assert.equal(user.role, "student");
  assert.equal(user.classId, undefined);
  assert.equal(user.className, undefined);
});
