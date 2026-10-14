import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, afterEach, test } from "node:test";
import { JSDOM } from "jsdom";
import ts from "typescript";

// Exercise actual React/Radix components and the pointerdown -> click sequence.
// Server actions are mocked; these tests never access Supabase or change accounts.
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
for (const name of [
  "window",
  "document",
  "Node",
  "Element",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLButtonElement",
  "HTMLSelectElement",
  "HTMLTextAreaElement",
  "HTMLCanvasElement",
  "File",
  "Blob",
  "DocumentFragment",
  "NodeFilter",
  "MutationObserver",
  "CustomEvent",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "FocusEvent",
  "FormData",
]) {
  globalThis[name] = dom.window[name];
}
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
HTMLElement.prototype.scrollIntoView = function () {};
HTMLElement.prototype.hasPointerCapture = () => false;
HTMLElement.prototype.setPointerCapture = function () {};
HTMLElement.prototype.releasePointerCapture = function () {};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const require = createRequire(import.meta.url);
const React = require("react");
const { createRoot } = require("react-dom/client");
const { act, createElement: h } = React;
// Model Next's native-history integration while running the real filter hook.
const replaceState = window.history.replaceState.bind(window.history);
window.history.replaceState = (...args) => {
  replaceState(...args);
  window.dispatchEvent(new Event("popstate"));
};
let refreshCalls = 0;
const navigation = {
  useRouter() {
    return { refresh: () => refreshCalls++ };
  },
  useSearchParams() {
    const search = React.useSyncExternalStore(
      React.useCallback((notify) => {
        window.addEventListener("popstate", notify);
        return () => window.removeEventListener("popstate", notify);
      }, []),
      () => window.location.search,
    );
    return React.useMemo(() => new URLSearchParams(search), [search]);
  },
};
const project = fileURLToPath(new URL("../../", import.meta.url));
const cache = new Map();
const mutationCalls = [];
let expectedMutationCount = 0;
let actionResult = { ok: false, message: "Test only" };
const actions = Object.fromEntries(
  [
    "createClass",
    "updateClass",
    "deleteClass",
    "createStudent",
    "updateStudent",
    "deleteStudent",
    "assignStudentToClass",
    "setClassSubjectTeacher",
    "updateStaff",
    "createTeacher",
    "createPrincipal",
    "saveSchoolSettings",
    "resetPasswordToDefault",
    "uploadSchoolLogo",
  ].map((name) => [
    name,
    async (formData) => {
      mutationCalls.push({
        name,
        values: typeof formData === "string" ? { id: formData } : Object.fromEntries(formData),
      });
      if (actionResult instanceof Error) throw actionResult;
      return actionResult;
    },
  ]),
);

function loadSource(filename) {
  filename = path.resolve(project, filename);
  if (!path.extname(filename)) {
    filename += existsSync(`${filename}.tsx`) ? ".tsx" : ".ts";
  }
  if (cache.has(filename)) return cache.get(filename);
  const exports = {};
  cache.set(filename, exports);
  const code = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  new Function("require", "exports", code)((name) => {
    if (name === "../actions" || name === "./actions" || name === "../users/actions")
      return actions;
    if (name === "next/navigation") return navigation;
    if (name === "next/link") {
      return ({ children, href, ...props }) => h("a", { href, ...props }, children);
    }
    if (name.startsWith("@/")) return loadSource(`src/${name.slice(2)}`);
    if (name.startsWith(".")) return loadSource(path.resolve(path.dirname(filename), name));
    return require(name);
  }, exports);
  return exports;
}

