-- Make gradebook finalization atomic and scope every teacher operation to the
-- exact class + subject assignment. No application table or column is added.
begin;

create or replace function public.teaches_class_subject(p_class_id uuid, p_subject_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.class_teacher_subjects cts
    where cts.class_id = p_class_id
      and cts.subject_id = p_subject_id
      and cts.teacher_id = auth.uid()
  );
$$;

revoke all on function public.teaches_class_subject(uuid, uuid) from public;
grant execute on function public.teaches_class_subject(uuid, uuid) to anon, authenticated, service_role;

-- Ruang Periksa and the quiz bank use the same exact teacher scope. Students
-- retain access only to active, published quizzes in their own class.
drop policy if exists quiz_questions_select on public.quiz_questions;
create policy quiz_questions_select on public.quiz_questions for select
  using (
    exists (
      select 1 from public.assignments a
      where a.id = assignment_id and (
        public.is_admin() or public.is_principal()
        or public.teaches_class_subject(a.class_id, a.subject_id)
        or (a.class_id = public.current_class_id() and a.is_published and a.is_active)
      )
    )
  );

drop policy if exists quiz_options_select on public.quiz_options;
create policy quiz_options_select on public.quiz_options for select
  using (
    exists (
      select 1 from public.quiz_questions q
      join public.assignments a on a.id = q.assignment_id
      where q.id = question_id and (
        public.is_admin() or public.is_principal()
        or public.teaches_class_subject(a.class_id, a.subject_id)
        or (a.class_id = public.current_class_id() and a.is_published and a.is_active)
      )
    )
  );

drop policy if exists quiz_pairs_select on public.quiz_pairs;
create policy quiz_pairs_select on public.quiz_pairs for select
  using (
    exists (
      select 1 from public.quiz_questions q
      join public.assignments a on a.id = q.assignment_id
      where q.id = question_id and (
        public.is_admin() or public.is_principal()
        or public.teaches_class_subject(a.class_id, a.subject_id)
        or (a.class_id = public.current_class_id() and a.is_published and a.is_active)
      )
    )
  );

drop policy if exists quiz_steps_select on public.quiz_steps;
create policy quiz_steps_select on public.quiz_steps for select
  using (
    exists (
      select 1 from public.quiz_questions q
      join public.assignments a on a.id = q.assignment_id
      where q.id = question_id and (
        public.is_admin() or public.is_principal()
        or public.teaches_class_subject(a.class_id, a.subject_id)
        or (a.class_id = public.current_class_id() and a.is_published and a.is_active)
      )
    )
  );

drop policy if exists quiz_answers_select on public.quiz_answers;
create policy quiz_answers_select on public.quiz_answers for select
  using (
    public.is_admin() or public.is_principal()
    or exists (
      select 1 from public.submissions s
      where s.id = submission_id and s.student_id = auth.uid()
    )
    or exists (
      select 1 from public.quiz_questions q
      join public.assignments a on a.id = q.assignment_id
      where q.id = question_id
        and public.teaches_class_subject(a.class_id, a.subject_id)
    )
  );

-- Reading a submission and changing its score must use the exact subject
-- assignment, not merely any teaching assignment in the same class.
drop policy if exists submissions_select on public.submissions;
create policy submissions_select on public.submissions for select
  using (
    public.is_admin() or public.is_principal()
    or student_id = auth.uid()
    or exists (
      select 1 from public.assignments a
      where a.id = assignment_id
        and public.teaches_class_subject(a.class_id, a.subject_id)
    )
  );

drop policy if exists submissions_update on public.submissions;
create policy submissions_update on public.submissions for update
  using (
    public.is_admin()
    or student_id = auth.uid()
    or exists (
      select 1 from public.assignments a
      where a.id = assignment_id
        and public.teaches_class_subject(a.class_id, a.subject_id)
    )
  )
  with check (
    public.is_admin()
    or student_id = auth.uid()
    or exists (
      select 1 from public.assignments a
      where a.id = assignment_id
        and public.teaches_class_subject(a.class_id, a.subject_id)
    )
  );

