// Explicit hosted verification, excluded from the *.test.mjs automatic suite.
// Usage: node --env-file=.env.local tests/security/verify-hosted-student-transfers.mjs --temporary-data
// Creates only tagged, disposable school/account fixtures and removes them in finally.
// Credentials/session tokens stay in memory. Existing rows are fingerprinted, never modified.
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

assert.ok(process.argv.includes("--temporary-data"), "Explicit --temporary-data flag is required.");
for (const name of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
])
  assert.ok(process.env[name], `Missing configuration: ${name}`);
const options = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(20000) }) },
};
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const anon = createClient(url, key, options);
const run = randomUUID();
const school = randomUUID(),
  outsideSchool = randomUUID();
const schoolIds = [school, outsideSchool];
const years = Object.fromEntries(
  ["ganjil", "genap", "next", "later", "outside"].map((name) => [name, randomUUID()]),
);
const classes = Object.fromEntries(
  ["four", "five", "six", "semesterSix", "nextFour", "nextFive", "nextSix", "outside"].map(
    (name) => [name, randomUUID()],
  ),
);
const subject = randomUUID();
const credentials = new Map();
const users = {};
const tables = [
  "schools",
  "academic_years",
  "subjects",
  "classes",
  "profiles",
  "class_teacher_subjects",
  "materials",
  "assignments",
  "submissions",
  "grades",
  "curriculum_plans",
  "learning_objectives",
  "class_meetings",
  "attendance_records",
  "quiz_questions",
  "quiz_answers",
  "material_views",
];
let checks = 0,
  before,
  cleanupError = null;

function value(result, context) {
  if (result.error)
    throw new Error(`${context}: ${result.error.code ?? ""} ${result.error.message}`);
  return result.data;
}
function pass(label) {
  checks++;
  console.log(`PASS ${label}`);
}
async function fingerprint() {
  const result = {};
  for (const table of tables) {
    const hash = createHash("sha256");
    let count = 0;
    for (let offset = 0; ; offset += 1000) {
      const rows = value(
        await service
          .from(table)
          .select("*")
          .order("id")
          .range(offset, offset + 999),
        `Read ${table}`,
      );
      for (const row of rows) hash.update(JSON.stringify(row));
      count += rows.length;
      if (rows.length < 1000) break;
    }
    result[table] = { count, digest: hash.digest("hex") };
  }
  return result;
}
async function placements() {
  return value(
    await service.from("profiles").select("id, class_id").in("school_id", schoolIds).order("id"),
    "Read fixture placements",
  );
}
async function fixtureStructure() {
  return {
    years: value(
      await service.from("academic_years").select("*").in("school_id", schoolIds).order("id"),
      "Read fixture periods",
    ),
    classes: value(
      await service.from("classes").select("*").in("id", Object.values(classes)).order("id"),
      "Read fixture classes",
    ),
    teachers: value(
      await service
        .from("class_teacher_subjects")
        .select("*")
        .in("class_id", Object.values(classes))
        .order("id"),
      "Read fixture assignments",
    ),
  };
}
function map(source, target, students) {
  return {
    sourceClassId: classes[source],
    targetClassId: classes[target],
    studentIds: students.map((name) => users[name] ?? name),
  };
}
function params(mappings, kind = "promotion", source = "genap", target = "next") {
  return {
    p_kind: kind,
    p_source_year_id: years[source],
    p_target_year_id: years[target],
    p_mappings: mappings,
  };
}
async function rejected(client, payload, code, label) {
  const beforeRows = await placements();
  const result = await client.rpc("transfer_academic_students", payload);
  const allowedCodes = Array.isArray(code) ? code : [code];
  assert.ok(
    allowedCodes.includes(result.error?.code),
    `${label}: expected ${allowedCodes.join("/")}, got ${result.error?.code ?? "success"}: ${result.error?.message ?? ""}`,
  );
  assert.deepEqual(await placements(), beforeRows, `${label}: placements changed`);
  pass(label);
}
async function createUser(name, role, cls = null, schoolId = school) {
  const password = randomBytes(30).toString("base64url");
  const email = `transfer-${run}-${name}@example.invalid`;
  const data = value(
    await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: {
        lms_transfer_test_run: run,
        lms_profile: {
          role,
          full_name: `Uji perpindahan ${name}`,
          username: `test-${run}-${name}`,
          school_id: schoolId,
          class_id: cls,
        },
      },
    }),
    `Create fixture ${name}`,
  );
  users[name] = data.user.id;
  credentials.set(name, { email, password });
  // Fixture initialization uses the trusted API, independent of the project's
  // deployed signup/provisioning trigger. All tested RPCs use ordinary logins.
  const profile = value(
    await service
      .from("profiles")
      .update({ role, school_id: schoolId, class_id: cls })
      .eq("id", data.user.id)
      .select("id, role, school_id, class_id")
      .single(),
    `Initialize fixture profile ${name}`,
  );
  assert.deepEqual(profile, { id: data.user.id, role, school_id: schoolId, class_id: cls });
}
async function login(name) {
  const client = createClient(url, key, options);
  value(
    await client.auth.signInWithPassword(credentials.get(name)),
    `Authenticate fixture ${name}`,
  );
  return client;
}
async function cleanup() {
  // Recover any account whose create request timed out after being committed.
  const tagged = new Set(Object.values(users));
  for (let page = 1; ; page++) {
    const data = value(
      await service.auth.admin.listUsers({ page, perPage: 1000 }),
      "Discover fixture cleanup",
    );
    for (const user of data.users)
      if (user.app_metadata?.lms_transfer_test_run === run) tagged.add(user.id);
    if (data.users.length < 1000) break;
  }
  for (const id of tagged) value(await service.auth.admin.deleteUser(id), "Remove fixture account");
  value(await service.from("schools").delete().in("id", schoolIds), "Remove fixture schools");
  const leftovers = value(
    await service.from("schools").select("id").in("id", schoolIds),
    "Verify cleanup",
  );
  assert.equal(leftovers.length, 0);
  console.log(`CLEANUP removed ${tagged.size} temporary accounts and temporary school structures`);
}