const D = loadSource("src/components/ui/dialog.tsx");
const S = loadSource("src/components/ui/select.tsx");
const A = loadSource("src/components/ui/alert-dialog.tsx");
const { ClassesManager } = loadSource("src/app/(app)/academic/ClassesManager.tsx");
const { StudentsPanel } = loadSource("src/app/(app)/users/StudentsPanel.tsx");
const { MasterKelasManager } = loadSource("src/app/(app)/master-kelas/MasterKelasManager.tsx");
const { TeachersPanel } = loadSource("src/app/(app)/users/TeachersPanel.tsx");
const { PrincipalPanel } = loadSource("src/app/(app)/users/PrincipalPanel.tsx");
const { UsersTabs } = loadSource("src/app/(app)/users/UsersTabs.tsx");
const { SchoolSettingsForm } = loadSource("src/app/(app)/settings/SchoolSettingsForm.tsx");
const { ResetPasswordPanel } = loadSource("src/app/(app)/settings/ResetPasswordPanel.tsx");
const { LogoUploader } = loadSource("src/app/(app)/settings/LogoUploader.tsx");
const { SchoolExportPanel } = loadSource("src/app/(app)/settings/SchoolExportPanel.tsx");
const T = loadSource("src/components/ui/tabs.tsx");
const delay = () => new Promise((resolve) => setTimeout(resolve, 10));
let root;

afterEach(async () => {
  if (root)
    await act(async () => {
      root.unmount();
      await delay();
    });
  root = undefined;
  assert.equal(
    mutationCalls.length,
    expectedMutationCount,
    "Only explicit saves may submit a form",
  );
  mutationCalls.length = 0;
  expectedMutationCount = 0;
  actionResult = { ok: false, message: "Test only" };
  refreshCalls = 0;
});
after(() => dom.window.close());

test("school export disables download without an active semester and distinguishes a load error", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Must not fetch");
  });
  await render(h(SchoolExportPanel, { period: null, loadError: null }));
  assert.equal(button("Unduh Data Semester Aktif (.zip)").disabled, true);
  assert.match(document.body.textContent, /Belum ada tahun ajaran aktif/);
  await click(button("Unduh Data Semester Aktif (.zip)"));
  assert.equal(fetch.mock.callCount(), 0);
  await click(button("Muat ulang status semester"));
  assert.equal(refreshCalls, 1);
  await act(async () => {
    root.render(h(SchoolExportPanel, { period: null, loadError: "Status belum dapat dimuat." }));
    await delay();
  });
  assert.equal(document.querySelector('[role="alert"]').textContent, "Status belum dapat dimuat.");
  assert.doesNotMatch(document.body.textContent, /Belum ada tahun ajaran aktif/);
});

test("school export prevents duplicate requests, allows retry, and downloads the named ZIP", async (t) => {
  let finish;
  let response = new Promise((resolve) => {
    finish = resolve;
  });
  const fetch = t.mock.method(globalThis, "fetch", async () => response);
  const downloads = [];
  t.mock.method(window.HTMLAnchorElement.prototype, "click", function () {
    downloads.push({ href: this.href, filename: this.download });
  });
  t.mock.method(URL, "createObjectURL", () => "blob:school-export");
  const revoke = t.mock.method(URL, "revokeObjectURL", () => {});
  await render(
    h(SchoolExportPanel, {
      period: { id: "active", year_label: "2025/2026", semester: "genap" },
      loadError: null,
    }),
  );
  await click(button("Unduh Data Semester Aktif (.zip)"));
  assert.equal(button("Menyiapkan file…").disabled, true);
  await click(button("Menyiapkan file…"));
  assert.equal(fetch.mock.callCount(), 1);
  assert.deepEqual(fetch.mock.calls[0].arguments, [
    "/api/exports/school?periodId=active",
    { cache: "no-store" },
  ]);
  await act(async () => {
    finish(
      new Response(JSON.stringify({ error: "Tahun ajaran aktif berubah. Muat ulang halaman." }), {
        status: 409,
      }),
    );
    await delay();
  });
  assert.match(document.querySelector('[role="alert"]').textContent, /aktif berubah/);
  assert.equal(button("Unduh Data Semester Aktif (.zip)").disabled, false);
  assert.equal(downloads.length, 0);
  await click(button("Muat ulang status semester"));
  assert.equal(refreshCalls, 1);
  response = new Response("test ZIP bytes", {
    headers: {
      "content-type": "application/zip",
      "content-disposition": 'attachment; filename="Data-Sekolah-2025-2026-Genap.zip"',
    },
  });
  await click(button("Unduh Data Semester Aktif (.zip)"));
  assert.equal(fetch.mock.callCount(), 2);
  assert.deepEqual(downloads, [
    { href: "blob:school-export", filename: "Data-Sekolah-2025-2026-Genap.zip" },
  ]);
  assert.equal(document.querySelector('[role="alert"]'), null);
  assert.equal(document.querySelector("a[download]"), null);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.equal(revoke.mock.callCount(), 1);
});