create or replace function public.guard_submission_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role')
     or public.is_admin() is true then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.assignment_id is distinct from old.assignment_id
       or new.student_id is distinct from old.student_id then
      raise exception using errcode = '42501',
        message = 'Identitas pengumpulan tugas tidak dapat diubah.';
    end if;

    if public.is_teacher() is true and exists (
      select 1 from public.assignments a
      where a.id = new.assignment_id
        and public.teaches_class_subject(a.class_id, a.subject_id)
    ) then
      return new;
    end if;
  end if;

  if public.is_student() is not true or new.student_id is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'Tidak diizinkan mengubah pengumpulan tugas.';
  end if;

  if tg_op = 'UPDATE' then
    if old.status = 'graded' or old.score is not null
       or old.graded_at is not null or old.graded_by is not null then
      raise exception using errcode = '42501',
        message = 'Tugas ini sudah dinilai dan tidak bisa diubah lagi.';
    end if;

    if (to_jsonb(new) - array['content_url', 'status', 'submitted_at', 'updated_at'])
       is distinct from
       (to_jsonb(old) - array['content_url', 'status', 'submitted_at', 'updated_at']) then
      raise exception using errcode = '42501',
        message = 'Murid hanya dapat mengubah jawaban dan status pengumpulan tugas.';
    end if;
  end if;

  if new.status = 'graded' or new.score is not null or new.teacher_comment is not null
     or new.graded_at is not null or new.graded_by is not null then
    raise exception using errcode = '42501',
      message = 'Nilai dan catatan penilaian hanya dapat disimpan oleh guru, admin, atau sistem.';
  end if;

  return new;
end;
$$;

-- A locked gradebook is a final snapshot. Serialize submission writes against
-- gradebook finalization through a shared lock on the parent assignment.
create function public.guard_locked_gradebook_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_assignment_id uuid;
  target_class_id uuid;
  target_subject_id uuid;
begin
  target_assignment_id := case when tg_op = 'DELETE' then old.assignment_id else new.assignment_id end;

  select a.class_id, a.subject_id
    into target_class_id, target_subject_id
  from public.assignments a
  where a.id = target_assignment_id
  for share;

  if exists (
    select 1 from public.gradebook_locks gl
    where gl.class_id = target_class_id and gl.subject_id = target_subject_id
  ) then
    raise exception using errcode = '55000',
      message = 'Buku nilai sudah dikunci. Pengumpulan dan nilai tidak dapat diubah.';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists submissions_guard_locked_gradebook on public.submissions;
create trigger submissions_guard_locked_gradebook
  before insert or update or delete on public.submissions
  for each row execute function public.guard_locked_gradebook_submission();
revoke all on function public.guard_locked_gradebook_submission() from public, anon, authenticated;

-- Prevent a teacher from adding, moving, editing, publishing or deleting an
-- assessment after its gradebook snapshot has been finalized.
create function public.guard_locked_gradebook_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' and exists (
    select 1 from public.gradebook_locks gl
    where gl.class_id = old.class_id and gl.subject_id = old.subject_id
  ) then
    raise exception using errcode = '55000',
      message = 'Buku nilai sudah dikunci. Tugas dan kuis tidak dapat diubah.';
  end if;

  if tg_op <> 'DELETE' and exists (
    select 1 from public.gradebook_locks gl
    where gl.class_id = new.class_id and gl.subject_id = new.subject_id
  ) then
    raise exception using errcode = '55000',
      message = 'Buku nilai sudah dikunci. Tugas dan kuis tidak dapat diubah.';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists assignments_guard_locked_gradebook on public.assignments;
create trigger assignments_guard_locked_gradebook
  before insert or update or delete on public.assignments
  for each row execute function public.guard_locked_gradebook_assignment();
revoke all on function public.guard_locked_gradebook_assignment() from public, anon, authenticated;

-- Teachers may read only their exact class-subject gradebook. Final snapshot
-- writes are routed through the atomic RPCs below.
drop policy if exists grades_select on public.grades;
create policy grades_select on public.grades for select
  using (
    public.is_admin() or public.is_principal()
    or student_id = auth.uid()
    or public.teaches_class_subject(class_id, subject_id)
  );
drop policy if exists grades_write on public.grades;
create policy grades_write on public.grades for insert with check (public.is_admin());
drop policy if exists grades_modify on public.grades;
create policy grades_modify on public.grades for update
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists grades_delete on public.grades;
create policy grades_delete on public.grades for delete using (public.is_admin());

drop policy if exists gradebook_locks_select on public.gradebook_locks;
create policy gradebook_locks_select on public.gradebook_locks for select
  using (
    public.is_admin() or public.is_principal()
    or public.teaches_class_subject(class_id, subject_id)
    or class_id = public.current_class_id()
  );
drop policy if exists gradebook_locks_insert on public.gradebook_locks;
create policy gradebook_locks_insert on public.gradebook_locks for insert
  with check (public.is_admin());
drop policy if exists gradebook_locks_delete on public.gradebook_locks;
create policy gradebook_locks_delete on public.gradebook_locks for delete
  using (public.is_admin());

