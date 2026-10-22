-- One-time import for teacher and student accounts.
-- Teachers use their NIP as username and initial password.
-- Students use their NISN as username and initial password.
-- This migration does not create teaching assignments or change existing data.

begin;

do $$
declare
  imported_users jsonb := $users$
  [
    {"role":"teacher","full_name":"Maria Yuliana Manafe, S.Pd.","identifier":"209001012020012001"},
    {"role":"teacher","full_name":"Yohanes Kristian Ledo, S.Pd.","identifier":"209002022020011002"},
    {"role":"teacher","full_name":"Ruth Margaretha Neno, S.Pd.","identifier":"209003032021012003"},
    {"role":"teacher","full_name":"Daniel Petrus Tallo, S.Pd.","identifier":"209004042021011004"},
    {"role":"teacher","full_name":"Ester Novita Benu, S.Pd.","identifier":"209005052022012005"},
    {"role":"teacher","full_name":"Samuel Andreas Kase, S.Pd.","identifier":"209006062022011006"},
    {"role":"teacher","full_name":"Grace Elisabeth Nalle, S.Pd.","identifier":"209007072023012007"},
    {"role":"teacher","full_name":"Markus Jonathan Nope, S.Pd.","identifier":"209008082023011008"},
    {"role":"teacher","full_name":"Debora Kristina Fanggidae, S.Pd.","identifier":"209009092024012009"},

    {"role":"student","full_name":"Adrian K. Ledo","identifier":"9901000001","grade_level":1},
    {"role":"student","full_name":"Maria E. Manafe","identifier":"9901000002","grade_level":1},
    {"role":"student","full_name":"Samuel P. Neno","identifier":"9901000003","grade_level":1},
    {"role":"student","full_name":"Felicia A. Benu","identifier":"9901000004","grade_level":1},
    {"role":"student","full_name":"Kevin J. Tallo","identifier":"9901000005","grade_level":1},

    {"role":"student","full_name":"Daniel R. Kase","identifier":"9902000001","grade_level":2},
    {"role":"student","full_name":"Clarissa M. Nope","identifier":"9902000002","grade_level":2},
    {"role":"student","full_name":"Yosua A. Lomi","identifier":"9902000003","grade_level":2},
    {"role":"student","full_name":"Gracia N. Fanggidae","identifier":"9902000004","grade_level":2},
    {"role":"student","full_name":"Rafael T. Nalle","identifier":"9902000005","grade_level":2},

    {"role":"student","full_name":"Nathaniel S. Bessie","identifier":"9903000001","grade_level":3},
    {"role":"student","full_name":"Kezia M. Kefi","identifier":"9903000002","grade_level":3},
    {"role":"student","full_name":"Jonathan P. Amtiran","identifier":"9903000003","grade_level":3},
    {"role":"student","full_name":"Angelica R. Nitsae","identifier":"9903000004","grade_level":3},
    {"role":"student","full_name":"Michael D. Saek","identifier":"9903000005","grade_level":3},

    {"role":"student","full_name":"Gabriel Y. Tefa","identifier":"9904000001","grade_level":4},
    {"role":"student","full_name":"Michelle A. Dethan","identifier":"9904000002","grade_level":4},
    {"role":"student","full_name":"Ezra K. Banunaek","identifier":"9904000003","grade_level":4},
    {"role":"student","full_name":"Naomi C. Nabuasa","identifier":"9904000004","grade_level":4},
    {"role":"student","full_name":"Matthew J. Messakh","identifier":"9904000005","grade_level":4},

    {"role":"student","full_name":"Christian R. Benu","identifier":"9905000001","grade_level":5},
    {"role":"student","full_name":"Abigail S. Tnunay","identifier":"9905000002","grade_level":5},
    {"role":"student","full_name":"David M. Takalapeta","identifier":"9905000003","grade_level":5},
    {"role":"student","full_name":"Ester P. Kase","identifier":"9905000004","grade_level":5},
    {"role":"student","full_name":"Andreas N. Neno","identifier":"9905000005","grade_level":5},

    {"role":"student","full_name":"Immanuel J. Ledo","identifier":"9906000001","grade_level":6},
    {"role":"student","full_name":"Deborah M. Manafe","identifier":"9906000002","grade_level":6},
    {"role":"student","full_name":"Yohanes P. Tallo","identifier":"9906000003","grade_level":6},
    {"role":"student","full_name":"Patricia E. Nalle","identifier":"9906000004","grade_level":6},
    {"role":"student","full_name":"Markus R. Nope","identifier":"9906000005","grade_level":6}
  ]
  $users$::jsonb;
  school_ids uuid[];
  period_ids uuid[];
  class_ids uuid[];
  target_school_id uuid;
  target_period_id uuid;
  target_class_id uuid;
  target_grade integer;
  new_user_id uuid;
  initial_profile jsonb;
  account jsonb;
  account_email text;
