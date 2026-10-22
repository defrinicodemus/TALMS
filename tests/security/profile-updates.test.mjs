import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

// Execute the real profile schema, role helpers, RLS, and guard in PostgreSQL.
// Supabase Auth's users table/JWT context and API grants are fixture scaffolding.
// This database lives in memory and never connects to the project's Supabase.
const db = new PGlite({ extensions: { pgcrypto } });
const id = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const users = { student: id(1), teacher: id(2), principal: id(3), admin: id(4), other: id(5) };
const school = id(10);
const otherSchool = id(11);
const classroom = id(20);
const otherClassroom = id(21);

async function applyMigration(name) {
  const sql = await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
  await db.exec(sql);
}

async function asUser(userId, databaseRole = "authenticated") {
  assert.ok(["authenticated", "anon", "service_role"].includes(databaseRole));
  await db.exec(`set local role ${databaseRole}`);
  await db.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: userId, role: databaseRole }),
  ]);
}

async function profile(userId) {
  const { rows } = await db.query("select * from public.profiles where id = $1", [userId]);
  assert.equal(rows.length, 1);
  return rows[0];
}

async function denied(sql, params) {
  await db.exec("savepoint denied_change");
  await assert.rejects(db.query(sql, params), { code: "42501" });
  await db.exec("rollback to savepoint denied_change; release savepoint denied_change");
}

before(async () => {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create role supabase_auth_admin nologin;
    create schema auth;
    create table auth.users (
      id uuid primary key,
      email text,
      raw_app_meta_data jsonb not null default '{}',
      raw_user_meta_data jsonb not null default '{}'
    );
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
    $$;
  `);

  for (const migration of [
    "20260705000001_schema.sql",
    "20260705000002_functions.sql",
    "20260705000003_rls.sql",
    "20260709000003_notification_seen.sql",
    "20260927000000_protect_profile_updates.sql",
    "20260927000001_protect_account_creation.sql",
  ]) {
    await applyMigration(migration);
  }

  await db.exec(`
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant usage on schema auth to supabase_auth_admin;
    grant select, insert, update on auth.users to supabase_auth_admin;
    grant all on all tables in schema public to anon, authenticated, service_role;
    insert into public.schools (id, name) values
      ('${school}', 'School A'), ('${otherSchool}', 'School B');
    insert into public.academic_years (id, school_id, year_label, semester) values
      ('${id(30)}', '${school}', '2026/2027', 'ganjil'),
      ('${id(31)}', '${otherSchool}', '2026/2027', 'ganjil');
    insert into public.classes (id, school_id, academic_year_id, name, grade_level) values
      ('${classroom}', '${school}', '${id(30)}', '4A', 4),
      ('${otherClassroom}', '${otherSchool}', '${id(31)}', '5A', 5);
  `);

  for (const [name, userId] of Object.entries(users)) {
    const initialProfile = {
      role: name === "other" ? "student" : name,
      full_name: name,
      username: name,
      avatar_emoji: "🙂",
      school_id: school,
      class_id: classroom,
    };
    await db.query(
      `insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
       values ($1, $2, $3, $4)`,
      [
        userId,
        `${name}@example.test`,
        JSON.stringify(initialProfile),
        JSON.stringify({ lms_profile: initialProfile }),
      ],
    );
  }
});

beforeEach(async () => db.exec("begin"));
afterEach(async () => db.exec("rollback"));
after(async () => db.close());

test("old RLS alone permits self-promotion when the API has UPDATE permission", async () => {
  // Reproduce the old behavior only in this disposable transaction.
  await db.exec("drop trigger profiles_guard_update on public.profiles");
  await asUser(users.student);
  await db.query("update public.profiles set role = 'admin' where id = $1", [users.student]);
  assert.equal((await profile(users.student)).role, "admin");
});

for (const role of ["student", "teacher", "principal"]) {
  test(`${role} cannot promote themselves to any other role`, async () => {
    await asUser(users[role]);
    const original = await profile(users[role]);
    for (const targetRole of ["student", "teacher", "principal", "admin"]) {
      if (targetRole === role) continue;
      await denied("update public.profiles set role = $1 where id = $2", [targetRole, users[role]]);
      assert.deepEqual(await profile(users[role]), original);
    }
  });

  test(`${role} can edit their avatar and mark announcements read`, async () => {
    await asUser(users[role]);
    const before = await profile(users[role]);
    await db.query(
      `update public.profiles set avatar_emoji = '🌟',
         last_seen_announcements_at = '2030-01-01T00:00:00Z', updated_at = '2000-01-01'
       where id = $1`,
      [users[role]],
    );
    const updated = await profile(users[role]);
    assert.equal(updated.avatar_emoji, "🌟");
    assert.equal(updated.last_seen_announcements_at.toISOString(), "2030-01-01T00:00:00.000Z");
    assert.notEqual(updated.updated_at.toISOString(), "2000-01-01T00:00:00.000Z");
    assert.equal(updated.role, before.role);
    assert.equal(updated.school_id, before.school_id);
    assert.equal(updated.class_id, before.class_id);
  });

  test(`${role} cannot update another user's profile, even safe fields`, async () => {
    await asUser(users[role]);
    const { affectedRows } = await db.query(
      "update public.profiles set avatar_emoji = '🌟' where id = $1",
      [users.other],
    );
    assert.equal(affectedRows, 0);
  });
}

