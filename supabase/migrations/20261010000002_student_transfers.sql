-- Student placement only. No tables, columns, lifecycle statuses or existing
-- data are added/rewritten. Teacher assignments and learning records are untouched.
create function public.transfer_academic_students(
  p_kind text, p_source_year_id uuid, p_target_year_id uuid, p_mappings jsonb
)
returns integer language plpgsql security invoker set search_path = ''
as $$
declare
  school_id_value uuid;
  source_year public.academic_years%rowtype;
  target_year public.academic_years%rowtype;
  source_class public.classes%rowtype;
  target_class public.classes%rowtype;
  source_parts text[];
  target_parts text[];
  mapping jsonb;
  source_id uuid;
  target_id uuid;
  student_ids uuid[];
  seen_sources uuid[] := '{}';
  seen_targets uuid[] := '{}';
  seen_students uuid[] := '{}';
  affected integer;
  moved integer := 0;
begin
  select p.school_id into school_id_value from public.profiles p
    where p.id = auth.uid() and p.role = 'admin';
  if school_id_value is null then
    raise exception using errcode = '42501', message = 'Hanya admin sekolah yang dapat memindahkan siswa.';
  end if;

  -- Activation/deactivation use the same lock. Recheck after acquiring it,
  -- so an activation that finishes first prevents a stale transfer request.
  perform 1 from public.schools where id = school_id_value for update;
  if not found then
    raise exception using errcode = '42501', message = 'Sekolah tidak dapat diakses.';
  end if;
  if exists (select 1 from public.academic_years y where y.school_id = school_id_value and y.is_active) then
    raise exception using errcode = '55000', message = 'Nonaktifkan tahun ajaran yang sedang berjalan sebelum memproses perpindahan siswa.';
  end if;
  if p_kind is null or p_kind not in ('semester', 'promotion') then
    raise exception using errcode = '22023', message = 'Jenis perpindahan tidak valid.';
  end if;

  select * into source_year from public.academic_years
    where id = p_source_year_id and school_id = school_id_value for share;
  if not found then
    raise exception using errcode = '22023', message = 'Periode asal tidak ditemukan di sekolah ini.';
  end if;
  select * into target_year from public.academic_years
    where id = p_target_year_id and school_id = school_id_value for share;
  if not found or p_source_year_id = p_target_year_id or source_year.is_active or target_year.is_active then
    raise exception using errcode = '22023', message = 'Periode tujuan tidak valid atau masih aktif.';
  end if;
  source_parts := regexp_match(btrim(source_year.year_label), '^(\d{4})\s*/\s*(\d{4})$');
  target_parts := regexp_match(btrim(target_year.year_label), '^(\d{4})\s*/\s*(\d{4})$');
  if source_parts is null or target_parts is null
    or source_parts[2]::integer <> source_parts[1]::integer + 1
    or target_parts[2]::integer <> target_parts[1]::integer + 1 then
    raise exception using errcode = '22023', message = 'Format tahun ajaran harus berurutan, misalnya 2026/2027.';
  end if;
  if (p_kind = 'semester' and not (source_year.semester = 'ganjil' and target_year.semester = 'genap'
      and target_parts[1]::integer = source_parts[1]::integer))
    or (p_kind = 'promotion' and not (source_year.semester = 'genap' and target_year.semester = 'ganjil'
      and target_parts[1]::integer = source_parts[1]::integer + 1)) then
    raise exception using errcode = '22023', message = 'Periode tujuan tidak sesuai jenis perpindahan. Pilih semester atau tahun ajaran berikutnya.';
  end if;
  if jsonb_typeof(p_mappings) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Daftar perpindahan tidak valid.';
  end if;
  if jsonb_array_length(p_mappings) = 0 then
    raise exception using errcode = '22023', message = 'Pilih minimal satu siswa dan kelas tujuan.';
  end if;

  -- Validate every mapping and lock the actual students before any writes.
  for mapping in select value from jsonb_array_elements(p_mappings) loop
    if jsonb_typeof(mapping) is distinct from 'object'
      or jsonb_typeof(mapping->'studentIds') is distinct from 'array' then
      raise exception using errcode = '22023', message = 'Pemetaan kelas dan siswa tidak valid.';
    end if;
    source_id := (mapping->>'sourceClassId')::uuid;
    target_id := (mapping->>'targetClassId')::uuid;
    if source_id is null or target_id is null or source_id = target_id
      or source_id = any(seen_sources) or target_id = any(seen_targets) then
      raise exception using errcode = '22023', message = 'Kelas asal dan tujuan harus berbeda dan tidak boleh dipetakan berulang.';
    end if;
    select * into source_class from public.classes
      where id = source_id and school_id = school_id_value and academic_year_id = p_source_year_id for share;
    if not found then
      raise exception using errcode = '22023', message = 'Kelas asal tidak sesuai periode dan sekolah yang dipilih.';
    end if;
    select * into target_class from public.classes
      where id = target_id and school_id = school_id_value and academic_year_id = p_target_year_id for share;
    if not found then
      raise exception using errcode = '22023', message = 'Kelas tujuan tidak sesuai periode dan sekolah yang dipilih.';
    end if;
    if source_class.grade_level not between 1 and 6 or target_class.grade_level not between 1 and 6
      or (p_kind = 'semester' and target_class.grade_level <> source_class.grade_level)
      or (p_kind = 'promotion' and (source_class.grade_level >= 6 or target_class.grade_level <> source_class.grade_level + 1)) then
      raise exception using errcode = '22023', message = 'Tingkat kelas tujuan tidak sesuai jenis perpindahan.';
    end if;
    select array_agg(value::uuid) into student_ids from jsonb_array_elements_text(mapping->'studentIds');
    if coalesce(cardinality(student_ids), 0) = 0 or array_position(student_ids, null) is not null
      or cardinality(student_ids) <> (select count(distinct value) from unnest(student_ids) value)
      or student_ids && seen_students then
      raise exception using errcode = '22023', message = 'Pilih siswa tanpa duplikasi pada setiap pasangan kelas.';
    end if;
    perform 1 from public.profiles p where p.id = any(student_ids)
      and p.role = 'student' and p.school_id = school_id_value and p.class_id = source_id
      order by p.id for update;
    get diagnostics affected = row_count;
    if affected <> cardinality(student_ids) then
      raise exception using errcode = '22023', message = 'Penempatan siswa telah berubah atau siswa tidak sesuai kelas asal. Muat ulang halaman dan periksa pilihan.';
    end if;
    seen_sources := array_append(seen_sources, source_id);
    seen_targets := array_append(seen_targets, target_id);
    seen_students := seen_students || student_ids;
  end loop;

  for mapping in select value from jsonb_array_elements(p_mappings) loop
    select array_agg(value::uuid) into student_ids from jsonb_array_elements_text(mapping->'studentIds');
    update public.profiles set class_id = (mapping->>'targetClassId')::uuid
      where id = any(student_ids) and role = 'student' and school_id = school_id_value
        and class_id = (mapping->>'sourceClassId')::uuid;
    get diagnostics affected = row_count;
    if affected <> cardinality(student_ids) then
      raise exception using errcode = '22023', message = 'Perpindahan siswa tidak lengkap. Seluruh perubahan dibatalkan.';
    end if;
    moved := moved + affected;
  end loop;
  return moved;
end;
$$;

revoke all on function public.transfer_academic_students(text, uuid, uuid, jsonb) from public, anon;
grant execute on function public.transfer_academic_students(text, uuid, uuid, jsonb) to authenticated;