test("school export rejects a redirected login page and reports network failure without a fake download", async (t) => {
  let failNetwork = false;
  t.mock.method(globalThis, "fetch", async () => {
    if (failNetwork) throw new TypeError("Failed to fetch");
    return new Response("<html>Login</html>", { headers: { "content-type": "text/html" } });
  });
  const createUrl = t.mock.method(URL, "createObjectURL", () => "blob:unexpected");
  await render(
    h(SchoolExportPanel, {
      period: { id: "active", year_label: "2025/2026", semester: "ganjil" },
      loadError: null,
    }),
  );
  await click(button("Unduh Data Semester Aktif (.zip)"));
  assert.match(
    document.querySelector('[role="alert"]').textContent,
    /Sesi tidak dapat diverifikasi/,
  );
  failNetwork = true;
  await click(button("Unduh Data Semester Aktif (.zip)"));
  assert.match(document.querySelector('[role="alert"]').textContent, /Periksa koneksi/);
  assert.equal(createUrl.mock.callCount(), 0);
  assert.equal(button("Unduh Data Semester Aktif (.zip)").disabled, false);
});

test("school profile keeps a failed draft, prevents duplicate saves, and becomes clean after success", async () => {
  await render(h(SchoolSettingsForm, { name: "Sekolah Lama", address: "Alamat", phone: "0123" }));
  assert.equal(button("Simpan Perubahan").disabled, true);
  await enterText(document.querySelector('[name="name"]'), "Sekolah Baru");
  await enterText(document.querySelector('[name="address"]'), "Alamat baru\nBaris kedua");
  expectedMutationCount = 1;
  actionResult = new Error("Disconnected");
  await click(button("Simpan Perubahan"));
  assert.equal(document.querySelector('[name="name"]').value, "Sekolah Baru");
  assert.equal(document.querySelector('[name="address"]').value, "Alamat baru\nBaris kedua");
  assert.match(document.querySelector('[role="alert"]').textContent, /belum dapat dipastikan/);
  let finish;
  actionResult = new Promise((resolve) => {
    finish = resolve;
  });
  expectedMutationCount = 2;
  await click(button("Simpan Perubahan"));
  assert.equal(button("Menyimpan...").disabled, true);
  await act(async () => {
    document
      .querySelector("form")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await delay();
  });
  assert.equal(mutationCalls.length, 2);
  await act(async () => {
    finish({ ok: true, message: "Tersimpan" });
    await delay();
  });
  assert.equal(button("Simpan Perubahan").disabled, true);
  assert.equal(document.querySelector('[role="alert"]'), null);
});

test("reset search explains missing identifiers and result limits; failed reset remains open and pending reset cannot repeat", async () => {
  const users = Array.from({ length: 10 }, (_, i) => ({
    id: `user-${i}`,
    name: `Pengguna ${i}`,
    role: "student",
    identifier: i ? `0012345${i}` : null,
  }));
  await render(h(ResetPasswordPanel, { users }));
  await enterText(document.querySelector("input"), "Pengguna");
  assert.match(document.body.textContent, /Menampilkan 8 dari 10/);
  assert.match(document.body.textContent, /NISN\/NIP belum tersedia/);
  assert.equal(button("Reset").disabled, true);
  const trigger = [...document.querySelectorAll("button")].find(
    (el) => el.textContent.trim() === "Reset" && !el.disabled,
  );
  await click(trigger);
  assert.match(
    document.querySelector('[role="alertdialog"]').textContent,
    /Pengguna 1.*Siswa.*00123451/,
  );
  expectedMutationCount = 1;
  await click(button("Reset Password"));
  assert.ok(document.querySelector('[role="alertdialog"]'));
  assert.equal(document.querySelector('[role="alert"]').textContent, "Test only");
  assert.deepEqual(mutationCalls[0], { name: "resetPasswordToDefault", values: { id: "user-1" } });
  let finish;
  actionResult = new Promise((resolve) => {
    finish = resolve;
  });
  expectedMutationCount = 2;
  await click(button("Reset Password"));
  assert.equal(button("Mereset...").disabled, true);
  assert.equal(button("Batal").disabled, true);
  await click(button("Mereset..."));
  await dispatch(document.activeElement, "keydown", { key: "Escape" });
  assert.ok(document.querySelector('[role="alertdialog"]'));
  assert.equal(mutationCalls.length, 2);
  await act(async () => {
    finish({ ok: true, message: "Reset berhasil" });
    await delay();
  });
  assert.equal(document.querySelector('[role="alertdialog"]'), null);
});