test("student cannot change identity, class, or school, including null transitions", async () => {
  await asUser(users.student);
  const original = await profile(users.student);
  for (const [column, value] of [
    ["id", id(99)],
    ["full_name", "Forged name"],
    ["username", "forged"],
    ["nisn", "1234567890"],
    ["nip", "123456789012345678"],
    ["class_id", otherClassroom],
    ["class_id", null],
    ["school_id", otherSchool],
    ["school_id", null],
    ["created_at", "2000-01-01"],
  ]) {
    await denied(`update public.profiles set ${column} = $1 where id = $2`, [value, users.student]);
    assert.deepEqual(await profile(users.student), original);
  }
});

test("a mixed safe/privileged update is rejected atomically", async () => {
  await asUser(users.student);
  const original = await profile(users.student);
  await denied("update public.profiles set role = 'admin', avatar_emoji = '🌟' where id = $1", [
    users.student,
  ]);
  assert.deepEqual(await profile(users.student), original);
});

test("an upsert cannot overwrite the student's role", async () => {
  await asUser(users.student);
  await denied(
    `insert into public.profiles (id, full_name, role) values ($1, 'Forged', 'admin')
     on conflict (id) do update set role = excluded.role`,
    [users.student],
  );
  assert.equal((await profile(users.student)).role, "student");
});

test("JWT claims cannot override the actual database role or stored profile role", async () => {
  await asUser(users.student);
  await db.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({
      sub: users.student,
      role: "service_role",
      user_metadata: { role: "admin" },
    }),
  ]);
  await denied("update public.profiles set role = 'admin' where id = $1", [users.student]);
  assert.equal((await profile(users.student)).role, "student");
});

test("anonymous requests cannot modify profiles", async () => {
  await asUser(null, "anon");
  const { affectedRows } = await db.query(
    "update public.profiles set role = 'admin' where id = $1",
    [users.student],
  );
  assert.equal(affectedRows, 0);
});

test("an authenticated admin can manage student identity, role, class, and school", async () => {
  await asUser(users.admin);
  await db.query(
    `update public.profiles set full_name = 'Updated student', username = '123', nisn = '123',
       role = 'teacher', class_id = $1, school_id = $2 where id = $3`,
    [otherClassroom, otherSchool, users.student],
  );
  const updated = await profile(users.student);
  assert.equal(updated.role, "teacher");
  assert.equal(updated.full_name, "Updated student");
  assert.equal(updated.username, "123");
  assert.equal(updated.nisn, "123");
  assert.equal(updated.class_id, otherClassroom);
  assert.equal(updated.school_id, otherSchool);
});

test("an authenticated admin can edit their own profile and staff identity", async () => {
  await asUser(users.admin);
  await db.query("update public.profiles set full_name = 'Updated admin' where id = $1", [
    users.admin,
  ]);
  await db.query(
    "update public.profiles set full_name = 'Updated teacher', nip = '456' where id = $1",
    [users.teacher],
  );
  assert.equal((await profile(users.admin)).full_name, "Updated admin");
  assert.equal((await profile(users.teacher)).nip, "456");
});

test("admin class deletion still clears profile class references", async () => {
  await asUser(users.admin);
  await db.query("delete from public.classes where id = $1", [classroom]);
  assert.equal((await profile(users.student)).class_id, null);
});

test("trusted backend service role can maintain profiles without an end-user JWT", async () => {
  await asUser(null, "service_role");
  await db.query("update public.profiles set role = 'teacher', class_id = null where id = $1", [
    users.student,
  ]);
  assert.equal((await profile(users.student)).role, "teacher");
  assert.equal((await profile(users.student)).class_id, null);
});

