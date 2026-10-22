-- No new application tables/columns and no existing answers, grades, or dates are rewritten.
-- Deploy together with the server-side quiz reader; students no longer read the answer bank.
begin;

do $$
declare t text;
begin
  foreach t in array array['quiz_questions', 'quiz_options', 'quiz_pairs', 'quiz_steps'] loop
    execute format('create policy quiz_bank_staff_only on public.%I as restrictive for select
      to anon, authenticated using (public.is_admin() or public.is_teacher() or public.is_principal())', t);
  end loop;
end;
$$;

create function public.assert_quiz_question_ready(p_id uuid)
returns void language plpgsql security invoker set search_path = ''
as $$
declare q public.quiz_questions%rowtype; n integer; valid boolean;
begin
  select * into q from public.quiz_questions where id = p_id;
  if not found or btrim(q.question_text) = '' or q.points <= 0 then
    raise exception using errcode = '22023', message = 'Pertanyaan dan bobot soal belum lengkap.';
  end if;
  if q.question_type = 'multiple_choice' then
    select count(*), count(*) filter (where is_correct) = 1 and bool_and(btrim(option_text) <> '')
      into n, valid from public.quiz_options where question_id = p_id;
  elsif q.question_type = 'true_false' then
    n := 2; valid := q.correct_answer_text in ('benar', 'salah');
  elsif q.question_type = 'drag_and_drop' then
    select count(*), bool_and(btrim(drag_text) <> '' and btrim(target_text) <> '')
      into n, valid from public.quiz_pairs where question_id = p_id;
  elsif q.question_type = 'sequence' then
    select count(*), count(distinct correct_order) = count(*) and min(correct_order) = 1
      and max(correct_order) = count(*) and bool_and(btrim(step_text) <> '')
      into n, valid from public.quiz_steps where question_id = p_id;
  else
    n := 0; valid := false;
  end if;
  if n < 2 or valid is not true then
    raise exception using errcode = '22023', message = 'Pilihan, pasangan, urutan, atau kunci jawaban soal belum lengkap.';
  end if;
end;
$$;
revoke all on function public.assert_quiz_question_ready(uuid) from public, anon;
grant execute on function public.assert_quiz_question_ready(uuid) to authenticated, service_role;

create function public.assert_quiz_bank_ready(p_id uuid)
returns void language plpgsql security invoker set search_path = ''
as $$
declare q record;
begin
  if (select coalesce(sum(points), 0) from public.quiz_questions where assignment_id = p_id and is_active) <> 100 then
    raise exception using errcode = '22023', message = 'Total bobot soal aktif harus tepat 100 poin.';
  end if;
  for q in select id from public.quiz_questions where assignment_id = p_id and is_active loop
    perform public.assert_quiz_question_ready(q.id);
  end loop;
end;
$$;
revoke all on function public.assert_quiz_bank_ready(uuid) from public, anon;
grant execute on function public.assert_quiz_bank_ready(uuid) to authenticated, service_role;

create function public.guard_quiz_bank_write()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare assignment_id uuid; parent public.assignments%rowtype; record_id uuid;
begin
  if tg_op = 'UPDATE' and (new.id is distinct from old.id) then
    raise exception using errcode = '55000', message = 'Identitas soal dan pilihan tidak dapat diubah.';
  end if;
  if tg_table_name = 'quiz_questions' then
    if tg_op = 'UPDATE' and new.assignment_id is distinct from old.assignment_id then
      raise exception using errcode = '55000', message = 'Soal tidak dapat dipindahkan ke kuis lain.';
    end if;
    assignment_id := case when tg_op = 'DELETE' then old.assignment_id else new.assignment_id end;
  else
    if tg_op = 'UPDATE' and new.question_id is distinct from old.question_id then
      raise exception using errcode = '55000', message = 'Pilihan tidak dapat dipindahkan ke soal lain.';
    end if;
    record_id := case when tg_op = 'DELETE' then old.question_id else new.question_id end;
    select q.assignment_id into assignment_id from public.quiz_questions q where q.id = record_id;
  end if;
  -- Serializes bank edits with publication, grading, and parent deletion.
  select a.* into parent from public.assignments a where a.id = assignment_id for update;
  if not found then
    -- Cascading cleanup of an unused quiz/question; its parent guard has already run.
    if tg_op = 'DELETE' then return old; end if;
    raise exception using errcode = '23503', message = 'Kuis tidak ditemukan.';
  end if;
  if parent.kind <> 'quiz' or parent.is_published or exists (
    select 1 from public.submissions s where s.assignment_id = parent.id
  ) then
    raise exception using errcode = '55000', message = 'Soal dikunci sejak kuis dipublikasikan. Buat kuis baru untuk mengubah soal.';
  end if;
  if auth.uid() is not null and public.is_admin() is not true and (
    public.is_teacher() is not true or parent.teacher_id is distinct from auth.uid()
    or not exists (select 1 from public.class_teacher_subjects c
      where c.class_id = parent.class_id and c.subject_id = parent.subject_id and c.teacher_id = auth.uid())
  ) then
    raise exception using errcode = '42501', message = 'Soal tidak sesuai penugasan mengajarmu.';
  end if;
  if tg_table_name = 'quiz_questions' then
    if tg_op <> 'DELETE' and new.is_active then
      if new.points + (select coalesce(sum(q.points), 0) from public.quiz_questions q
        where q.assignment_id = parent.id and q.is_active and q.id <> new.id) > 100 then
        raise exception using errcode = '22023', message = 'Total bobot soal aktif tidak boleh melebihi 100 poin.';
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.guard_quiz_bank_write() from public, anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['quiz_questions', 'quiz_options', 'quiz_pairs', 'quiz_steps'] loop
    execute format('create trigger quiz_bank_guard before insert or update or delete on public.%I
      for each row execute function public.guard_quiz_bank_write()', t);
  end loop;
end;
$$;

create function public.guard_quiz_assignment()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.kind = 'quiz' and exists (select 1 from public.submissions where assignment_id = old.id) then
      raise exception using errcode = '55000', message = 'Kuis tidak dapat dihapus karena sudah memiliki jawaban siswa.';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.kind = 'quiz' and new.is_published then
      raise exception using errcode = '55000', message = 'Buat kuis sebagai draft, lengkapi soal, lalu publikasikan.';
    end if;
    return new;
  end if;
  if old.kind <> 'quiz' and new.kind = 'quiz' and exists (
    select 1 from public.submissions where assignment_id = old.id
  ) then
    raise exception using errcode = '55000', message = 'Jenis tugas yang sudah memiliki pengumpulan tidak dapat diubah.';
  end if;
  if old.kind = 'quiz' and (old.is_published or exists (
    select 1 from public.submissions where assignment_id = old.id
  )) then
    if (to_jsonb(new) - array['title', 'description', 'due_at', 'is_active', 'updated_at', 'teacher_id'])
      is distinct from (to_jsonb(old) - array['title', 'description', 'due_at', 'is_active', 'updated_at', 'teacher_id'])
      or (new.teacher_id is distinct from old.teacher_id and not (
        new.teacher_id is null and not exists (select 1 from public.profiles where id = old.teacher_id)
      )) then
      -- Keep existing ON DELETE SET NULL behavior when a teacher account is removed.
      raise exception using errcode = '55000', message = 'Kuis yang dipublikasikan hanya dapat diubah judul, instruksi, tenggat, dan keaktifannya.';
    end if;
  end if;
  if new.kind = 'quiz' and new.is_published and (
    not old.is_published or old.kind <> 'quiz' or (new.is_active and not old.is_active)
  ) then
    if new.due_at is null or new.due_at <= clock_timestamp() then
      raise exception using errcode = '22023', message = 'Isi tenggat WITA yang belum berakhir sebelum mempublikasikan atau mengaktifkan kuis.';
    end if;
    perform public.assert_quiz_bank_ready(new.id);
  end if;
  return new;
end;
$$;
create trigger assignments_guard_quiz before insert or update or delete on public.assignments
  for each row execute function public.guard_quiz_assignment();
revoke all on function public.guard_quiz_assignment() from public, anon, authenticated;

-- One transaction preserves the previous draft if any question/choice write fails.
create function public.save_quiz_question(p_assignment_id uuid, p_question_id uuid, p_question jsonb)
returns uuid language plpgsql security invoker set search_path = ''
as $$
declare parent public.assignments%rowtype; question_id uuid; question_type text;
begin
  select a.* into parent from public.assignments a where a.id = p_assignment_id for update;
  if not found or public.is_teacher() is not true or parent.teacher_id <> auth.uid()
     or parent.kind <> 'quiz' or not exists (
       select 1 from public.class_teacher_subjects c where c.class_id = parent.class_id
         and c.subject_id = parent.subject_id and c.teacher_id = auth.uid()
     ) then
    raise exception using errcode = '42501', message = 'Kuis tidak tersedia untuk penugasan mengajarmu.';
  end if;
  if parent.is_published or exists (select 1 from public.submissions s where s.assignment_id = parent.id) then
    raise exception using errcode = '55000', message = 'Soal dikunci sejak kuis dipublikasikan. Buat kuis baru untuk mengubah soal.';
  end if;
  question_type := p_question->>'questionType';
  if jsonb_typeof(p_question) is distinct from 'object' or question_type is null
    or question_type not in ('multiple_choice', 'true_false', 'drag_and_drop', 'sequence')
    or nullif(btrim(p_question->>'questionText'), '') is null then
    raise exception using errcode = '22023', message = 'Pertanyaan atau jenis soal tidak valid.';
  end if;
  if p_question_id is null then
    insert into public.quiz_questions (assignment_id, question_text, question_type, points, explanation, correct_answer_text, sort_order)
      values (parent.id, btrim(p_question->>'questionText'), question_type, (p_question->>'points')::integer,
        nullif(btrim(p_question->>'explanation'), ''), p_question->>'correctAnswerText',
        (select coalesce(max(q.sort_order), -1) + 1 from public.quiz_questions q where q.assignment_id = parent.id))
      returning id into question_id;
  else
    update public.quiz_questions q set question_text = btrim(p_question->>'questionText'),
      question_type = p_question->>'questionType', points = (p_question->>'points')::integer,
      explanation = nullif(btrim(p_question->>'explanation'), ''), correct_answer_text = p_question->>'correctAnswerText'
      where q.id = p_question_id and q.assignment_id = parent.id returning id into question_id;
    if not found then raise exception using errcode = '42501', message = 'Soal tidak ditemukan.'; end if;
    delete from public.quiz_options o where o.question_id = p_question_id;
    delete from public.quiz_pairs p where p.question_id = p_question_id;
    delete from public.quiz_steps s where s.question_id = p_question_id;
  end if;
  if question_type = 'multiple_choice' then
    insert into public.quiz_options (question_id, option_text, is_correct, sort_order)
      select question_id, btrim(value->>'text'), (value->>'isCorrect')::boolean, ordinality - 1
      from jsonb_array_elements(p_question->'options') with ordinality;
  elsif question_type = 'drag_and_drop' then
    insert into public.quiz_pairs (question_id, drag_text, target_text, sort_order)
      select question_id, btrim(value->>'dragText'), btrim(value->>'targetText'), ordinality - 1
      from jsonb_array_elements(p_question->'pairs') with ordinality;
  elsif question_type = 'sequence' then
    insert into public.quiz_steps (question_id, step_text, correct_order)
      select question_id, btrim(value), ordinality from jsonb_array_elements_text(p_question->'steps') with ordinality;
  end if;
  perform public.assert_quiz_question_ready(question_id);
  return question_id;
end;
$$;
revoke all on function public.save_quiz_question(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_quiz_question(uuid, uuid, jsonb) to authenticated;

-- Lock the same parent row as deletion/publication and check active-year access
-- at the final write boundary, even for the privileged scoring client.
create function public.guard_quiz_submission()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare parent public.assignments%rowtype;
begin
  select a.* into parent from public.assignments a where a.id = new.assignment_id for update;
  if parent.kind <> 'quiz' then return new; end if;
  if new.status = 'graded' and (tg_op = 'INSERT' or old.status <> 'graded') then
    if not parent.is_published or not parent.is_active or (parent.due_at is not null and parent.due_at <= clock_timestamp())
      or not exists (
        select 1 from public.profiles p join public.classes c on c.id = p.class_id
        join public.academic_years y on y.id = c.academic_year_id and y.school_id = p.school_id
        where p.id = new.student_id and p.role = 'student' and p.class_id = parent.class_id and y.is_active
      ) then
      raise exception using errcode = '42501', message = 'Kuis tidak tersedia pada tahun ajaran aktif atau tenggat sudah berakhir.';
    end if;
    perform public.assert_quiz_bank_ready(parent.id);
  end if;
  return new;
end;
$$;
create trigger submissions_guard_quiz before insert or update on public.submissions
  for each row execute function public.guard_quiz_submission();
revoke all on function public.guard_quiz_submission() from public, anon, authenticated;

commit;
