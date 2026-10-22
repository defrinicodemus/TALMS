-- No new application tables/columns, and no existing answers or deadlines are rewritten.
-- Task writes go through a server-only RPC so photo validation and deadline checks
-- cannot be bypassed with a student's direct REST request. Quiz handling is unchanged.
begin;

create function public.guard_task_submission_channel()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'supabase_admin', 'service_role')
     and public.is_student() is true
     and exists (select 1 from public.assignments a where a.id = new.assignment_id and a.kind <> 'quiz') then
    raise exception using errcode = '42501', message = 'Kumpulkan tugas melalui halaman pengumpulan tugas.';
  end if;
  return new;
end;
$$;
create trigger submissions_guard_task_channel before insert or update on public.submissions
  for each row execute function public.guard_task_submission_channel();
revoke all on function public.guard_task_submission_channel() from public, anon, authenticated;

create function public.save_assignment_submission(
  p_assignment_id uuid, p_student_id uuid, p_method text, p_content text,
  p_expected_updated_at timestamptz
)
returns table (submitted_at timestamptz, updated_at timestamptz)
language plpgsql security invoker set search_path = ''
as $$
declare
  task public.assignments%rowtype;
  previous public.submissions%rowtype;
  methods text[];
begin
  -- Serializes submission eligibility with deadline/publication changes and deletion.
  select a.* into task from public.assignments a where a.id = p_assignment_id for update;
  if not found or task.kind = 'quiz' or task.is_published is not true or not exists (
    select 1 from public.profiles p
    join public.classes c on c.id = p.class_id
    join public.academic_years y on y.id = c.academic_year_id and y.school_id = p.school_id
    where p.id = p_student_id and p.role = 'student' and p.class_id = task.class_id and y.is_active
  ) then
    raise exception using errcode = '42501', message = 'Tugas tidak tersedia untuk kelasmu pada tahun ajaran aktif.';
  end if;
  select coalesce(array_agg(m), case when task.kind = 'photo' then array['photo'] else array['text'] end)
    into methods from unnest(task.allowed_methods) m where m in ('text', 'photo');
  if p_method is null or not (p_method = any(methods)) or p_content is null or btrim(p_content) = '' then
    raise exception using errcode = '22023', message = 'Jawaban tidak sesuai metode pengumpulan tugas.';
  end if;
  if p_method = 'photo' and p_content !~ (
    '^assignment-submissions/' || p_assignment_id::text || '/' || p_student_id::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$'
  ) then
    raise exception using errcode = '22023', message = 'Foto pengumpulan tidak valid.';
  end if;
  if p_method = 'text' and (char_length(p_content) > 20000 or p_content like 'assignment-submissions/%') then
    raise exception using errcode = '22023', message = 'Jawaban teks tidak valid atau terlalu panjang.';
  end if;
  select s.* into previous from public.submissions s
    where s.assignment_id = p_assignment_id and s.student_id = p_student_id for update;
  -- Check after waiting on both rows, so time spent waiting cannot bypass the deadline.
  if task.due_at is not null and task.due_at <= clock_timestamp() then
    raise exception using errcode = '55000', message = 'Tenggat pengumpulan sudah berakhir. Hubungi guru untuk perpanjangan waktu.';
  end if;
  if found then
    if previous.status = 'graded' or previous.score is not null or previous.graded_at is not null or previous.graded_by is not null then
      raise exception using errcode = '55000', message = 'Tugas ini sudah dinilai dan tidak bisa diubah lagi.';
    end if;
    if previous.updated_at is distinct from p_expected_updated_at then
      raise exception using errcode = '55000', message = 'Pengumpulan sudah berubah. Muat ulang halaman sebelum mengirim lagi.';
    end if;
    return query update public.submissions s set content_url = btrim(p_content), status = 'submitted',
      submitted_at = clock_timestamp(), updated_at = clock_timestamp()
      where s.id = previous.id returning s.submitted_at, s.updated_at;
  else
    if p_expected_updated_at is not null then
      raise exception using errcode = '55000', message = 'Pengumpulan sudah berubah. Muat ulang halaman sebelum mengirim lagi.';
    end if;
    return query insert into public.submissions as s (assignment_id, student_id, content_url, status, submitted_at)
      values (p_assignment_id, p_student_id, btrim(p_content), 'submitted', clock_timestamp())
      returning s.submitted_at, s.updated_at;
  end if;
end;
$$;
revoke all on function public.save_assignment_submission(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.save_assignment_submission(uuid, uuid, text, text, timestamptz) to service_role;

-- The parent row is locked by DELETE. The submission RPC takes the same lock,
-- preventing a new answer from arriving between this check and the delete.
create function public.guard_used_task_delete()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if old.kind <> 'quiz' and exists (select 1 from public.submissions s where s.assignment_id = old.id) then
    raise exception using errcode = '55000', message = 'Tugas tidak dapat dihapus karena sudah memiliki pengumpulan siswa.';
  end if;
  return old;
end;
$$;
create trigger assignments_guard_used_task_delete before delete on public.assignments
  for each row execute function public.guard_used_task_delete();
revoke all on function public.guard_used_task_delete() from public, anon, authenticated;

-- Do not allow relabeling a used task as a quiz to bypass the deletion guard.
create function public.guard_used_task_kind()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if old.kind <> 'quiz' and new.kind is distinct from old.kind
     and exists (select 1 from public.submissions s where s.assignment_id = old.id) then
    raise exception using errcode = '55000', message = 'Jenis tugas yang sudah memiliki pengumpulan tidak dapat diubah.';
  end if;
  return new;
end;
$$;
create trigger assignments_guard_used_task_kind before update of kind on public.assignments
  for each row execute function public.guard_used_task_kind();
revoke all on function public.guard_used_task_kind() from public, anon, authenticated;

-- Supabase Storage already owns these tables. Add only a private bucket, not a
-- new application table. Local database tests without Storage skip this block.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('assignment-submissions', 'assignment-submissions', false, 2097152,
        array['image/jpeg', 'image/png', 'image/webp'])
      on conflict (id) do update set public = false, file_size_limit = 2097152,
        allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];
    -- No client storage policies: validated server uploads and short-lived signed reads only.
    execute 'create policy task_photos_server_only on storage.objects as restrictive for all
      to anon, authenticated using (bucket_id <> ''assignment-submissions'')
      with check (bucket_id <> ''assignment-submissions'')';
  end if;
end;
$$;

commit;