async function chooseLogo(file) {
  const input = document.querySelector('input[type="file"]');
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await delay();
  });
}

test("invalid logo is rejected before crop/upload and failed SVG upload preserves the saved preview", async () => {
  await render(h(LogoUploader, { logoUrl: "/old.png" }));
  await chooseLogo(
    new File([new Uint8Array(2 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }),
  );
  assert.equal(dialog(), null);
  assert.match(document.querySelector('[role="alert"]').textContent, /maksimal 2MB/);
  assert.equal(mutationCalls.length, 0);
  await chooseLogo(new File(["text"], "text.txt", { type: "text/plain" }));
  assert.match(document.querySelector('[role="alert"]').textContent, /Tipe file tidak didukung/);
  expectedMutationCount = 1;
  await chooseLogo(new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" }));
  assert.equal(document.querySelector('img[alt="Logo sekolah"]').getAttribute("src"), "/old.png");
  actionResult = { ok: true, message: "Tersimpan", logoUrl: "/saved.svg" };
  expectedMutationCount = 2;
  await chooseLogo(new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" }));
  assert.equal(document.querySelector('img[alt="Logo sekolah"]').getAttribute("src"), "/saved.svg");
});

test("unreadable raster logo gives an error without uploading", async (t) => {
  t.mock.method(URL, "createObjectURL", () => "blob:test-logo");
  t.mock.method(URL, "revokeObjectURL", () => {});
  await render(h(LogoUploader, { logoUrl: "/old.png" }));
  await chooseLogo(new File(["invalid"], "invalid.png", { type: "image/png" }));
  await act(async () => {
    dialog().querySelector("img").dispatchEvent(new Event("error"));
    await delay();
  });
  assert.match(dialog().querySelector('[role="alert"]').textContent, /Gambar tidak dapat dibaca/);
  assert.equal(button("Simpan Logo").disabled, true);
  await click(button("Batal"));
  assert.equal(dialog(), null);
});

test("responsive crop preserves source coordinates and remains open after failed save", async (t) => {
  t.mock.method(URL, "createObjectURL", () => "blob:test-logo");
  t.mock.method(URL, "revokeObjectURL", () => {});
  const draws = [];
  t.mock.method(HTMLCanvasElement.prototype, "getContext", (kind, options) => {
    assert.equal(kind, "2d");
    assert.equal(options.alpha, true);
    return { drawImage: (...args) => draws.push(args) };
  });
  t.mock.method(HTMLCanvasElement.prototype, "toBlob", (callback) =>
    callback(new Blob(["png"], { type: "image/png" })),
  );
  await render(h(LogoUploader, { logoUrl: "/old.png" }));
  await chooseLogo(new File(["png"], "logo.png", { type: "image/png" }));
  const img = dialog().querySelector("img");
  Object.defineProperties(img, { naturalWidth: { value: 1000 }, naturalHeight: { value: 500 } });
  await act(async () => {
    img.dispatchEvent(new Event("load"));
    await delay();
  });
  const stage = img.parentElement;
  stage.getBoundingClientRect = () => ({ width: 170 });
  await dispatch(stage, "pointerdown", { clientX: 0, clientY: 0 });
  await dispatch(stage, "pointermove", { clientX: 26, clientY: 0 });
  await dispatch(stage, "pointerup");
  expectedMutationCount = 1;
  await click(button("Simpan Logo"));
  assert.deepEqual(draws[0].slice(1), [150, 0, 500, 500, 0, 0, 512, 512]);
  assert.ok(dialog());
  assert.equal(dialog().querySelector('[role="alert"]').textContent, "Test only");
  assert.equal(document.querySelector('img[alt="Logo sekolah"]').getAttribute("src"), "/old.png");
  actionResult = { ok: true, message: "Tersimpan", logoUrl: "/new.png" };
  expectedMutationCount = 2;
  await click(button("Simpan Logo"));
  assert.equal(dialog(), null);
  assert.equal(document.querySelector('img[alt="Logo sekolah"]').getAttribute("src"), "/new.png");
});

async function render(element, url = "/") {
  replaceState(null, "", url);
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root"));
  await act(async () => {
    root.render(element);
    await delay();
  });
  await act(delay);
}

async function dispatch(target, type, options = {}) {
  assert.ok(target, `Missing target for ${type}`);
  await act(async () => {
    const Constructor = type === "keydown" ? KeyboardEvent : MouseEvent;
    const event = new Constructor(type, { bubbles: true, cancelable: true, button: 0, ...options });
    if (type.startsWith("pointer")) {
      Object.defineProperty(event, "pointerType", { value: options.pointerType ?? "mouse" });
    }
    target.dispatchEvent(event);
    await delay();
  });
}

async function click(target, pointerType = "mouse") {
  // Select dismisses on pointerdown; Dialog can defer dismissal until click,
  // after the Select has unmounted. These must be distinct event phases.
  for (const type of ["pointerdown", "pointerup", "click"]) {
    await dispatch(target, type, { pointerType });
  }
}

const dialog = () => document.querySelector('[role="dialog"]');
const menu = () => document.querySelector('[role="listbox"]');
const backdrop = () =>
  [...document.querySelectorAll('[data-state="open"]')].find((element) =>
    element.classList.contains("inset-0"),
  );
const button = (label) =>
  [...document.querySelectorAll("button")].find((element) => element.textContent.trim() === label);

function Fixture({ strict = true }) {
  const [open, setOpen] = React.useState(true);
  const [value, setValue] = React.useState("a");
  return h(
    D.Dialog,
    { open, onOpenChange: setOpen },
    h(
      D.DialogContent,
      { dismissOnOverlayOnly: strict, "aria-describedby": undefined },
      h(D.DialogTitle, null, "Formulir"),
      h("input", { defaultValue: "Data belum disimpan" }),
      h(
        S.Select,
        { value, onValueChange: setValue },
        h(S.SelectTrigger, null, h(S.SelectValue)),
        h(
          S.SelectContent,
          null,
          h(S.SelectItem, { value: "a" }, "A"),
          h(S.SelectItem, { value: "b" }, "B"),
        ),
      ),
      h(
        A.AlertDialog,
        null,
        h(A.AlertDialogTrigger, null, "Hapus"),
        h(
          A.AlertDialogContent,
          null,
          h(A.AlertDialogTitle, null, "Konfirmasi"),
          h(A.AlertDialogDescription, null, "Hanya untuk pengujian"),
          h(A.AlertDialogCancel, null, "Batal"),
        ),
      ),
    ),
  );
}

for (const pointerType of ["mouse", "touch"]) {
  test(`${pointerType}: dismissing dropdown on backdrop preserves dialog; next click closes dialog`, async () => {
    await render(h(Fixture));
    const trigger = dialog().querySelector('[role="combobox"]');
    await click(trigger, pointerType);
    assert.ok(menu());
    await click(backdrop(), pointerType);
    assert.equal(menu(), null);
    assert.ok(dialog(), "Closing the dropdown must not close its parent dialog");
    assert.equal(trigger.textContent, "A");
    assert.equal(dialog().querySelector("input").value, "Data belum disimpan");
    await click(backdrop(), pointerType);
    assert.equal(dialog(), null);
  });

  test(`${pointerType}: dismissing dropdown inside form preserves dialog and selection`, async () => {
    await render(h(Fixture));
    const trigger = dialog().querySelector('[role="combobox"]');
    await click(trigger, pointerType);
    await click(dialog().querySelector("input"), pointerType);
    assert.equal(menu(), null);
    assert.ok(dialog());
    assert.equal(trigger.textContent, "A");
    await click(button("Close"), pointerType);
    assert.equal(dialog(), null);
  });

  test(`${pointerType}: choosing an option still preserves dialog and changes value`, async () => {
    await render(h(Fixture));
    const trigger = dialog().querySelector('[role="combobox"]');
    await click(trigger, pointerType);
    const option = [...document.querySelectorAll('[role="option"]')].find(
      (el) => el.textContent === "B",
    );
    await click(option, pointerType);
    assert.equal(menu(), null);
    assert.ok(dialog());
    assert.equal(trigger.textContent, "B");
    await click(backdrop(), pointerType);
    assert.equal(dialog(), null);
  });
}

const years = [
  { id: "y1", year_label: "2025/2026", semester: "ganjil", is_active: false },
  { id: "y2", year_label: "2025/2026", semester: "genap", is_active: false },
];
const classes = [
  { id: "c1", name: "1A", grade_level: 1, academic_year_id: "y1" },
  { id: "c2", name: "1B", grade_level: 1, academic_year_id: "y2" },
];
const classOptions = classes.map((c) => ({
  ...c,
  academicYearId: c.academic_year_id,
  label: `${c.name} (${c.academic_year_id === "y1" ? "Ganjil" : "Genap"} 2025/2026)`,
}));
const students = [
  { id: "s1", name: "Siswa Ganjil", nisn: "001", classId: "c1", className: classOptions[0].label },
  { id: "s2", name: "Siswa Genap", nisn: "002", classId: "c2", className: classOptions[1].label },
  { id: "s3", name: "Siswa Baru", nisn: "003", classId: null, className: null },
];
const masterProps = {
  classes: classOptions,
  years,
  students,
  subjects: [],
  teachers: [],
  assignments: [],
};

async function enterText(input, value) {
  assert.ok(input);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      "value",
    ).set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await delay();
  });
}

