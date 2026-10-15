import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, afterEach, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import ts from "typescript";

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
  "File",
  "Blob",
  "FormData",
  "DocumentFragment",
  "NodeFilter",
  "MutationObserver",
  "CustomEvent",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "FocusEvent",
])
  globalThis[name] = dom.window[name];
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
let objectUrl = 0;
URL.createObjectURL = () => `blob:http://localhost/${++objectUrl}`;
URL.revokeObjectURL = () => {};

const require = createRequire(import.meta.url);
const { act, createElement: h } = require("react");
const { createRoot } = require("react-dom/client");
const project = fileURLToPath(new URL("../../", import.meta.url));
const cache = new Map();
let root, calls, errors, successes, refreshed, result;
const action = async (...args) => {
  calls.push(args);
  return typeof result === "function" ? result() : result;
};
function load(filename) {
  filename = path.resolve(project, filename);
  if (!path.extname(filename)) filename += existsSync(`${filename}.tsx`) ? ".tsx" : ".ts";
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
    if (name === "sonner")
      return { toast: { error: (m) => errors.push(m), success: (m) => successes.push(m) } };
    if (name === "next/navigation")
      return {
        useRouter: () => ({ refresh: () => refreshed++ }),
        notFound: () => assert.fail("Unexpected notFound"),
      };
    if (name === "./actions" || name === "../../actions")
      return {
        createMaterial: action,
        updateMaterial: action,
        deleteMaterial: action,
        setMaterialActive: action,
        markMaterialViewed: action,
      };
    // Tiptap's editor internals are unchanged. Keep its form boundary to exercise the real form.
    if (name === "@/components/RichTextEditor")
      return {
        RichTextEditor: ({ name, defaultValue, onChange }) =>
          h("textarea", { name, defaultValue, onChange: (e) => onChange?.(e.target.value) }),
      };
    if (name === "@/lib/auth/guard") return { requireRole: async () => ({ id: "student" }) };
    if (name === "@/lib/data/subjects")
      return { getMaterialForStudent: async () => ({ ...material, viewed: false }) };
    if (name === "../../BackButton") return { BackButton: () => null };
    if (name.startsWith("@/")) return load(`src/${name.slice(2)}`);
    if (name.startsWith(".")) return load(path.resolve(path.dirname(filename), name));
    return require(name);
  }, exports);
  return exports;
}
const { MaterialMedia } = load("src/components/MaterialMedia.tsx");
const { MaterialReadButton } = load(
  "src/app/(app)/subjects/materi/[materialId]/MaterialReadButton.tsx",
);
const { MaterialsTab } = load("src/app/(app)/classroom/MaterialsTab.tsx");
const { default: MaterialPage } = load("src/app/(app)/subjects/materi/[materialId]/page.tsx");
const material = {
  id: "material",
  subjectId: "subject",
  title: "Materi Pecahan",
  kind: "pdf",
  url: "https://storage.example/storage/v1/object/public/learning-materials/class/subject/file.pdf",
  content: null,
  learningObjectiveId: "tp",
  learningObjectiveTitle: "Mengenal pecahan",
  isActive: true,
  createdAt: "2026-10-15T00:00:00Z",
};
const combos = [
  { classId: "class", subjectId: "subject", className: "4A", subjectName: "Matematika" },
];
const objectives = [{ id: "tp", title: "Mengenal pecahan", sortOrder: 1 }];
function teacher(row = material) {
  return h(MaterialsTab, {
    combos,
    materialsByKey: { "class:subject": [row] },
    objectivesByKey: { "class:subject": objectives },
  });
}
function button(text) {
  const found = [...document.querySelectorAll("button")].find(
    (node) => node.textContent.trim() === text,
  );
  assert.ok(found, `Button not found: ${text}`);
  return found;
}
async function click(text) {
  await act(async () => button(text).click());
}
async function render(node) {
  await act(async () => root.render(node));
}
async function change(input, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(
      input,
      value,
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(() => {
  document.body.innerHTML = "<div id='root'></div>";
  root = createRoot(document.getElementById("root"));
  calls = [];
  errors = [];
  successes = [];
  refreshed = 0;
  result = { ok: false, message: "Simulasi gagal menyimpan" };
});
afterEach(async () => {
  await act(async () => root.unmount());
});
after(() => dom.window.close());

test("reader rendering/prefetch does not mark the material read", async () => {
  await render(await MaterialPage({ params: Promise.resolve({ materialId: "material" }) }));
  assert.equal(calls.length, 0);
  assert.match(document.body.textContent, /Tujuan Pembelajaran \(TP\)/);
  assert.match(document.body.textContent, /Belum ditandai dibaca/);
  assert.equal(document.querySelectorAll("iframe").length, 0);
});

test("read failure leaves a retry button; success advances progress only after the response", async () => {
  await render(h(MaterialReadButton, { materialId: "material", viewed: false }));
  assert.equal(calls.length, 0);
  await click("Tandai sudah dibaca");
  assert.equal(errors.length, 1);
  assert.equal(refreshed, 0);
  assert.ok(button("Tandai sudah dibaca"));
  let resolve;
  result = () =>
    new Promise((done) => {
      resolve = done;
    });
  await click("Tandai sudah dibaca");
  assert.equal(button("Menyimpan...").disabled, true);
  assert.match(document.body.textContent, /Belum ditandai dibaca/);
  await act(async () => resolve({ ok: true, message: "Tersimpan" }));
  assert.match(document.body.textContent, /Sudah dibaca/);
  assert.equal(document.querySelectorAll("button").length, 0);
  assert.equal(refreshed, 1);
});

test("network failure keeps the read action retryable", async () => {
  result = () => Promise.reject(new Error("Offline"));
  await render(h(MaterialReadButton, { materialId: "material", viewed: false }));
  await click("Tandai sudah dibaca");
  assert.equal(errors.length, 1);
  assert.equal(button("Tandai sudah dibaca").disabled, false);
});

test("existing read progress stays read without issuing another mutation", async () => {
  await render(h(MaterialReadButton, { materialId: "material", viewed: true }));
  assert.match(document.body.textContent, /Sudah dibaca/);
  assert.equal(document.querySelectorAll("button").length, 0);
  assert.equal(calls.length, 0);
});

for (const [kind, url, label] of [
  ["pdf", material.url, "Tampilkan PDF"],
  ["video", "https://youtu.be/dQw4w9WgXcQ", "Tampilkan video"],
  ["slideshow", "https://docs.google.com/presentation/d/e/2PACX-id/pub", "Tampilkan presentasi"],
])
  test(`${kind} preview is on demand and keeps an external fallback`, async () => {
    await render(h(MaterialMedia, { kind, url, title: "Materi" }));
    assert.equal(document.querySelectorAll("iframe").length, 0);
    const fallback = document.querySelector("a[target='_blank']");
    assert.ok(fallback);
    assert.match(fallback.rel, /noopener/);
    await click(label);
    assert.equal(document.querySelectorAll("iframe").length, 1);
    await click("Tutup pratinjau");
    assert.equal(document.querySelectorAll("iframe").length, 0);
    if (kind === "pdf")
      assert.equal(
        new URL(document.querySelector("a[download]").href).searchParams.get("download"),
        "Materi.pdf",
      );
  });

test("broken legacy slideshow displays an explanation rather than a broken iframe", async () => {
  await render(
    h(MaterialMedia, {
      kind: "slideshow",
      url: "https://docs.google.com/presentation/d/e/embed",
      title: "Materi",
    }),
  );
  assert.match(document.body.textContent, /Tautan materi tidak valid/);
  assert.equal(document.querySelectorAll("iframe").length, 0);
});

test("Canva preview loads only on request and opens the view link without embed mode", async () => {
  const viewUrl = "https://www.canva.com/design/DAG-example/share_token/view";
  await render(h(MaterialMedia, { kind: "slideshow", url: `${viewUrl}?embed`, title: "Canva" }));
  assert.equal(document.querySelectorAll("iframe").length, 0);
  assert.equal(document.querySelector("a[target='_blank']").href, viewUrl);
  await click("Tampilkan presentasi");
  assert.equal(document.querySelector("iframe").src, `${viewUrl}?embed`);
  await click("Tutup pratinjau");
  assert.equal(document.querySelectorAll("iframe").length, 0);
});

test("teacher can preview and submit a replacement Canva link from the edit form", async () => {
  const oldUrl = "https://docs.google.com/presentation/d/example/embed";
  const canvaUrl = "https://www.canva.com/design/DAG-example/share_token/view";
  await render(teacher({ ...material, kind: "slideshow", url: oldUrl }));
  await act(async () =>
    [...document.querySelectorAll("button")]
      .find((node) => node.textContent.includes("Materi Pecahan"))
      .click(),
  );
  await click("Edit");
  assert.match(document.body.textContent, /Tautan Google Slides atau Canva/);
  const input = [...document.querySelectorAll("input")].find((node) => node.value === oldUrl);
  await change(input, canvaUrl);
  await click("Tampilkan presentasi");
  assert.equal(document.querySelector("iframe").src, `${canvaUrl}?embed`);
  await click("Simpan Perubahan");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].get("url"), canvaUrl);
  assert.equal(calls[0][0].get("learning_objective_id"), "tp");
  await change(input, canvaUrl.replace("/view", "/edit"));
  await click("Simpan Perubahan");
  assert.equal(calls.length, 1);
  assert.match(errors.at(-1), /bukan tautan edit Canva/);
});