test("database maintenance can update profiles without an end-user JWT", async () => {
  await db.query("update public.profiles set school_id = null where id = $1", [users.student]);
  assert.equal((await profile(users.student)).school_id, null);
});

test("new profile columns are protected unless explicitly allowed", async () => {
  await db.exec("alter table public.profiles add column future_privileged_field text");
  await asUser(users.student);
  await denied("update public.profiles set future_privileged_field = 'forged' where id = $1", [
    users.student,
  ]);
  assert.equal((await profile(users.student)).future_privileged_field, null);
});

// Auth runs as a separate database role. Admin createUser inserts first, then
// writes custom app_metadata inside the same transaction; model that ordering.
const newUser = id(100);
const approvedProfile = {
  role: "student",
  full_name: "Approved student",
  username: "new-student",
  nisn: "9876543210",
  school_id: school,
  class_id: classroom,
};

async function insertAuthUser(userMetadata = {}, appMetadata = {}) {
  await db.exec("set local role supabase_auth_admin");
  return db.query(
    `insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
     values ($1, 'new-user@example.test', $2, $3)`,
    [newUser, JSON.stringify(userMetadata), JSON.stringify(appMetadata)],
  );
}

async function setAppMetadata(metadata) {
  return db.query("update auth.users set raw_app_meta_data = $1 where id = $2", [
    JSON.stringify(metadata),
    newUser,
  ]);
}

for (const requestedRole of ["student", "teacher", "principal", "admin"]) {
  test(`signup metadata requesting ${requestedRole} cannot assign a role, class, school, or identity`, async () => {
    const forged = { ...approvedProfile, role: requestedRole, nip: "forged-nip" };
    await insertAuthUser({
      ...forged,
      lms_profile: forged,
      app_metadata: { lms_profile: forged },
    });
    await db.exec("reset role");
    const created = await profile(newUser);
    assert.equal(created.role, "student");
    for (const column of ["class_id", "school_id", "username", "nisn", "nip"]) {
      assert.equal(created[column], null, column);
    }
  });

  test(`Auth's two-step admin creation correctly provisions ${requestedRole}`, async () => {
    const trusted = { ...approvedProfile, role: requestedRole };
    await insertAuthUser({ role: "admin", school_id: otherSchool, class_id: otherClassroom });
    await setAppMetadata({ provider: "email", lms_profile: trusted });
    await db.exec("reset role");
    const created = await profile(newUser);
    for (const [column, value] of Object.entries(trusted)) {
      assert.equal(created[column], value, column);
    }
  });
}

test("trusted metadata supplied during INSERT wins over conflicting user metadata", async () => {
  await insertAuthUser(
    { ...approvedProfile, role: "admin", class_id: otherClassroom, username: "forged" },
    { lms_profile: approvedProfile },
  );
  await db.exec("reset role");
  const created = await profile(newUser);
  for (const [column, value] of Object.entries(approvedProfile)) {
    assert.equal(created[column], value, column);
  }
});

test("later user metadata changes cannot promote an account or overwrite its profile", async () => {
  await insertAuthUser({}, { lms_profile: approvedProfile });
  await db.query("update auth.users set raw_user_meta_data = $1 where id = $2", [
    JSON.stringify({ role: "admin", class_id: otherClassroom, lms_profile: { role: "admin" } }),
    newUser,
  ]);
  await db.exec("reset role");
  assert.equal((await profile(newUser)).role, "student");
  assert.equal((await profile(newUser)).class_id, classroom);
});

test("subsequent app metadata updates do not reset profile edits or class promotion", async () => {
  await insertAuthUser({}, { lms_profile: approvedProfile });
  await db.exec("reset role");
  await asUser(users.admin);
  await db.query(
    "update public.profiles set class_id = $1, full_name = 'Updated name' where id = $2",
    [otherClassroom, newUser],
  );
  await db.exec("set local role supabase_auth_admin");
  await setAppMetadata({ lms_profile: approvedProfile, another_setting: true });
  await setAppMetadata({ lms_profile: { ...approvedProfile, role: "admin" } });
  await db.exec("reset role");
  const updated = await profile(newUser);
  assert.equal(updated.role, "student");
  assert.equal(updated.class_id, otherClassroom);
  assert.equal(updated.full_name, "Updated name");
});

