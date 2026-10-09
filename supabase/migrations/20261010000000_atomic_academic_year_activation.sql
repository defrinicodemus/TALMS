-- Preserve existing years. Conflicting active rows require an explicit review,
-- rather than silently choosing which school year should remain active.
do $$
begin
  if exists (
    select school_id from public.academic_years
    where is_active group by school_id having count(*) > 1
  ) then
    raise exception 'Ada sekolah dengan lebih dari satu tahun ajaran aktif. Periksa status tahun ajaran tersebut sebelum menjalankan migrasi ini.';
  end if;
end;
$$;

create unique index academic_years_one_active_per_school_idx
  on public.academic_years(school_id) where is_active;

-- Invoker rights retain existing RLS. The parent lock serializes activation
-- requests for the same school; both updates roll back if either fails.
create function public.set_active_academic_year(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_school_id uuid;
begin
  if public.is_admin() is not true then
    raise exception using errcode = '42501', message = 'Hanya admin yang dapat mengaktifkan tahun ajaran.';
  end if;

  select school_id into target_school_id
  from public.academic_years where id = p_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Tahun ajaran tidak ditemukan.';
  end if;

  perform 1 from public.schools where id = target_school_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Data sekolah tidak ditemukan.';
  end if;

  -- Recheck and lock the selected year after waiting for another activation.
  perform 1 from public.academic_years
  where id = p_id and school_id = target_school_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Tahun ajaran tidak ditemukan.';
  end if;

  update public.academic_years set is_active = false
  where school_id = target_school_id and is_active and id <> p_id;

  update public.academic_years set is_active = true
  where id = p_id and school_id = target_school_id;
  if not found then
    raise exception using errcode = '42501', message = 'Tahun ajaran tidak dapat diaktifkan.';
  end if;
end;
$$;

revoke all on function public.set_active_academic_year(uuid) from public, anon;
grant execute on function public.set_active_academic_year(uuid) to authenticated;