-- Return the exact state that will be rechecked by lock_gradebook(). Arrays are
-- included so the confirmation dialog can explain every blocker and zero score.
create function public.gradebook_readiness(p_class_id uuid, p_subject_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  result jsonb;
begin
  if public.current_role() <> 'teacher'
     or not public.teaches_class_subject(p_class_id, p_subject_id) then
    raise exception using errcode = '42501',
      message = 'Kamu tidak ditugaskan mengajar kelas dan mata pelajaran ini.';
  end if;

  if not exists (
    select 1 from public.classes c
    join public.academic_years y on y.id = c.academic_year_id and y.is_active
    where c.id = p_class_id
  ) then
    raise exception using errcode = '42501',
      message = 'Buku nilai hanya dapat diproses pada tahun ajaran aktif.';
  end if;

  with
  active_assignments as (
    select a.id, a.title, a.due_at, a.learning_objective_id
    from public.assignments a
    where a.class_id = p_class_id and a.subject_id = p_subject_id
      and a.is_active and a.is_published
  ),
  class_students as (
    select p.id, p.full_name
    from public.profiles p
    where p.class_id = p_class_id and p.role = 'student'
  ),
  open_items as (
    select a.id, a.title, a.due_at
    from active_assignments a
    where a.due_at is null or a.due_at > clock_timestamp()
  ),
  pending_items as (
    select a.id, a.title, count(*)::integer as submission_count
    from active_assignments a
    join public.submissions s on s.assignment_id = a.id
    where s.status = 'submitted' or (s.status = 'graded' and s.score is null)
    group by a.id, a.title
  ),
  missing_items as (
    select a.id, a.title, count(*)::integer as student_count,
      jsonb_agg(st.full_name order by st.full_name) as student_names
    from active_assignments a
    cross join class_students st
    where a.learning_objective_id is not null
      and a.due_at is not null and a.due_at <= clock_timestamp()
      and not exists (
        select 1 from public.submissions s
        where s.assignment_id = a.id and s.student_id = st.id
          and s.status in ('submitted', 'graded')
      )
    group by a.id, a.title
  ),
  unassessed_objectives as (
    select lo.id, lo.title
    from public.curriculum_plans cp
    join public.learning_objectives lo on lo.curriculum_plan_id = cp.id
    where cp.class_id = p_class_id and cp.subject_id = p_subject_id
      and not exists (
        select 1 from active_assignments a where a.learning_objective_id = lo.id
      )
    order by lo.sort_order
  ),
  counts as (
    select
      (select count(*)::integer from class_students) as student_count,
      (select count(*)::integer from active_assignments where learning_objective_id is not null)
        as assessment_count,
      (select count(*)::integer from active_assignments where learning_objective_id is null)
        as unlinked_count,
      (select count(*)::integer from open_items) as open_count,
      (select coalesce(sum(submission_count), 0)::integer from pending_items) as pending_count,
      (select count(*)::integer from public.gradebook_locks gl
        where gl.class_id = p_class_id and gl.subject_id = p_subject_id) as lock_count
  )
  select jsonb_build_object(
    'can_lock', c.lock_count = 0 and c.student_count > 0 and c.assessment_count > 0
      and c.unlinked_count = 0 and c.open_count = 0 and c.pending_count = 0,
    'already_locked', c.lock_count > 0,
    'student_count', c.student_count,
    'assessment_count', c.assessment_count,
    'open_activities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'assignment_id', o.id, 'title', o.title, 'due_at', o.due_at
      ) order by o.title) from open_items o
    ), '[]'::jsonb),
    'ungraded_activities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'assignment_id', p.id, 'title', p.title, 'submission_count', p.submission_count
      ) order by p.title) from pending_items p
    ), '[]'::jsonb),
    'missing_activities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'assignment_id', m.id, 'title', m.title, 'student_count', m.student_count,
        'student_names', m.student_names
      ) order by m.title) from missing_items m
    ), '[]'::jsonb),
    'unlinked_activities', coalesce((
      select jsonb_agg(jsonb_build_object('assignment_id', a.id, 'title', a.title) order by a.title)
      from active_assignments a where a.learning_objective_id is null
    ), '[]'::jsonb),
    'unassessed_objectives', coalesce((
      select jsonb_agg(jsonb_build_object('objective_id', u.id, 'title', u.title))
      from unassessed_objectives u
    ), '[]'::jsonb)
  ) into result
  from counts c;

  return result;
end;
$$;

revoke all on function public.gradebook_readiness(uuid, uuid) from public, anon;
grant execute on function public.gradebook_readiness(uuid, uuid) to authenticated;

