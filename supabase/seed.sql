-- Demo data mirroring src/lib/mock-data.ts and src/lib/auth.tsx, so the app looks
-- the same after the Supabase + Next.js migration as it did on mock data.
--
-- Demo logins (password = username + "123", e.g. budi / budi123):
--   admin, kepsek, guru, rahmat, linda, budi, ani, citra, dimas, eka
-- These are demo-only credentials — rotate or remove them before going to production.

-- ── School, academic year, subjects, classes ────────────────────────────
insert into public.schools (id, name, tagline, address, phone)
values (gen_random_uuid(), 'SD Inpres Nggodimeda', 'Belajar dengan ceria, tumbuh bersama',
        'Desa Nggodimeda, Kecamatan ...', '0380-000-000');

insert into public.academic_years (school_id, year_label, semester, is_active)
select id, '2024/2025', 'genap'::public.semester_type, true from public.schools
union all
select id, '2024/2025', 'ganjil'::public.semester_type, false from public.schools
union all
select id, '2023/2024', 'genap'::public.semester_type, false from public.schools;

insert into public.subjects (school_id, code, name, emoji, color)
select s.id, v.code, v.name, v.emoji, v.color
from public.schools s, (values
  ('mtk', 'Matematika', '🔢', 'oklch(0.78 0.14 50)'),
  ('ipa', 'IPA', '🔬', 'oklch(0.7 0.14 195)'),
  ('bi', 'Bahasa Indonesia', '📖', 'oklch(0.7 0.16 25)'),
  ('ppkn', 'PPKn', '🇮🇩', 'oklch(0.65 0.18 145)'),
  ('agama', 'Agama', '🕊️', 'oklch(0.72 0.12 280)'),
  ('sbdp', 'SBdP', '🎨', 'oklch(0.72 0.16 330)')
) as v(code, name, emoji, color);

insert into public.classes (school_id, academic_year_id, name, grade_level)
select s.id, ay.id, v.name, v.grade_level
from public.schools s
join public.academic_years ay on ay.school_id = s.id and ay.is_active = true
cross join (values
  ('Kelas 1A', 1), ('Kelas 2A', 2), ('Kelas 3A', 3),
  ('Kelas 4A', 4), ('Kelas 5A', 5), ('Kelas 6A', 6)
) as v(name, grade_level);

-- ── Demo users (auth.users + auth.identities → profiles via trigger) ───
do $$
declare
  users jsonb := '[
    {"username":"admin","email":"admin@demo.nggodimeda.sch.id","password":"admin123","role":"admin","full_name":"Admin Sekolah","avatar_emoji":"🛠️"},
    {"username":"kepsek","email":"kepsek@demo.nggodimeda.sch.id","password":"kepsek123","role":"principal","full_name":"Yohanes Bele","avatar_emoji":"👨‍💼","nip":"197003121995011001"},
    {"username":"guru","email":"guru@demo.nggodimeda.sch.id","password":"guru123","role":"teacher","full_name":"Sari Wulandari","avatar_emoji":"👩‍🏫","nip":"198501012010012001"},
    {"username":"rahmat","email":"rahmat@demo.nggodimeda.sch.id","password":"rahmat123","role":"teacher","full_name":"Rahmat Hidayat","avatar_emoji":"👨‍🏫","nip":"198902142011012003"},
    {"username":"linda","email":"linda@demo.nggodimeda.sch.id","password":"linda123","role":"teacher","full_name":"Linda Marbun","avatar_emoji":"👩‍🏫","nip":"199203212012011002"},
    {"username":"budi","email":"budi@demo.nggodimeda.sch.id","password":"budi123","role":"student","full_name":"Budi Santoso","avatar_emoji":"🦊","nisn":"0098765432","class_name":"Kelas 4A"},
    {"username":"ani","email":"ani@demo.nggodimeda.sch.id","password":"ani123","role":"student","full_name":"Ani Putri","avatar_emoji":"🐰","nisn":"0098765433","class_name":"Kelas 4A"},
    {"username":"citra","email":"citra@demo.nggodimeda.sch.id","password":"citra123","role":"student","full_name":"Citra Dewi","avatar_emoji":"🐱","nisn":"0098765434","class_name":"Kelas 4A"},
    {"username":"dimas","email":"dimas@demo.nggodimeda.sch.id","password":"dimas123","role":"student","full_name":"Dimas Pratama","avatar_emoji":"🐨","nisn":"0098765435","class_name":"Kelas 4A"},
    {"username":"eka","email":"eka@demo.nggodimeda.sch.id","password":"eka123","role":"student","full_name":"Eka Wijaya","avatar_emoji":"🐯","nisn":"0098765436","class_name":"Kelas 4A"}
  ]';
  u jsonb;
  new_id uuid;
  v_school_id uuid;
  v_class_id uuid;
  initial_profile jsonb;