begin
  select array_agg(s.id order by s.id)
    into school_ids
  from public.schools s;

  if coalesce(cardinality(school_ids), 0) <> 1 then
    raise exception using
      errcode = '22023',
      message = 'Impor dibatalkan: sistem harus memiliki tepat satu data sekolah.';
  end if;
  target_school_id := school_ids[1];

  select array_agg(y.id order by y.created_at desc, y.id)
    into period_ids
  from public.academic_years y
  where y.school_id = target_school_id
    and y.is_active;

  if coalesce(cardinality(period_ids), 0) = 1 then
    target_period_id := period_ids[1];
  elsif coalesce(cardinality(period_ids), 0) > 1 then
    raise exception using
      errcode = '22023',
      message = 'Impor dibatalkan: terdapat lebih dari satu tahun ajaran aktif.';
  else
    select array_agg(y.id order by y.created_at desc, y.id)
      into period_ids
    from public.academic_years y
    where y.school_id = target_school_id;

    if coalesce(cardinality(period_ids), 0) <> 1 then
      raise exception using
        errcode = '22023',
        message = 'Impor dibatalkan: aktifkan tahun ajaran tujuan atau sisakan tepat satu tahun ajaran.';
    end if;
    target_period_id := period_ids[1];
  end if;

  for target_grade in 1..6
  loop
    select array_agg(c.id order by c.name, c.id)
      into class_ids
    from public.classes c
    where c.school_id = target_school_id
      and c.academic_year_id = target_period_id
      and c.grade_level = target_grade;

    if coalesce(cardinality(class_ids), 0) <> 1 then
      raise exception using
        errcode = '22023',
        message = format(
          'Impor dibatalkan: tingkat kelas %s harus memiliki tepat satu rombel pada tahun ajaran tujuan.',
          target_grade
        );
    end if;
  end loop;

  if exists (
    select 1
    from jsonb_to_recordset(imported_users) as input(identifier text)
    group by input.identifier
    having count(*) > 1
  ) then
    raise exception using
      errcode = '22023',
      message = 'Impor dibatalkan: daftar impor memiliki NIP atau NISN ganda.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(imported_users) as input(identifier text)
    join public.profiles p
      on p.username = input.identifier
      or p.nisn = input.identifier
      or p.nip = input.identifier
  ) then
    raise exception using
      errcode = '23505',
      message = 'Impor dibatalkan: salah satu NIP atau NISN sudah digunakan akun lain.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(imported_users) as input(identifier text)
    join auth.users u
      on lower(u.email) = lower(input.identifier || '@nggodimeda.sch.id')
  ) then
    raise exception using
      errcode = '23505',
      message = 'Impor dibatalkan: salah satu email login sudah terdaftar.';
  end if;

  for account in
    select value from jsonb_array_elements(imported_users)
  loop
    target_class_id := null;
    if account ->> 'role' = 'student' then
      select c.id
        into target_class_id
      from public.classes c
      where c.school_id = target_school_id
        and c.academic_year_id = target_period_id
        and c.grade_level = (account ->> 'grade_level')::integer;
    end if;

    new_user_id := gen_random_uuid();
    account_email := account ->> 'identifier' || '@nggodimeda.sch.id';
    initial_profile := jsonb_build_object(
      'school_id', target_school_id::text,
      'role', account ->> 'role',
      'full_name', account ->> 'full_name',
      'username', account ->> 'identifier',
      'nisn', case when account ->> 'role' = 'student' then account ->> 'identifier' end,
      'nip', case when account ->> 'role' = 'teacher' then account ->> 'identifier' end,
      'class_id', target_class_id::text
    );

    insert into auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      email_change,
      email_change_token_new,
      recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000',
      new_user_id,
      'authenticated',
      'authenticated',
      account_email,
      crypt(account ->> 'identifier', gen_salt('bf')),
      now(),
      jsonb_build_object(
        'provider', 'email',
        'providers', jsonb_build_array('email'),
        'lms_profile', initial_profile
      ),
      initial_profile,
      now(),
      now(),
      '',
      '',
      '',
      ''
    );

    insert into auth.identities (
      id,
      user_id,
      provider_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    ) values (
      gen_random_uuid(),
      new_user_id,
      new_user_id::text,
      jsonb_build_object(
        'sub', new_user_id::text,
        'email', account_email,
        'email_verified', true,
        'phone_verified', false
      ),
      'email',
      now(),
      now(),
      now()
    );
  end loop;
end;
$$;

commit;
