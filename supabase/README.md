# Supabase schema — Emerald Academy LMS

This folder contains the full database schema for the SD Inpres Nggodimeda LMS:
schools, academic years, classes, subjects, profiles (students/teachers/principal/admin),
curriculum plans & learning objectives (TP), materials, assignments & quizzes, submissions,
grades, attendance/jurnal, and row-level security for all four roles.

## Files

- `migrations/20260705000001_schema.sql` — tables, enums, indexes
- `migrations/20260705000002_functions.sql` — `handle_new_user` signup trigger, role
  helpers used by RLS, and the `email_for_username` login lookup
- `migrations/20260705000003_rls.sql` — row-level security policies for every table
  created in the base schema
- everything after that is one migration per feature added post-launch (grade ranges,
  school logo, curriculum/TP, quiz bank, material views, gradebook locks, attendance
  journal, announcement categories, quiz builder, etc.) — see each file's own comment
- `seed.sql` — demo data matching the current mock UI (school, classes, subjects,
  10 demo accounts, announcements, materials, assignments, submissions, grades)

## Applying this to a Supabase project

1. Create a project at supabase.com (or use an existing one).
2. `supabase login`
3. `supabase link --project-ref <your-project-ref>`
4. `supabase db push` — applies all migrations in `migrations/`
5. Run the seed manually once (it's not applied by `db push`):
   `psql "$(supabase db remote-url)" -f supabase/seed.sql`
   (or paste `seed.sql` into the SQL Editor in the Supabase dashboard)

### Local development (optional, requires Docker)
```
supabase start        # boots local Postgres + Auth + Studio
supabase db reset     # applies migrations AND seed.sql automatically
```

## Profile update protection

Migration `migrations/20260927000000_protect_profile_updates.sql` adds a database
trigger to complement the existing profile RLS policies:

- Students, teachers, and principals can update only their own `avatar_emoji` and
  `last_seen_announcements_at`. The existing trigger maintains `updated_at`.
- Changing identity fields, role, class, or school requires an authenticated admin.
  New profile columns are protected by default.
- The trusted database roles `postgres`, `supabase_admin`, and `service_role` retain
  maintenance access. The trigger checks the actual database role and the admin's
  existing profile, not user-editable JWT metadata.
- Existing RLS still controls which rows a user can read or modify.

### Apply to the deployed database

Committing or deploying the Next.js code does **not** apply this protection to
Supabase. Apply the migration to the intended project with `supabase db push`
after reviewing its pending migrations. Alternatively, run the contents of
`migrations/20260927000000_protect_profile_updates.sql` once in that project's
Supabase SQL Editor. Do not rerun the original schema or seed on existing data.

After applying, confirm that the enabled trigger uses invoker privileges:

```sql
select t.tgname, t.tgenabled, p.prosecdef
from pg_trigger t
join pg_proc p on p.oid = t.tgfoid
where t.tgrelid = 'public.profiles'::regclass
  and t.tgname = 'profiles_guard_update';
-- Expected: profiles_guard_update | O | false
```

Verify with a test student account that changing `role`, `class_id`, or `school_id`
through the API fails, while avatar edits still succeed. Use a separate admin
account to confirm that student edits and class assignment still work.

### Automated regression tests

```sh
npm run test:security
```

Tests run the actual profile schema, helper functions, RLS, and security migrations in
an isolated in-memory PostgreSQL instance via PGlite. They scaffold Supabase Auth
and API grants. No credentials, Docker, or connection to the deployed database
are needed.

Coverage includes the original escalation with the guard temporarily removed,
rejected protected-field edits and upserts, atomic rejection of mixed updates,
all three non-admin roles, legitimate self-service/admin operations, class deletion,
and service-role maintenance. These tests verify the migration's behavior, not the
deployed project's effective API grants or migration state.

## Account creation protection

Migration `migrations/20260927000001_protect_account_creation.sql` protects account
creation in addition to the profile-update guard above. It ignores user-supplied
role, school, class, username, NISN, and NIP. Without trusted provisioning data,
a new profile is an unassigned student with no username or school/class membership.

The admin server actions supply `app_metadata.lms_profile` containing the initial
profile. This field is writable only through trusted Auth administration; see
[Supabase's metadata security documentation](https://supabase.com/docs/guides/database/postgres/row-level-security#authjwt).
The legacy `user_metadata` payload is retained so the updated app also works before
the migration is applied. The hardened trigger never trusts it for protected fields.

Supabase's Admin API can insert `auth.users` before writing custom `app_metadata`
within the same transaction. The migration supports both INSERT and the first
UPDATE that supplies `lms_profile`, so staff accounts receive the correct role and
invalid provisioning rolls back account creation. See the
[Auth Admin API implementation](https://github.com/supabase/auth/blob/master/internal/api/admin.go).
The snapshot is used only for initial provisioning, not current authorization;
later metadata updates do not overwrite profile edits or class promotions.

### Deployment order

1. Deploy the updated Next.js application first, including `users/actions.ts`.
   The admin account-creation actions must send `app_metadata.lms_profile` before
   you apply the new trigger. Existing accounts need no backfill.
2. Apply `migrations/20260927000001_protect_account_creation.sql` through the normal
   migration workflow or run its contents once in Supabase SQL Editor. The first
   security migration is a prerequisite; do not rerun it if it is already applied.
3. In the hosted project's Auth settings, disable **Allow new users to sign up**
   to match this LMS's admin-managed account flow. The repository's
   `config.toml` disables local signup; `db push` does not change hosted Auth
   settings. See [Auth configuration](https://supabase.com/docs/guides/auth/general-configuration).
4. Create a test student and teacher through the admin UI. Confirm their role,
   username, school, and (for the student) class, then verify login using each account.

The migration does not rewrite existing profiles. If a prior account was created
with an unauthorized role, it needs a separate review of the existing users.
Dashboard/manual account creation must provide trusted `app_metadata.lms_profile`
or explicitly assign the profile through a trusted admin; user metadata alone is
no longer sufficient. The local demo seed has been updated to use the trusted format.

`npm run test:security` covers public metadata forgery, both Auth provisioning
orders, all four roles, metadata updates after creation, rollback of invalid
provisioning, and the earlier profile-update protections. These are database
regression tests; the deployed Auth API and dashboard settings still need the
smoke checks above.

## Submission grade protection

Migration `migrations/20260927000002_protect_submission_grades.sql` prevents students
from writing `score`, `teacher_comment`, `graded_at`, `graded_by`, or the `graded`
status through INSERT, UPDATE, or upsert. Students can still submit and revise
ungraded answers. Graded submissions cannot be reset or rewritten by their owner,
and submission IDs, assignment IDs, and student IDs cannot be reassigned by
students or teachers. Existing teacher/admin grading continues to use RLS.

Quiz grading previously wrote grades with the student's database role. The updated
`subjects/actions.ts` validates the answer payload, computes points on the server,
and uses the server-only `save_scored_quiz` RPC. It derives the student ID from the
verified session. Only `service_role` has API permission to execute the RPC; normal
authenticated users, including application admins, cannot call it directly.

The RPC rechecks the student's class and role and requires a published, active,
unexpired quiz. It validates answer references and point totals, then stores the
grade and per-question answers in one transaction. A repeat request cannot replace
an existing grade; an answer-write error rolls back the grade and preserves any
unfinished attempt. Students can read their saved answers but cannot write
`quiz_answers` directly, including forged per-question points.

### Deployment and verification

This change requires both the SQL migration and the updated application. Schedule
the change when students are not submitting quizzes: the old application cannot
save quiz grades after the migration, and the new application requires the RPC.

1. Apply `migrations/20260927000002_protect_submission_grades.sql` once, after the
   earlier migrations, using your migration workflow or Supabase SQL Editor.
2. Immediately deploy/restart the latest application code. For local development,
   ensure the dev server is using the changed `subjects/actions.ts`.
3. Ensure the server environment contains `SUPABASE_SERVICE_ROLE_KEY` (already used
   for admin account creation). Never prefix this secret with `NEXT_PUBLIC_`.
4. With a test student, submit and revise an ungraded text assignment. Grade it as
   its teacher, then verify that the student can no longer change it or its grade.
5. Submit a test quiz and verify both its score and answer details in the teacher
   review. A second submission must leave the first result unchanged.

You can check the enabled trigger and RPC permissions in SQL Editor:

```sql
select tgname, tgenabled
from pg_trigger
where tgrelid = 'public.submissions'::regclass
  and tgname = 'submissions_guard_write';
-- Expected: submissions_guard_write | O

select
  has_function_privilege('anon',
    'public.save_scored_quiz(uuid,uuid,numeric,jsonb)', 'EXECUTE') as anon_can_call,
  has_function_privilege('authenticated',
    'public.save_scored_quiz(uuid,uuid,numeric,jsonb)', 'EXECUTE') as user_can_call,
  has_function_privilege('service_role',
    'public.save_scored_quiz(uuid,uuid,numeric,jsonb)', 'EXECUTE') as server_can_call;
-- Expected: false | false | true
```

`npm run test:security` includes submission/RPC tests against all migrations in
PGlite, plus tests of the actual quiz server action with mocked session/database
I/O. It covers forged grading fields, both upsert paths, teacher grading, RPC
permissions, eligibility, repeat requests, and transaction rollback after a
simulated answer-write failure. It does not exercise the deployed Supabase HTTP API
or simultaneous connections; verify the hosted workflows above after deployment.

The migration does not recalculate existing grades. Restricting direct access to
quiz answer keys and narrowing teacher permissions by both class and subject are
separate pending fixes. Teacher grading scope is unchanged by this migration.

## Curriculum dependency protection

CP/TP are teaching references for activities and the student's Learning Path.
They do not have an approval, publication, archive, or curriculum-version workflow.
There is still one CP per class/subject, containing ordered TP rows.

Apply `migrations/20260930000000_curriculum_dependencies.sql` once, after the
earlier migrations, before deploying/restarting the updated app. The new app needs
the usage and reorder RPCs. This file has not been applied to your hosted database
by the code change.

The migration replaces the three activity-to-TP `ON DELETE SET NULL` constraints
with `ON DELETE RESTRICT`: `materials`, `assignments`, and `class_meetings`.
Quizzes are `assignments.kind = 'quiz'`; other assignment kinds count as tasks.
Journal references also count as usage, including when there are no materials,
tasks, or quizzes. Draft/inactive activities still count because their links exist.

Server actions check dependencies before deleting, and database triggers/FKs
enforce the same rule for direct writes and concurrent changes. An unused CP can
delete its unused TP children; a used CP or TP cannot be deleted. Editing changes
CP/TP text without replacing IDs or moving children. Teachers see fresh usage
counts and a warning before editing a used CP/TP.

Used TPs keep their `sort_order`. Adjacent unused TPs can swap in one transaction,
but cannot cross a used TP. New TPs append at `max(sort_order) + 1`, so deleting
an earlier TP does not create duplicate orders on insertion. Displayed TP numbers
use `sort_order + 1` and can have gaps after deletion. Existing duplicate orders
are not rewritten by this migration; a swap between equal orders is rejected
with an explanation and needs a separate review of those existing rows.

No existing CP/TP, activity, submission, grade, or student row is rewritten or
deleted by the migration. No lifecycle column is added. New/reassigned activity
links must match the TP's class and subject; unrelated edits to legacy activities
keep their existing links.

### Manual verification

1. As a teacher, create a CP and several TPs in a test class/subject. Edit, swap,
   and delete unused TPs; deletion should ask for confirmation. Delete an unused
   CP with unused children and verify it can be recreated.
2. Link two materials, one task, and one quiz to one TP. Return to Kelola Kurikulum:
   verify the counts, the order lock, and absence of its delete button. Also try
   a TP used only by a journal entry.
3. Press Edit on the used TP, cancel the warning, then repeat and choose Tetap
   Edit. Correct a typo and save. Verify that activities and the student's
   Learning Path show the corrected text with the same associations and grades.
   Repeat Edit on its CP and check the context warning.
4. Try moving an unused TP across a used TP. The control should be disabled.
   Swap two neighboring unused TPs and add another TP; used orders must stay fixed.
5. On test data, attempt DELETE of the used TP/CP and UPDATE of the used TP's
   sort_order directly through Supabase, bypassing the UI. They must fail.
   Confirm that activities, submissions, grades, and attendance remain present.
6. On two tabs, open curriculum before linking an activity in the other tab.
   Edit/delete/reorder from the older tab: edit inspection must fetch current
   usage, and stale delete/reorder requests must be rejected by the backend.

`npm run test:security` covers these backend rules against the actual migrations
in disposable PGlite and tests the real server actions with mocked I/O. It also
compares existing data before/after migration and verifies rollback of a failed
swap. It does not exercise simultaneous database connections or the hosted UI;
the manual checks above remain necessary after deployment.

## Demo accounts (seeded by seed.sql)

Password is always `<username>123`.

| username | role | name |
|---|---|---|
| admin | admin | Admin Sekolah |
| kepsek | principal | Yohanes Bele |
| guru | teacher | Sari Wulandari (Matematika, Kelas 4A) |
| rahmat | teacher | Rahmat Hidayat (IPA, Kelas 4A) |
| linda | teacher | Linda Marbun (Bahasa Indonesia, Kelas 4A) |
| budi | student | Budi Santoso (Kelas 4A) |
| ani, citra, dimas, eka | student | Kelas 4A |

These are demo-only credentials — rotate or remove them before using this in production.

## Environment variables the Next.js app needs

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=... # server only: account management and quiz grade writes
```

Find both under Project Settings → API in the Supabase dashboard.