test("student URL restores period/class; unplaced view is global and search stays within that view", async () => {
  await render(
    h(StudentsPanel, { students, years, classes: classOptions }),
    "/users?tab=siswa&year=y2&class=c2#students",
  );
  assert.match(document.querySelector("tbody").textContent, /Siswa Genap/);
  assert.doesNotMatch(document.querySelector("tbody").textContent, /Siswa Ganjil|Siswa Baru/);
  await click(button("Belum memiliki kelas (1)"));
  assert.match(document.querySelector("tbody").textContent, /Siswa Baru/);
  assert.equal(new URLSearchParams(window.location.search).get("placement"), "unplaced");
  assert.equal(window.location.hash, "#students");
  assert.equal(document.querySelectorAll('[role="combobox"]').length, 0);
  const input = document.querySelector('input[placeholder="Cari nama/NISN..."]');
  await enterText(input, "002");
  assert.match(document.querySelector("tbody").textContent, /Tidak ditemukan/);
  await enterText(input, "003");
  assert.match(document.querySelector("tbody").textContent, /Siswa Baru/);
  await enterText(input, "");
  await click(button("Per Kelas"));
  assert.match(document.querySelector("tbody").textContent, /Siswa Genap/);
  assert.equal(new URLSearchParams(window.location.search).has("placement"), false);
});

