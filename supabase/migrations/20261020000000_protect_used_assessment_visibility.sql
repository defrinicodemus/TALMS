-- Keep activities that already contain student work visible to the gradebook.
-- This changes workflow rules only; no table or column is added.
begin;

-- Repair older, still-unlocked tasks that were hidden after students had
-- already submitted. Locked books keep their immutable final snapshot.
update public.assignments a
set is_published = true
where exists (
    select 1 from public.submissions s where s.assignment_id = a.id
  )
  and not exists (
    select 1 from public.gradebook_locks gl
    where gl.class_id = a.class_id and gl.subject_id = a.subject_id
  )
  and a.kind <> 'quiz'
  and not a.is_published;

-- Old quiz rows can be inactive even though answers already exist. Reactivate
-- them without changing their original deadline. A short temporary deadline is
-- needed because the existing quiz guard correctly rejects reactivation with
-- an expired deadline.
do $$
declare
  target record;
begin
  for target in
    select a.id, a.due_at
    from public.assignments a
    where a.kind = 'quiz'
      and not a.is_active
      and exists (
        select 1 from public.submissions s where s.assignment_id = a.id
      )
      and not exists (
        select 1 from public.gradebook_locks gl
        where gl.class_id = a.class_id and gl.subject_id = a.subject_id
      )
  loop
    update public.assignments
    set due_at = greatest(coalesce(target.due_at, clock_timestamp()), clock_timestamp() + interval '1 minute'),
        is_active = true
    where id = target.id;

    update public.assignments
    set due_at = coalesce(target.due_at, clock_timestamp())
    where id = target.id;
  end loop;
end;
$$;

create function public.guard_used_assessment_visibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.kind = 'quiz'
     and old.is_active
     and not new.is_active
     and exists (
       select 1 from public.submissions s where s.assignment_id = old.id
     ) then
    raise exception using errcode = '55000',
      message = 'Kuis tidak dapat dinonaktifkan karena sudah memiliki jawaban siswa. Gunakan tenggat untuk menutup pengerjaan.';
  end if;

  if old.kind <> 'quiz'
     and old.is_published
     and not new.is_published
     and exists (
       select 1 from public.submissions s where s.assignment_id = old.id
     ) then
    raise exception using errcode = '55000',
      message = 'Tugas tidak dapat dinonaktifkan karena sudah memiliki pengumpulan siswa. Gunakan tenggat untuk menutup pengumpulan.';
  end if;

  if new.kind <> 'quiz'
     and not old.is_published
     and new.is_published
     and (new.due_at is null or new.due_at <= clock_timestamp()) then
    raise exception using errcode = '22023',
      message = 'Perpanjang tenggat tugas sebelum mengaktifkannya kembali.';
  end if;

  return new;
end;
$$;

drop trigger if exists assignments_guard_used_visibility on public.assignments;
create trigger assignments_guard_used_visibility
  before update of is_active, is_published on public.assignments
  for each row execute function public.guard_used_assessment_visibility();

revoke all on function public.guard_used_assessment_visibility() from public, anon, authenticated;

commit;