test("teacher can create a Canva slideshow with the existing type and TP selector", async () => {
  await render(teacher());
  await click("Buka Form");
  async function choose(index, text) {
    const trigger = document.querySelectorAll("button[role='combobox']")[index];
    await act(async () =>
      trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    const option = [...document.querySelectorAll("[role='option']")].find((node) =>
      node.textContent.includes(text),
    );
    assert.ok(option);
    await act(async () => {
      option.focus();
      option.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
  }
  await choose(1, "Slideshow Presentasi");
  await choose(2, "Mengenal pecahan");
  await change(document.querySelector("input[name='title']"), "Presentasi Canva");
  await change(
    document.querySelector("input[name='url']"),
    "https://www.canva.com/design/DAG-example/token/view",
  );
  await click("Publikasikan Materi");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].get("kind"), "slideshow");
  assert.equal(calls[0][0].get("url"), "https://www.canva.com/design/DAG-example/token/view");
  assert.equal(calls[0][0].get("learning_objective_id"), "tp");
});

test("teacher collapsing an expanded material unmounts its loaded iframe", async () => {
  await render(teacher());
  assert.equal(document.querySelectorAll("iframe").length, 0);
  const row = [...document.querySelectorAll("button")].find((node) =>
    node.textContent.includes("Materi Pecahan"),
  );
  await act(async () => row.click());
  await click("Tampilkan PDF");
  assert.equal(document.querySelectorAll("iframe").length, 1);
  await act(async () => row.click());
  assert.equal(document.querySelectorAll("iframe").length, 0);
});

test("failed teacher edit preserves the title and attachment choice; cancellation restores the old file", async () => {
  await render(teacher());
  await act(async () =>
    [...document.querySelectorAll("button")]
      .find((node) => node.textContent.includes("Materi Pecahan"))
      .click(),
  );
  await click("Edit");
  const title = [...document.querySelectorAll("input")].find(
    (node) => node.value === "Materi Pecahan",
  );
  await change(title, "Judul diperbaiki");
  const input = document.querySelector("input[type='file']");
  const file = new File(["%PDF-1.7"], "baru.pdf", { type: "application/pdf" });
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  await click("Simpan Perubahan");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].get("title"), "Judul diperbaiki");
  assert.equal(calls[0][0].get("file").name, "baru.pdf");
  assert.equal(title.value, "Judul diperbaiki");
  assert.match(document.body.textContent, /Pengganti: baru.pdf/);
  await click("Batalkan penggantian");
  assert.doesNotMatch(document.body.textContent, /Pengganti: baru.pdf/);
  await click("Simpan Perubahan");
  assert.equal(calls[1][0].has("file"), false);
  await click("Batal");
  assert.ok(button("Edit"));
});