test("invalid class from another period falls back safely; selecting year updates both URL filters", async () => {
  await render(
    h(StudentsPanel, { students, years, classes: classOptions }),
    "/users?tab=siswa&year=y2&class=c1",
  );
  assert.match(document.querySelector("tbody").textContent, /Siswa Genap/);
  const yearTrigger = document.querySelector('[role="combobox"]');
  await click(yearTrigger);
  await click(
    [...document.querySelectorAll('[role="option"]')].find((el) =>
      el.textContent.includes("Ganjil"),
    ),
  );
  const params = new URLSearchParams(window.location.search);
  assert.equal(params.get("year"), "y1");
  assert.equal(params.get("class"), "c1");
  assert.equal(params.get("tab"), "siswa");
  assert.match(document.querySelector("tbody").textContent, /Siswa Ganjil/);
});

test("Users tab restores URL state and preserves student filters when switching tabs", async () => {
  await render(
    h(
      UsersTabs,
      null,
      h(
        T.TabsList,
        null,
        h(T.TabsTrigger, { value: "siswa" }, "Siswa"),
        h(T.TabsTrigger, { value: "guru" }, "Guru"),
      ),
      h(T.TabsContent, { value: "siswa" }, "Daftar siswa"),
      h(T.TabsContent, { value: "guru" }, "Daftar guru"),
    ),
    "/users?tab=guru&year=y2&class=c2",
  );
  assert.equal(button("Guru").getAttribute("aria-selected"), "true");
  await dispatch(button("Siswa"), "mousedown");
  assert.equal(new URLSearchParams(window.location.search).get("tab"), "siswa");
  assert.equal(new URLSearchParams(window.location.search).get("class"), "c2");
  assert.equal(button("Siswa").getAttribute("aria-selected"), "true");
});

