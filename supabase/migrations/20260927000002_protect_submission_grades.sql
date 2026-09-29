-- Row ownership alone must not let a student assign their own grade.
create function public.guard_submission_write()
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

    -- Preserve the existing teacher scope; RLS still checks the target row.
    if public.is_teacher() is true and exists (
      select 1 from public.assignments a
      where a.id = new.assignment_id and public.teaches_class(a.class_id)
    ) then
      return new;
    end if;
  end if;

  if public.is_student() is not true or new.student_id is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'Tidak diizinkan mengubah pengumpulan tugas.';
  end if;

  if tg_op = 'UPDATE' then
    -- Freeze even partially graded legacy rows. A student cannot clear the
    -- grade/status first, replace the answer, or move a grade to another task.
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

  -- Applies to INSERT as well as UPDATE, including both paths of an upsert.
  if new.status = 'graded' or new.score is not null or new.teacher_comment is not null
     or new.graded_at is not null or new.graded_by is not null then
    raise exception using errcode = '42501',
      message = 'Nilai dan catatan penilaian hanya dapat disimpan oleh guru, admin, atau sistem.';
  end if;

  return new;
end;
$$;

create trigger submissions_guard_write
  before insert or update on public.submissions
  for each row execute function public.guard_submission_write();

revoke all on function public.guard_submission_write() from public, anon, authenticated;

-- Per-question points are also grading data. Students submit raw answers to
-- the server action; they may not insert fabricated review rows through REST.
drop policy quiz_answers_insert on public.quiz_answers;
create policy quiz_answers_insert on public.quiz_answers for insert
  with check (public.is_admin());

-- Only the trusted server may pass precomputed scores to this routine.
-- The server derives student_id from the verified session and computes points
-- from the question bank. No client-supplied score is accepted by that action.
create function public.save_scored_quiz(
  p_assignment_id uuid,
  p_student_id uuid,
  p_score numeric,
  p_answers jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_submission_id uuid;
begin
  -- Check access again at the privileged write boundary, independently of the
  -- preceding read with the student's session. Never accept an arbitrary task.
  if not exists (
    select 1 from public.assignments a
    join public.profiles p on p.id = p_student_id and p.class_id = a.class_id
    where a.id = p_assignment_id and p.role = 'student'
      and a.kind = 'quiz' and a.is_published and a.is_active
      and (a.due_at is null or a.due_at >= now())
  ) then
    raise exception using errcode = '42501',
      message = 'Kuis tidak tersedia untuk murid ini atau waktu pengerjaannya sudah berakhir.';
  end if;

  if p_score is null or not (p_score between 0 and 100)
     or jsonb_typeof(p_answers) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Hasil kuis tidak valid.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_answers) as r(
      question_id uuid, selected_option_id uuid, points_earned numeric
    )
    left join public.quiz_questions q
      on q.id = r.question_id and q.assignment_id = p_assignment_id and q.is_active
    left join public.quiz_options o
      on o.id = r.selected_option_id and o.question_id = q.id
    where q.id is null or (r.selected_option_id is not null and o.id is null)
       or r.points_earned is null or not (r.points_earned between 0 and q.points)
  ) or (
    select count(*) <> count(distinct r.question_id)
       or coalesce(sum(r.points_earned), 0) <> p_score
    from jsonb_to_recordset(p_answers) as r(question_id uuid, points_earned numeric)
  ) then
    raise exception using errcode = '22023', message = 'Rincian nilai kuis tidak valid.';
  end if;

  -- The conflict predicate runs while the existing submission is locked. A
  -- repeat request cannot overwrite a grade, even if both initial reads saw
  -- an unfinished attempt. All answer writes below share this transaction.
  insert into public.submissions as existing (
    assignment_id, student_id, status, score, submitted_at, graded_at
  ) values (
    p_assignment_id, p_student_id, 'graded', p_score, now(), now()
  )
  on conflict (assignment_id, student_id) do update
    set status = excluded.status, score = excluded.score,
        submitted_at = excluded.submitted_at, graded_at = excluded.graded_at,
        content_url = null, teacher_comment = null, graded_by = null
    where existing.status <> 'graded' and existing.score is null
      and existing.graded_at is null and existing.graded_by is null
  returning id into v_submission_id;

  if v_submission_id is null then
    raise exception using errcode = '55000', message = 'Kuis ini sudah pernah kamu kerjakan.';
  end if;

  -- Replace any unfinished legacy answer rows, never rows of a graded attempt.
  delete from public.quiz_answers qa where qa.submission_id = v_submission_id;
  insert into public.quiz_answers (
    submission_id, question_id, selected_option_id, true_false_answer,
    drag_drop_answer, sequence_answer, points_earned
  )
  select v_submission_id, r.question_id, r.selected_option_id, r.true_false_answer,
         r.drag_drop_answer, r.sequence_answer, r.points_earned
  from jsonb_to_recordset(p_answers) as r(
    question_id uuid, selected_option_id uuid, true_false_answer text,
    drag_drop_answer jsonb, sequence_answer jsonb, points_earned numeric
  );

  return v_submission_id;
end;
$$;

revoke all on function public.save_scored_quiz(uuid, uuid, numeric, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_scored_quiz(uuid, uuid, numeric, jsonb) to service_role;
grant select on public.profiles, public.assignments, public.quiz_questions, public.quiz_options
  to service_role;
grant select, insert, update on public.submissions to service_role;
grant select, insert, delete on public.quiz_answers to service_role;