begin
  select id into v_school_id from public.schools limit 1;

  for u in select * from jsonb_array_elements(users)
  loop
    new_id := gen_random_uuid();
    v_class_id := null;
    if u ? 'class_name' then
      select id into v_class_id from public.classes where name = u->>'class_name';
    end if;

    initial_profile := jsonb_build_object(
      'school_id', v_school_id::text,
      'role', u->>'role',
      'full_name', u->>'full_name',
      'username', u->>'username',
      'avatar_emoji', u->>'avatar_emoji',
      'nisn', u->>'nisn',
      'nip', u->>'nip',
      'class_id', v_class_id::text
    );

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, recovery_sent_at, last_sign_in_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000',
      new_id,
      'authenticated',
      'authenticated',
      u->>'email',
      crypt(u->>'password', gen_salt('bf')),
      now(), now(), now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'),
                         'lms_profile', initial_profile),
      initial_profile,
      now(), now(),
      '', '', '', ''
    );

    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), new_id, new_id::text,
      jsonb_build_object('sub', new_id::text, 'email', u->>'email'),
      'email', now(), now(), now()
    );
  end loop;
end $$;

-- ── Homeroom + teaching assignments ─────────────────────────────────────
update public.classes set homeroom_teacher_id = (select id from public.profiles where username = 'guru')
where name = 'Kelas 4A';

insert into public.class_teacher_subjects (class_id, subject_id, teacher_id)
select c.id, s.id, p.id
from public.classes c, public.subjects s, public.profiles p
where c.name = 'Kelas 4A' and s.code = 'mtk' and p.username = 'guru'
union all
select c.id, s.id, p.id
from public.classes c, public.subjects s, public.profiles p
where c.name = 'Kelas 4A' and s.code = 'ipa' and p.username = 'rahmat'
union all
select c.id, s.id, p.id
from public.classes c, public.subjects s, public.profiles p
where c.name = 'Kelas 4A' and s.code = 'bi' and p.username = 'linda';

-- ── Announcements ────────────────────────────────────────────────────────
insert into public.announcements (school_id, author_id, title, body, created_at)
select s.id, p.id, v.title, v.body, v.created_at
from public.schools s, public.profiles p, (values
  ('Upacara Bendera Senin Pagi', 'Seluruh siswa wajib hadir pukul 07.00 WITA dengan seragam lengkap.', now() - interval '3 days'),
  ('Lomba Cerdas Cermat', 'Pendaftaran dibuka untuk kelas 4–6. Daftar ke wali kelas masing-masing.', now() - interval '10 days')
) as v(title, body, created_at)
where p.username = 'admin';

-- ── Materials ────────────────────────────────────────────────────────────
insert into public.materials (class_id, subject_id, teacher_id, title, kind, url)
select c.id, s.id, p.id, v.title, v.kind::public.material_kind, v.url
from (values
    ('mtk', 'guru', 'Bab 1 — Bilangan Pecahan', 'pdf', null),
    ('ipa', 'rahmat', 'Video: Daur Hidup Kupu-kupu', 'video', 'https://youtube.com/watch?v=demo'),
    ('bi', 'linda', 'Cerita Rakyat Nusantara', 'text', null),
    ('ppkn', null, 'Pancasila & Lambangnya', 'image', null)
  ) as v(code, teacher, title, kind, url)
join public.subjects s on s.code = v.code
left join public.profiles p on p.username = v.teacher
join public.classes c on c.name = 'Kelas 4A';

-- ── Assignments ──────────────────────────────────────────────────────────
insert into public.assignments (class_id, subject_id, teacher_id, title, kind, due_at)
select c.id, s.id, p.id, v.title, v.kind::public.assignment_kind, v.due_at
from (values
    ('mtk', 'guru', 'Latihan Pecahan Bab 3', 'quiz', now() + interval '1 day'),
    ('ipa', 'rahmat', 'Pengamatan Tumbuhan', 'photo', now() + interval '3 days'),
    ('bi', 'linda', 'Menulis Cerita Liburan', 'essay', now() + interval '7 days'),
    ('bi', 'linda', 'Rekaman Pantun', 'audio', now() + interval '5 days')
  ) as v(code, teacher, title, kind, due_at)
join public.subjects s on s.code = v.code
left join public.profiles p on p.username = v.teacher
join public.classes c on c.name = 'Kelas 4A';