test("Master Kelas searches NISN and confirms source/destination before moving an already placed student", async () => {
  await render(h(MasterKelasManager, masterProps), "/master-kelas?year=y2&class=c2");
  await click(button("+ Tambah Siswa"));
  await enterText(
    document.querySelector('input[placeholder="Cari nama atau NISN siswa..."]'),
    "001",
  );
  const options = [...document.querySelectorAll("[cmdk-item]")];
  assert.equal(options.length, 1);
  assert.match(options[0].textContent, /Siswa Ganjil.*NISN: 001/);
  await click(options[0]);
  let confirmation = document.querySelector('[role="alertdialog"]');
  assert.ok(confirmation);
  assert.ok(confirmation.textContent.includes(classOptions[0].label));
  assert.ok(confirmation.textContent.includes(classOptions[1].label));
  assert.equal(mutationCalls.length, 0);
  await click(button("Batal"));
  assert.equal(document.querySelector('[role="alertdialog"]'), null);
  assert.equal(mutationCalls.length, 0);
  await click(button("+ Tambah Siswa"));
  await click(document.querySelector('[cmdk-item][data-value="s1"]'));
  expectedMutationCount = 1;
  await click(button("Pindahkan Siswa"));
  assert.deepEqual(mutationCalls[0], {
    name: "assignStudentToClass",
    values: {
      student_id: "s1",
      class_id: "c2",
      expected_class_id: "c1",
      confirm_move: "true",
    },
  });
  assert.ok(document.querySelector('[role="alertdialog"]'), "Failure must keep confirmation open");
  actionResult = { ok: true, message: "Tersimpan" };
  expectedMutationCount = 2;
  await click(button("Pindahkan Siswa"));
  assert.equal(document.querySelector('[role="alertdialog"]'), null);
});

test("unplaced student can be assigned directly without move confirmation", async () => {
  await render(h(MasterKelasManager, masterProps), "/master-kelas?year=y2&class=c2");
  await click(button("+ Tambah Siswa"));
  actionResult = { ok: true, message: "Tersimpan" };
  expectedMutationCount = 1;
  await click(document.querySelector('[cmdk-item][data-value="s3"]'));
  assert.equal(document.querySelector('[role="alertdialog"]'), null);
  assert.deepEqual(mutationCalls[0].values, {
    student_id: "s3",
    class_id: "c2",
    expected_class_id: "",
  });
});

const teacher = { id: "t1", name: "Guru Uji", nip: "100", teaching: [] };
for (const [name, component, props, editLabel, actionName] of [
  ["student", StudentsPanel, { students, years, classes: classOptions }, "Edit", "updateStudent"],
  ["teacher", TeachersPanel, { teachers: [teacher] }, "Edit", "updateStaff"],
  [
    "principal",
    PrincipalPanel,
    { principal: { id: "p1", full_name: "Kepsek Uji", nip: "101" } },
    "Edit Kepala Sekolah",
    "updateStaff",
  ],
]) {
  test(`${name} edit preserves draft on save failure and closes only after successful save`, async () => {
    await render(h(component, props));
    await click(button(editLabel));
    const input = dialog().querySelector('[name="name"]');
    await enterText(input, "Koreksi Nama");
    expectedMutationCount = 1;
    await click(button("Simpan"));
    assert.equal(mutationCalls[0].name, actionName);
    assert.equal(mutationCalls[0].values.name, "Koreksi Nama");
    assert.ok(dialog());
    assert.equal(dialog().querySelector('[name="name"]').value, "Koreksi Nama");
    actionResult = { ok: true, message: "Tersimpan" };
    expectedMutationCount = 2;
    await click(button("Simpan"));
    assert.equal(dialog(), null);
  });
}