try {
  before = await fingerprint();
  console.log(`BASELINE captured ${tables.length} tables (values are not logged)`);
  const denied = await anon.rpc("transfer_academic_students", {
    p_kind: "promotion",
    p_source_year_id: null,
    p_target_year_id: null,
    p_mappings: [],
  });
  assert.equal(denied.error?.code, "42501");
  pass("deployed RPC denies anonymous access");

  value(
    await service
      .from("schools")
      .insert(schoolIds.map((id) => ({ id, name: `__TEST_TRANSFER_${run}__` }))),
    "Create fixture schools",
  );
  value(
    await service.from("academic_years").insert([
      {
        id: years.ganjil,
        school_id: school,
        year_label: "2024/2025",
        semester: "ganjil",
        is_active: false,
      },
      {
        id: years.genap,
        school_id: school,
        year_label: "2024/2025",
        semester: "genap",
        is_active: false,
      },
      {
        id: years.next,
        school_id: school,
        year_label: "2025/2026",
        semester: "ganjil",
        is_active: false,
      },
      {
        id: years.later,
        school_id: school,
        year_label: "2026/2027",
        semester: "ganjil",
        is_active: false,
      },
      {
        id: years.outside,
        school_id: outsideSchool,
        year_label: "2025/2026",
        semester: "ganjil",
        is_active: false,
      },
    ]),
    "Create fixture periods",
  );
  value(
    await service.from("classes").insert(
      [
        ["four", "genap", 4],
        ["five", "genap", 5],
        ["six", "genap", 6],
        ["semesterSix", "ganjil", 6],
        ["nextFour", "next", 4],
        ["nextFive", "next", 5],
        ["nextSix", "next", 6],
        ["outside", "outside", 5],
      ].map(([name, year, grade]) => ({
        id: classes[name],
        school_id: name === "outside" ? outsideSchool : school,
        academic_year_id: years[year],
        name: `Uji ${name}`,
        grade_level: grade,
      })),
    ),
    "Create fixture classes",
  );
  for (const [name, role, cls, schoolId] of [
    ["admin", "admin"],
    ["teacher", "teacher"],
    ["newTeacher", "teacher"],
    ["principal", "principal"],
    ["selected", "student", classes.four],
    ["skipped", "student", classes.four],
    ["five", "student", classes.five],
    ["six", "student", classes.six],
    ["semesterSix", "student", classes.semesterSix],
    ["race", "student", classes.five],
    ["outsideAdmin", "admin", null, outsideSchool],
  ])
    await createUser(name, role, cls, schoolId);
  value(
    await service
      .from("subjects")
      .insert({ id: subject, school_id: school, code: "TEST-MTK", name: "Mapel uji" }),
    "Create fixture subject",
  );
  value(
    await service.from("class_teacher_subjects").insert([
      { class_id: classes.four, subject_id: subject, teacher_id: users.teacher },
      { class_id: classes.nextFive, subject_id: subject, teacher_id: users.newTeacher },
    ]),
    "Create fixture assignments",
  );
  const fixtureClass = value(
    await service.from("classes").select("*").eq("id", classes.four).single(),
    "Inspect deployed class fields",
  );
  if (Object.hasOwn(fixtureClass, "homeroom_teacher_id")) {
    value(
      await service
        .from("classes")
        .update({ homeroom_teacher_id: users.teacher })
        .eq("id", classes.four),
      "Set fixture homeroom",
    );
    value(
      await service
        .from("classes")
        .update({ homeroom_teacher_id: users.newTeacher })
        .eq("id", classes.nextFive),
      "Set destination homeroom",
    );
  } else {
    console.log(
      "INFO deployed classes omit homeroom_teacher_id; integrity checks cover actual class fields",
    );
  }
  console.log("FIXTURES ready; existing school periods and placements are untouched");

  const admin = await login("admin");
  const student = await login("selected");
  const normal = params([map("four", "nextFive", ["selected"])]);
  await rejected(student, normal, "42501", "student cannot transfer through direct API");
  await rejected(
    await login("teacher"),
    normal,
    "42501",
    "teacher cannot transfer through direct API",
  );
  await rejected(
    await login("principal"),
    normal,
    "42501",
    "principal cannot transfer through direct API",
  );
  await rejected(
    await login("outsideAdmin"),
    normal,
    ["22023", "42501"],
    "admin cannot transfer another school's students",
  );
  value(await admin.rpc("set_active_academic_year", { p_id: years.genap }), "Open fixture period");
  await rejected(
    admin,
    normal,
    "55000",
    "transfer rejected while the fixture school's period is active",
  );
  value(await admin.rpc("deactivate_academic_year", { p_id: years.genap }), "Close fixture period");

  for (const [label, payload] of [
    ["empty mappings rejected", params([])],
    [
      "same period rejected",
      params([map("four", "nextFive", ["selected"])], "promotion", "genap", "genap"),
    ],
    ["backward period rejected", params([], "promotion", "next", "genap")],
    ["skipped year rejected", params([], "promotion", "genap", "later")],
    ["wrong process type rejected", { ...normal, p_kind: "invalid" }],
    ["foreign period rejected", params([], "promotion", "genap", "outside")],
    ["foreign class rejected", params([map("four", "outside", ["selected"])])],
    ["wrong target grade rejected", params([map("four", "nextFour", ["selected"])])],
    ["grade six promotion rejected", params([map("six", "nextSix", ["six"])])],
    ["wrong student membership rejected", params([map("four", "nextFive", ["five"])])],
    ["duplicate student rejected", params([map("four", "nextFive", ["selected", "selected"])])],
    [
      "duplicate mapping rejected",
      params([map("four", "nextFive", ["selected"]), map("four", "nextSix", ["skipped"])]),
    ],
    ["empty student selection rejected", params([map("four", "nextFive", [])])],
    [
      "invalid second pair leaves first pair unchanged",
      params([map("four", "nextFive", ["selected"]), map("five", "nextSix", [randomUUID()])]),
    ],
  ])
    await rejected(admin, payload, "22023", label);

  const structureBefore = await fixtureStructure();
  assert.equal(
    value(
      await admin.rpc(
        "transfer_academic_students",
        params([map("four", "nextFive", ["selected"]), map("five", "nextSix", ["five"])]),
      ),
      "Promote fixtures",
    ),
    2,
  );
  const rows = await placements();
  assert.equal(rows.find((s) => s.id === users.selected).class_id, classes.nextFive);
  assert.equal(rows.find((s) => s.id === users.five).class_id, classes.nextSix);
  assert.equal(rows.find((s) => s.id === users.skipped).class_id, classes.four);
  assert.deepEqual(await fixtureStructure(), structureBefore);
  pass(
    "selected students move; skipped student, teachers, class structure and inactive periods stay unchanged",
  );
  await rejected(admin, normal, "22023", "replayed transfer rejected without partial writes");
  assert.equal(
    value(
      await admin.rpc(
        "transfer_academic_students",
        params([map("semesterSix", "six", ["semesterSix"])], "semester", "ganjil", "genap"),
      ),
      "Transfer grade six semester",
    ),
    1,
  );
  pass("grade six can transfer semester at the same grade");

  const duplicatePayload = params([map("four", "nextFive", ["skipped"])]);
  const concurrent = await Promise.all([
    admin.rpc("transfer_academic_students", duplicatePayload),
    admin.rpc("transfer_academic_students", duplicatePayload),
  ]);
  assert.equal(concurrent.filter((r) => !r.error && r.data === 1).length, 1);
  assert.equal(concurrent.filter((r) => r.error?.code === "22023").length, 1);
  pass("two simultaneous transfer requests commit exactly once");

  const [transferRace, activationRace] = await Promise.all([
    admin.rpc("transfer_academic_students", params([map("five", "nextSix", ["race"])])),
    admin.rpc("set_active_academic_year", { p_id: years.next }),
  ]);
  value(activationRace, "Activate concurrently with transfer");
  const raceClass = (await placements()).find((s) => s.id === users.race).class_id;
  if (transferRace.error) {
    assert.equal(transferRace.error.code, "55000");
    assert.equal(raceClass, classes.five);
  } else {
    assert.equal(transferRace.data, 1);
    assert.equal(raceClass, classes.nextSix);
  }
  pass("concurrent activation and transfer respect the shared school lock");
  await rejected(admin, duplicatePayload, "55000", "stale transfer after activation is rejected");
  const afterStructure = await fixtureStructure();
  assert.deepEqual(afterStructure.classes, structureBefore.classes);
  assert.deepEqual(afterStructure.teachers, structureBefore.teachers);
  assert.equal(afterStructure.years.filter((y) => y.school_id === school && y.is_active).length, 1);
  assert.equal(afterStructure.years.find((y) => y.id === years.next).is_active, true);
  pass("activation preserves prepared teacher assignments and class structure");

  assert.equal(value(await student.rpc("academic_access_open"), "Check student reopening"), true);
  const profile = value(
    await student
      .from("profiles")
      .select("class_id, classes!profiles_class_id_fkey(id)")
      .eq("id", users.selected)
      .single(),
    "Check active student placement",
  );
  assert.equal(profile.class_id, classes.nextFive);
  assert.equal(profile.classes?.id, classes.nextFive);
  pass("student sees the newly active prepared class through authenticated RLS");
} catch (error) {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
} finally {
  try {
    await cleanup();
  } catch (error) {
    cleanupError = error;
    console.error(`CLEANUP FAILED ${error.message}; fixture marker ${run}`);
    process.exitCode = 1;
  }
  if (before && !cleanupError) {
    const after = await fingerprint();
    const changed = tables.filter(
      (table) => JSON.stringify(before[table]) !== JSON.stringify(after[table]),
    );
    if (changed.length) {
      console.error(
        `BASELINE DIFFERENCE ${changed.join(", ")}; review concurrent activity; no existing rows were restored or overwritten`,
      );
      process.exitCode = 1;
    } else pass(`all existing rows in ${tables.length} tables unchanged after cleanup`);
  }
  console.log(
    JSON.stringify({
      checksPassed: checks,
      success: !process.exitCode,
      temporaryDataRemoved: !cleanupError,
    }),
  );
}