-- ── Submissions ──────────────────────────────────────────────────────────
insert into public.submissions (assignment_id, student_id, status, score, teacher_comment, submitted_at, graded_at, graded_by)
select a.id, p.id, v.status::public.submission_status, v.score, v.comment, v.submitted_at, v.graded_at,
       (select id from public.profiles where username = 'guru')
from (values
    ('Latihan Pecahan Bab 3', 'budi', 'graded', 88, 'Pemahaman pecahan sangat baik, terus berlatih soal cerita ya!', now() - interval '2 days', now() - interval '1 day'),
    ('Latihan Pecahan Bab 3', 'ani', 'graded', 92, 'Kerja bagus, lanjutkan!', now() - interval '2 days', now() - interval '1 day'),
    ('Latihan Pecahan Bab 3', 'eka', 'dikerjakan', null, null, null, null),
    ('Latihan Pecahan Bab 3', 'citra', 'belum', null, null, null, null),
    ('Menulis Cerita Liburan', 'ani', 'submitted', null, null, now() - interval '1 day', null),
    ('Rekaman Pantun', 'citra', 'submitted', null, null, now() - interval '2 days', null),
    ('Pengamatan Tumbuhan', 'dimas', 'submitted', null, null, now() - interval '3 days', null)
  ) as v(title, student, status, score, comment, submitted_at, graded_at)
join public.assignments a on a.title = v.title
join public.profiles p on p.username = v.student;

-- ── Grades (per-subject snapshots + a 6-month trend for Budi/Matematika) ─
insert into public.grades (student_id, subject_id, class_id, academic_year_id, period_month, score, teacher_comment, created_by)
select p.id, s.id, c.id, ay.id, v.period_month::date, v.score, v.comment,
       (select id from public.profiles where username = 'guru')
from (values
    -- latest snapshot per subject, per student (drives "Nilai per Mata Pelajaran" + STUDENTS avg)
    ('budi', 'mtk', '2026-06-01', 91, 'Pemahaman pecahan sangat baik, terus berlatih soal cerita ya!'),
    ('budi', 'ipa', '2026-06-01', 88, 'Aktif bertanya saat diskusi tumbuhan. Tingkatkan ketelitian saat pengamatan.'),
    ('budi', 'bi', '2026-06-01', 85, 'Ceritamu kreatif sekali! Lanjutkan kebiasaan membaca.'),
    ('budi', 'ppkn', '2026-06-01', 87, null),
    ('budi', 'agama', '2026-06-01', 90, null),
    ('budi', 'sbdp', '2026-06-01', 89, null),
    ('ani', 'mtk', '2026-06-01', 92, null), ('ani', 'ipa', '2026-06-01', 92, null),
    ('ani', 'bi', '2026-06-01', 92, null), ('ani', 'ppkn', '2026-06-01', 92, null),
    ('ani', 'agama', '2026-06-01', 92, null), ('ani', 'sbdp', '2026-06-01', 92, null),
    ('citra', 'mtk', '2026-06-01', 75, null), ('citra', 'ipa', '2026-06-01', 75, null),
    ('citra', 'bi', '2026-06-01', 75, null), ('citra', 'ppkn', '2026-06-01', 75, null),
    ('citra', 'agama', '2026-06-01', 75, null), ('citra', 'sbdp', '2026-06-01', 75, null),
    ('dimas', 'mtk', '2026-06-01', 81, null), ('dimas', 'ipa', '2026-06-01', 81, null),
    ('dimas', 'bi', '2026-06-01', 81, null), ('dimas', 'ppkn', '2026-06-01', 81, null),
    ('dimas', 'agama', '2026-06-01', 81, null), ('dimas', 'sbdp', '2026-06-01', 81, null),
    ('eka', 'mtk', '2026-06-01', 79, null), ('eka', 'ipa', '2026-06-01', 79, null),
    ('eka', 'bi', '2026-06-01', 79, null), ('eka', 'ppkn', '2026-06-01', 79, null),
    ('eka', 'agama', '2026-06-01', 79, null), ('eka', 'sbdp', '2026-06-01', 79, null),
    -- 6-month trend, Budi/Matematika only
    ('budi', 'mtk', '2026-01-01', 78, null),
    ('budi', 'mtk', '2026-02-01', 82, null),
    ('budi', 'mtk', '2026-03-01', 85, null),
    ('budi', 'mtk', '2026-04-01', 80, null),
    ('budi', 'mtk', '2026-05-01', 88, null)
  ) as v(student, code, period_month, score, comment)
join public.profiles p on p.username = v.student
join public.subjects s on s.code = v.code
join public.classes c on c.name = 'Kelas 4A'
join public.academic_years ay on ay.id = c.academic_year_id;