test("teacher creation keeps failed input and resets the form only after a successful save", async () => {
  await render(teacher());
  await click("Buka Form");
  await change(document.querySelector("input[name='title']"), "Materi baru");
  const editor = document.querySelector("textarea[name='content']");
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(
      editor,
      "<p>Isi materi</p>",
    );
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const objective = document.querySelectorAll("button[role='combobox']")[2];
  await act(async () =>
    objective.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  const option = [...document.querySelectorAll("[role='option']")].find((node) =>
    node.textContent.includes("Mengenal pecahan"),
  );
  assert.ok(option);
  await act(async () => {
    option.focus();
    option.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await click("Publikasikan Materi");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].get("status"), "published");
  assert.equal(calls[0][0].get("learning_objective_id"), "tp");
  assert.equal(document.querySelector("input[name='title']").value, "Materi baru");
  assert.equal(editor.value, "<p>Isi materi</p>");
  result = { ok: true, message: "Tersimpan" };
  await click("Simpan Draft");
  assert.equal(calls[1][0].get("status"), "draft");
  assert.ok(button("Buka Form"));
  await click("Buka Form");
  assert.equal(document.querySelector("input[name='title']").value, "");
  assert.equal(document.querySelector("textarea[name='content']").value, "");
  assert.match(document.querySelectorAll("button[role='combobox']")[2].textContent, /Pilih TP/);
});
