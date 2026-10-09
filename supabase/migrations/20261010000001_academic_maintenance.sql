-- No tables, columns, statuses or existing data are added/rewritten.
-- Zero active periods means administration; at most one remains enforced by
-- the index from 20261010000000_atomic_academic_year_activation.sql.

create function public.academic_access_open()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and (
      p.role = 'admin' or exists (
        select 1 from public.academic_years y where y.school_id = p.school_id and y.is_active
      )
    )
  );
$$;

-- Principals can still read previous periods for school reports while open.
-- Existing permissive policies continue to enforce ownership/teaching scope.
create function public.academic_class_access(p_class_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.academic_access_open() and (
    public.is_admin() or exists (
      select 1 from public.classes c
      join public.academic_years y on y.id = c.academic_year_id
      join public.profiles p on p.id = auth.uid() and p.school_id = c.school_id
      where c.id = p_class_id and (y.is_active or p.role = 'principal')
    )
  );
$$;

revoke all on function public.academic_access_open(), public.academic_class_access(uuid) from public;
grant execute on function public.academic_access_open(), public.academic_class_access(uuid) to anon, authenticated;

create or replace function public.set_active_academic_year(p_id uuid)
returns void language plpgsql security invoker set search_path = ''
as $$
declare target_school_id uuid;
begin
  if public.is_admin() is not true then
    raise exception using errcode = '42501', message = 'Hanya admin yang dapat mengaktifkan tahun ajaran.';
  end if;
  select school_id into target_school_id from public.academic_years where id = p_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Tahun ajaran tidak ditemukan.';
  end if;
  perform 1 from public.schools where id = target_school_id for update;
  perform 1 from public.academic_years where id = p_id and school_id = target_school_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Tahun ajaran tidak ditemukan.';
  end if;
  if exists (select 1 from public.academic_years where school_id = target_school_id and is_active and id <> p_id) then
    raise exception using errcode = '55000', message = 'Nonaktifkan tahun ajaran yang sedang aktif terlebih dahulu untuk memulai masa administrasi.';
  end if;
  update public.academic_years set is_active = true where id = p_id and school_id = target_school_id;
  if not found then
    raise exception using errcode = '42501', message = 'Tahun ajaran tidak dapat diaktifkan.';
  end if;
end;
$$;

create function public.deactivate_academic_year(p_id uuid)
returns void language plpgsql security invoker set search_path = ''
as $$
declare target_school_id uuid;
begin
  if public.is_admin() is not true then
    raise exception using errcode = '42501', message = 'Hanya admin yang dapat menonaktifkan tahun ajaran.';
  end if;
  select school_id into target_school_id from public.academic_years where id = p_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Tahun ajaran tidak ditemukan.';
  end if;
  perform 1 from public.schools where id = target_school_id for update;
  update public.academic_years set is_active = false
    where id = p_id and school_id = target_school_id and is_active;
  if not found then
    raise exception using errcode = '55000', message = 'Tahun ajaran ini sudah tidak aktif. Muat ulang halaman.';
  end if;
end;
$$;
revoke all on function public.deactivate_academic_year(uuid) from public, anon;
grant execute on function public.deactivate_academic_year(uuid) to authenticated;

-- RESTRICTIVE policies add an AND condition; they never widen existing access.
do $$
declare table_name text;
begin
  foreach table_name in array array['subjects', 'announcements', 'quiz_questions',
    'quiz_options', 'quiz_pairs', 'quiz_steps', 'quiz_answers', 'attendance_records',
    'material_views', 'learning_objectives', 'submissions'] loop
    execute format('create policy academic_period_open on public.%I as restrictive for all
      using (public.academic_access_open()) with check (public.academic_access_open())', table_name);
  end loop;
  foreach table_name in array array['class_teacher_subjects', 'curriculum_plans', 'materials',
    'assignments', 'grades', 'class_meetings', 'gradebook_locks'] loop
    execute format('create policy academic_class_period on public.%I as restrictive for all
      using (public.academic_class_access(class_id)) with check (public.academic_class_access(class_id))', table_name);
  end loop;
end;
$$;

create policy academic_class_period on public.classes as restrictive for all
  using (public.academic_class_access(id)) with check (public.academic_class_access(id));
-- Own identity remains accessible for login/logout and the maintenance page.
create policy academic_profile_period on public.profiles as restrictive for all
  using (id = auth.uid() or public.is_admin() or
    (public.academic_access_open() and (public.is_principal() or public.academic_class_access(class_id))))
  with check (id = auth.uid() or public.is_admin() or public.academic_class_access(class_id));

-- Own submission/view policies don't otherwise require a visible parent.
create policy academic_submission_period on public.submissions as restrictive for all
  using (public.is_admin() or exists (select 1 from public.assignments a where a.id = assignment_id))
  with check (public.is_admin() or exists (select 1 from public.assignments a where a.id = assignment_id));
create policy academic_material_view_period on public.material_views as restrictive for all
  using (public.is_admin() or exists (select 1 from public.materials m where m.id = material_id))
  with check (public.is_admin() or exists (select 1 from public.materials m where m.id = material_id));
create policy academic_attendance_period on public.attendance_records as restrictive for all
  using (public.is_admin() or exists (select 1 from public.class_meetings m where m.id = meeting_id))
  with check (public.is_admin() or exists (select 1 from public.class_meetings m where m.id = meeting_id));

-- This existing definer RPC bypasses RLS, so apply the same context explicitly.
create or replace function public.learning_objective_usage(p_ids uuid[])
returns table (id uuid, materials bigint, assignments bigint, quizzes bigint, meetings bigint)
language sql stable security definer set search_path = ''
as $$
  select lo.id,
    (select count(*) from public.materials m where m.learning_objective_id = lo.id),
    (select count(*) from public.assignments a where a.learning_objective_id = lo.id and a.kind <> 'quiz'),
    (select count(*) from public.assignments a where a.learning_objective_id = lo.id and a.kind = 'quiz'),
    (select count(*) from public.class_meetings m where m.learning_objective_id = lo.id)
  from public.learning_objectives lo join public.curriculum_plans cp on cp.id = lo.curriculum_plan_id
  where lo.id = any(p_ids) and public.academic_class_access(cp.class_id) and (
    public.is_admin() or public.is_principal() or (public.is_teacher() and exists (
      select 1 from public.class_teacher_subjects cts
      where cts.teacher_id = auth.uid() and cts.class_id = cp.class_id and cts.subject_id = cp.subject_id
    ))
  );
$$;

-- The scoring RPC uses service_role and bypasses RLS. Check the active period
-- again at its write boundary; lock the school until all answer writes commit.
-- Calculation, answer validation and grading rules stay in the existing RPC.
create function public.guard_quiz_academic_period()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if current_user = 'service_role' and new.status = 'graded' and exists (
    select 1 from public.assignments where id = new.assignment_id and kind = 'quiz'
  ) then
    perform 1 from public.schools s
      join public.classes c on c.school_id = s.id
      join public.assignments a on a.class_id = c.id
      where a.id = new.assignment_id for share of s;
    if not exists (
      select 1 from public.assignments a
      join public.classes c on c.id = a.class_id
      join public.academic_years y on y.id = c.academic_year_id and y.is_active
      where a.id = new.assignment_id
    ) then
      raise exception using errcode = '42501', message = 'Akses pembelajaran ditutup atau kelas tidak berada pada tahun ajaran aktif.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_quiz_academic_period() from public, anon, authenticated;
-- SELECT ... FOR SHARE also needs UPDATE privilege on the locked school row.
grant select, update on public.schools to service_role;
grant select on public.classes, public.academic_years to service_role;
create trigger submissions_academic_period before insert or update on public.submissions
  for each row execute function public.guard_quiz_academic_period();
