-- Restore the trusted quiz scoring boundary for databases that were provisioned
-- from selected SQL files instead of the complete migration chain.
-- This migration adds no tables/columns and does not rewrite existing data.
begin;

create or replace function public.save_scored_quiz(
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

commit;