create function public.lock_gradebook(p_class_id uuid, p_subject_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  readiness jsonb;
  target_academic_year_id uuid;
  target_period date;
begin
  if public.current_role() <> 'teacher'
     or not public.teaches_class_subject(p_class_id, p_subject_id) then
    raise exception using errcode = '42501',
      message = 'Kamu tidak ditugaskan mengajar kelas dan mata pelajaran ini.';
  end if;

  -- The class row serializes two simultaneous lock/unlock requests. Assignment
  -- row locks serialize finalization with task, quiz and grading writes.
  select c.academic_year_id into target_academic_year_id
  from public.classes c
  join public.academic_years y on y.id = c.academic_year_id and y.is_active
  where c.id = p_class_id
  for update of c;
  if not found then
    raise exception using errcode = '42501',
      message = 'Buku nilai hanya dapat diproses pada tahun ajaran aktif.';
  end if;

  perform 1 from public.assignments a
  where a.class_id = p_class_id and a.subject_id = p_subject_id
  order by a.id for update;

  readiness := public.gradebook_readiness(p_class_id, p_subject_id);
  if coalesce((readiness ->> 'can_lock')::boolean, false) is not true then
    raise exception using errcode = '55000',
      message = case
        when coalesce((readiness ->> 'already_locked')::boolean, false)
          then 'Buku nilai untuk kelas dan mata pelajaran ini sudah dikunci.'
        when jsonb_array_length(readiness -> 'open_activities') > 0
          then 'Buku nilai belum dapat dikunci karena masih ada tugas atau kuis yang terbuka.'
        when jsonb_array_length(readiness -> 'ungraded_activities') > 0
          then 'Buku nilai belum dapat dikunci karena masih ada jawaban yang belum dinilai.'
        when jsonb_array_length(readiness -> 'unlinked_activities') > 0
          then 'Buku nilai belum dapat dikunci karena masih ada tugas atau kuis tanpa TP.'
        when coalesce((readiness ->> 'student_count')::integer, 0) = 0
          then 'Buku nilai belum dapat dikunci karena kelas belum memiliki siswa.'
        else 'Buku nilai belum memiliki aktivitas penilaian yang dapat dihitung.'
      end;
  end if;

  target_period := (clock_timestamp() at time zone 'Asia/Makassar')::date;

  -- Remove only abandoned snapshots from an older non-atomic attempt. An
  -- existing valid lock was rejected above, so no finalized history is lost.
  delete from public.grades g
  where g.class_id = p_class_id and g.subject_id = p_subject_id;

  with
  eligible_assignments as (
    select a.id, a.learning_objective_id
    from public.assignments a
    where a.class_id = p_class_id and a.subject_id = p_subject_id
      and a.is_active and a.is_published
      and a.learning_objective_id is not null
      and a.due_at is not null and a.due_at <= clock_timestamp()
  ),
  class_students as (
    select p.id from public.profiles p
    where p.class_id = p_class_id and p.role = 'student'
  ),
  activity_scores as (
    select st.id as student_id, a.learning_objective_id,
      case when s.status = 'graded' and s.score is not null then s.score else 0 end as score
    from class_students st
    cross join eligible_assignments a
    left join public.submissions s
      on s.assignment_id = a.id and s.student_id = st.id
  ),
  tp_scores as (
    select student_id, learning_objective_id, avg(score) as tp_average
    from activity_scores
    group by student_id, learning_objective_id
  ),
  final_scores as (
    select student_id, round(avg(tp_average), 2) as final_score
    from tp_scores
    group by student_id
  )
  insert into public.grades (
    student_id, subject_id, class_id, academic_year_id,
    period_month, score, created_by
  )
  select fs.student_id, p_subject_id, p_class_id, target_academic_year_id,
    target_period, fs.final_score, auth.uid()
  from final_scores fs;

  insert into public.gradebook_locks (
    class_id, subject_id, period_month, locked_by
  ) values (
    p_class_id, p_subject_id, target_period, auth.uid()
  );

  return readiness || jsonb_build_object('period_month', target_period);
end;
$$;

revoke all on function public.lock_gradebook(uuid, uuid) from public, anon;
grant execute on function public.lock_gradebook(uuid, uuid) to authenticated;

create function public.unlock_gradebook(p_class_id uuid, p_subject_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_lock_id uuid;
begin
  if public.current_role() <> 'teacher'
     or not public.teaches_class_subject(p_class_id, p_subject_id) then
    raise exception using errcode = '42501',
      message = 'Kamu tidak ditugaskan mengajar kelas dan mata pelajaran ini.';
  end if;

  perform 1 from public.classes c where c.id = p_class_id for update;
  select gl.id into target_lock_id
  from public.gradebook_locks gl
  where gl.class_id = p_class_id and gl.subject_id = p_subject_id
  for update;
  if not found then
    raise exception using errcode = '55000', message = 'Buku nilai ini belum dikunci.';
  end if;

  delete from public.grades g
  where g.class_id = p_class_id and g.subject_id = p_subject_id;
  delete from public.gradebook_locks gl where gl.id = target_lock_id;
end;
$$;

revoke all on function public.unlock_gradebook(uuid, uuid) from public, anon;
grant execute on function public.unlock_gradebook(uuid, uuid) to authenticated;

commit;