test("teacher assignments distinguish periods and reveal all assignments on demand", async () => {
  const teaching = [
    { className: "1A", subjectName: "IPA", periodLabel: "2026/2027 · Ganjil", isActive: true },
    { className: "1A", subjectName: "IPA", periodLabel: "2025/2026 · Genap", isActive: false },
    { className: "1B", subjectName: "IPA", periodLabel: "2025/2026 · Genap", isActive: false },
    { className: "1C", subjectName: "IPA", periodLabel: "2025/2026 · Ganjil", isActive: false },
  ];
  await render(h(TeachersPanel, { teachers: [{ ...teacher, teaching }] }));
  const row = document.querySelector("tbody");
  assert.match(row.textContent, /2026\/2027 · Ganjil · Aktif/);
  assert.match(row.textContent, /2025\/2026 · Genap/);
  assert.doesNotMatch(row.textContent, /1C/);
  await click(button("+1 lainnya"));
  assert.match(row.textContent, /1C/);
  await click(button("Ringkas"));
  assert.doesNotMatch(row.textContent, /1C/);
});

test("Escape closes dropdown without changing value or closing admin dialog", async () => {
  await render(h(Fixture));
  const trigger = dialog().querySelector('[role="combobox"]');
  await dispatch(trigger, "keydown", { key: "Enter" });
  assert.ok(menu());
  await dispatch(document.activeElement, "keydown", { key: "Escape" });
  assert.equal(menu(), null);
  assert.ok(dialog());
  assert.equal(trigger.textContent, "A");
  await dispatch(document.activeElement, "keydown", { key: "Escape" });
  assert.ok(dialog());
  await click(backdrop());
  assert.equal(dialog(), null);
});

test("nested confirmation cancellation keeps the parent form open", async () => {
  await render(h(Fixture));
  await click(button("Hapus"));
  assert.ok(document.querySelector('[role="alertdialog"]'));
  await click(button("Batal"));
  assert.ok(dialog());
  assert.equal(document.querySelector('[role="alertdialog"]'), null);
});

test("non-admin default dialog retains Escape dismissal", async () => {
  await render(h(Fixture, { strict: false }));
  await dispatch(document.activeElement, "keydown", { key: "Escape" });
  assert.equal(dialog(), null);
});

for (const pointerType of ["mouse", "touch"]) {
  test(`${pointerType}: actual Tambah Kelas preserves year and draft when dropdown is cancelled`, async () => {
    await render(h(ClassesManager, { classes, years, activeYear: null }));
    await click(button("+ Tambah Kelas"), pointerType);
    const name = dialog().querySelector('[name="name"]');
    name.value = "Kelas percobaan";
    const trigger = dialog().querySelector('[role="combobox"]');
    const previous = trigger.textContent;
    for (let i = 0; i < 2; i++) {
      await click(trigger, pointerType);
      assert.ok(menu());
      await click(backdrop(), pointerType);
      assert.equal(menu(), null);
      assert.ok(dialog());
      assert.equal(trigger.textContent, previous);
      assert.equal(name.value, "Kelas percobaan");
    }
    await click(backdrop(), pointerType);
    assert.equal(dialog(), null);
  });

  test(`${pointerType}: actual Tambah Siswa preserves year, class and draft when either dropdown is cancelled`, async () => {
    await render(
      h(StudentsPanel, {
        students: [],
        years,
        classes: classes.map((c) => ({ ...c, academicYearId: c.academic_year_id, label: c.name })),
      }),
    );
    await click(button("+ Tambah Siswa"), pointerType);
    const name = dialog().querySelector('[name="name"]');
    name.value = "Siswa percobaan";
    const originalClass = dialog().querySelector('[name="class_id"]').value;
    for (const trigger of dialog().querySelectorAll('[role="combobox"]')) {
      const previous = trigger.textContent;
      await click(trigger, pointerType);
      assert.ok(menu());
      await click(backdrop(), pointerType);
      assert.equal(menu(), null);
      assert.ok(dialog());
      assert.equal(trigger.textContent, previous);
      assert.equal(dialog().querySelector('[name="class_id"]').value, originalClass);
      assert.equal(name.value, "Siswa percobaan");
    }
    await click(button("Close"), pointerType);
    assert.equal(dialog(), null);
  });
}