for (const [label, snapshot, errorCode] of [
  ["missing role", { full_name: "Test", username: "test" }, "22023"],
  ["invalid role", { ...approvedProfile, role: "owner" }, "22023"],
  ["empty name", { ...approvedProfile, full_name: " " }, "22023"],
  ["null snapshot", null, "22023"],
  ["array snapshot", [], "22023"],
  ["invalid class", { ...approvedProfile, class_id: id(999) }, "23503"],
  ["duplicate username", { ...approvedProfile, username: "admin" }, "23505"],
]) {
  test(`invalid provisioning (${label}) rolls back both the Auth user and profile`, async () => {
    await db.exec("savepoint create_account");
    await insertAuthUser();
    await assert.rejects(setAppMetadata({ lms_profile: snapshot }), { code: errorCode });
    await db.exec("rollback to savepoint create_account; release savepoint create_account");
    for (const table of ["auth.users", "public.profiles"]) {
      const { rows } = await db.query(`select id from ${table} where id = $1`, [newUser]);
      assert.equal(rows.length, 0, table);
    }
  });
}

test("authenticated users cannot directly change trusted Auth metadata", async () => {
  await asUser(users.student);
  await denied("update auth.users set raw_app_meta_data = $1 where id = $2", [
    JSON.stringify({ lms_profile: { ...approvedProfile, role: "admin" } }),
    users.student,
  ]);
});

test("the account import creates only the requested teachers and students", async () => {
  // Only this isolated, in-memory test database is cleared. afterEach rolls back.
  await db.exec(`
    truncate auth.users, public.schools cascade;
    alter table auth.users
      add column instance_id uuid,
      add column aud text,
      add column role text,
      add column encrypted_password text,
      add column email_confirmed_at timestamptz,
      add column recovery_sent_at timestamptz,
      add column last_sign_in_at timestamptz,
      add column created_at timestamptz,
      add column updated_at timestamptz,
      add column confirmation_token text,
      add column email_change text,
      add column email_change_token_new text,
      add column recovery_token text;
    create table auth.identities (
      id uuid primary key, user_id uuid references auth.users(id), provider_id text,
      identity_data jsonb, provider text, last_sign_in_at timestamptz,
      created_at timestamptz, updated_at timestamptz
    );
    insert into public.schools (id, name) values ('${school}', 'School A');
    insert into public.academic_years (id, school_id, year_label, semester, is_active)
      values ('${id(30)}', '${school}', '2026/2027', 'ganjil', true);
    insert into public.classes (id, school_id, academic_year_id, name, grade_level)
    select gen_random_uuid(), '${school}', '${id(30)}', 'Kelas ' || grade, grade
    from generate_series(1, 6) as grade;
  `);
  await applyMigration("20261022000001_import_teachers_students.sql");

  const { rows } = await db.query(
    "select role, count(*)::int as count from public.profiles group by role order by role",
  );
  assert.deepEqual(rows, [
    { role: "student", count: 30 },
    { role: "teacher", count: 9 },
  ]);

  const { rows: students } = await db.query(
    `select p.school_id, p.class_id, p.nisn, p.username, c.grade_level
     from public.profiles p join public.classes c on c.id = p.class_id
     where p.role = 'student'`,
  );
  assert.ok(
    students.every(
      (student) =>
        student.school_id === school &&
        student.class_id &&
        student.username === student.nisn &&
        Number(student.nisn.slice(2, 4)) === student.grade_level,
    ),
  );

  const { rows: teachers } = await db.query(
    "select school_id, class_id, nip, username from public.profiles where role = 'teacher'",
  );
  assert.ok(
    teachers.every(
      (teacher) =>
        teacher.school_id === school &&
        teacher.class_id === null &&
        teacher.username === teacher.nip,
    ),
  );

  const { rows: authSummary } = await db.query(`
    select
      (select count(*)::int from auth.users) as users,
      (select count(*)::int from auth.identities) as identities,
      (select count(*)::int from auth.users u join public.profiles p on p.id = u.id
       where u.email = p.username || '@nggodimeda.sch.id'
         and u.email_confirmed_at is not null
         and u.encrypted_password = crypt(p.username, u.encrypted_password)) as valid_logins,
      (select count(*)::int from public.class_teacher_subjects) as assignments
  `);
  assert.deepEqual(authSummary[0], {
    users: 39,
    identities: 39,
    valid_logins: 39,
    assignments: 0,
  });
});
