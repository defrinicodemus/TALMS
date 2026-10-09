-- Preserve activity-to-TP links. These replace SET NULL, not activity rows.
alter table public.materials drop constraint materials_learning_objective_id_fkey;
alter table public.materials add constraint materials_learning_objective_id_fkey
  foreign key (learning_objective_id) references public.learning_objectives(id) on delete restrict;
alter table public.assignments drop constraint assignments_learning_objective_id_fkey;
alter table public.assignments add constraint assignments_learning_objective_id_fkey
  foreign key (learning_objective_id) references public.learning_objectives(id) on delete restrict;
alter table public.class_meetings drop constraint class_meetings_learning_objective_id_fkey;
alter table public.class_meetings add constraint class_meetings_learning_objective_id_fkey
  foreign key (learning_objective_id) references public.learning_objectives(id) on delete restrict;
create index if not exists class_meetings_learning_objective_id_idx
  on public.class_meetings(learning_objective_id);

-- Count all references, including draft/inactive activities hidden by student
-- RLS. Limit exposure to staff responsible for the plan. No stored usage status.
create function public.learning_objective_usage(p_ids uuid[])
returns table (id uuid, materials bigint, assignments bigint, quizzes bigint, meetings bigint)
language sql stable security definer set search_path = ''
as $$
  select lo.id,
    (select count(*) from public.materials m where m.learning_objective_id = lo.id),
    (select count(*) from public.assignments a where a.learning_objective_id = lo.id and a.kind <> 'quiz'),
    (select count(*) from public.assignments a where a.learning_objective_id = lo.id and a.kind = 'quiz'),
    (select count(*) from public.class_meetings m where m.learning_objective_id = lo.id)
  from public.learning_objectives lo
  join public.curriculum_plans cp on cp.id = lo.curriculum_plan_id
  where lo.id = any(p_ids) and (
    public.is_admin() or public.is_principal() or (
      public.is_teacher() and exists (
        select 1 from public.class_teacher_subjects cts
        where cts.teacher_id = auth.uid() and cts.class_id = cp.class_id and cts.subject_id = cp.subject_id
      )
    )
  );
$$;
revoke all on function public.learning_objective_usage(uuid[]) from public, anon;
grant execute on function public.learning_objective_usage(uuid[]) to authenticated;

-- Internal helper: triggers must see dependencies even when RLS hides them.
create function public.learning_objective_is_used(p_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.materials where learning_objective_id = p_id)
    or exists (select 1 from public.assignments where learning_objective_id = p_id)
    or exists (select 1 from public.class_meetings where learning_objective_id = p_id);
$$;
revoke all on function public.learning_objective_is_used(uuid) from public, anon, authenticated;

create function public.guard_learning_objective()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if public.learning_objective_is_used(old.id) then
      raise exception using errcode = '23503',
        message = 'Tujuan Pembelajaran tidak dapat dihapus karena sudah digunakan dalam aktivitas pembelajaran.';
    end if;
    return old;
  end if;

  -- A plan lock serializes additions and the reorder RPC; newly created TPs
  -- always append, including when there are gaps left by earlier deletions.
  perform 1 from public.curriculum_plans where id = new.curriculum_plan_id for update;
  if tg_op = 'INSERT' then
    select coalesce(max(sort_order), -1) + 1 into new.sort_order
    from public.learning_objectives where curriculum_plan_id = new.curriculum_plan_id;
    return new;
  end if;

  if new.id is distinct from old.id or new.curriculum_plan_id is distinct from old.curriculum_plan_id then
    raise exception using errcode = '23514', message = 'TP tidak dapat dipindahkan ke CP lain.';
  end if;
  if new.sort_order is distinct from old.sort_order then
    if public.learning_objective_is_used(old.id) or exists (
      select 1 from public.learning_objectives sibling
      where sibling.curriculum_plan_id = old.curriculum_plan_id and sibling.id <> old.id
        and sibling.sort_order between least(old.sort_order, new.sort_order) and greatest(old.sort_order, new.sort_order)
        and public.learning_objective_is_used(sibling.id)
    ) then
      raise exception using errcode = '23514',
        message = 'Urutan TP dikunci karena sudah digunakan dalam aktivitas pembelajaran.';
    end if;
  end if;
  return new;
end;
$$;
create trigger learning_objectives_guard
  before insert or update or delete on public.learning_objectives
  for each row execute function public.guard_learning_objective();
revoke all on function public.guard_learning_objective() from public, anon, authenticated;

create function public.guard_curriculum_plan()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if exists (
      select 1 from public.learning_objectives lo
      where lo.curriculum_plan_id = old.id and public.learning_objective_is_used(lo.id)
    ) then
      raise exception using errcode = '23503',
        message = 'CP tidak dapat dihapus karena masih memiliki Tujuan Pembelajaran yang digunakan dalam aktivitas pembelajaran.';
    end if;
    return old;
  end if;
  if new.id is distinct from old.id or new.class_id is distinct from old.class_id
     or new.subject_id is distinct from old.subject_id then
    raise exception using errcode = '23514', message = 'Kelas dan mata pelajaran CP tidak dapat dipindahkan.';
  end if;
  return new;
end;
$$;
create trigger curriculum_plans_guard before update or delete on public.curriculum_plans
  for each row execute function public.guard_curriculum_plan();
revoke all on function public.guard_curriculum_plan() from public, anon, authenticated;

-- Validate new/reassigned links and serialize first usage against reordering.
-- Existing unrelated activity fields and legacy unlinked rows are untouched.
create function public.guard_activity_objective()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  target_plan public.curriculum_plans;
begin
  if new.learning_objective_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.learning_objective_id is not distinct from old.learning_objective_id
     and new.class_id = old.class_id and new.subject_id = old.subject_id then
    return new;
  end if;
  select cp.* into target_plan from public.curriculum_plans cp
  join public.learning_objectives lo on lo.curriculum_plan_id = cp.id
  where lo.id = new.learning_objective_id for update of cp;
  if not found or target_plan.class_id <> new.class_id or target_plan.subject_id <> new.subject_id then
    raise exception using errcode = '23514', message = 'TP harus sesuai dengan kelas dan mata pelajaran aktivitas.';
  end if;
  return new;
end;
$$;
create trigger materials_guard_objective before insert or update on public.materials
  for each row execute function public.guard_activity_objective();
create trigger assignments_guard_objective before insert or update on public.assignments
  for each row execute function public.guard_activity_objective();
create trigger class_meetings_guard_objective before insert or update on public.class_meetings
  for each row execute function public.guard_activity_objective();
revoke all on function public.guard_activity_objective() from public, anon, authenticated;

-- Swap adjacent unused TPs in one statement/transaction. RLS remains in force.
create function public.move_learning_objective(p_id uuid, p_direction text)
returns void language plpgsql security invoker set search_path = ''
as $$
declare
  plan_id uuid;
  ordered_ids uuid[];
  current_index integer;
  target_id uuid;
  first_order integer;
  second_order integer;
begin
  if p_direction not in ('up', 'down') or p_direction is null then
    raise exception using errcode = '22023', message = 'Arah perpindahan TP tidak valid.';
  end if;
  select cp.id into plan_id from public.curriculum_plans cp
  join public.learning_objectives lo on lo.curriculum_plan_id = cp.id
  where lo.id = p_id and public.is_teacher() and exists (
    select 1 from public.class_teacher_subjects cts
    where cts.teacher_id = auth.uid() and cts.class_id = cp.class_id and cts.subject_id = cp.subject_id
  ) for update of cp;
  if not found then
    raise exception using errcode = '42501', message = 'Tidak diizinkan mengubah TP ini.';
  end if;
  select array_agg(id order by sort_order, id) into ordered_ids
  from public.learning_objectives where curriculum_plan_id = plan_id;
  current_index := array_position(ordered_ids, p_id);
  target_id := ordered_ids[current_index + case when p_direction = 'up' then -1 else 1 end];
  if target_id is null then return; end if;
  if exists (
    select 1 from public.learning_objective_usage(array[p_id, target_id]) u
    where u.materials + u.assignments + u.quizzes + u.meetings > 0
  ) then
    raise exception using errcode = '23514',
      message = 'Urutan TP dikunci karena sudah digunakan dalam aktivitas pembelajaran.';
  end if;
  select sort_order into first_order from public.learning_objectives where id = p_id;
  select sort_order into second_order from public.learning_objectives where id = target_id;
  if first_order = second_order then
    raise exception using errcode = '23514',
      message = 'Urutan TP lama memiliki nomor yang sama. Periksa urutan tersebut sebelum memindahkannya.';
  end if;
  update public.learning_objectives
  set sort_order = case when id = p_id then second_order else first_order end
  where id in (p_id, target_id);
end;
$$;
revoke all on function public.move_learning_objective(uuid, text) from public, anon;
grant execute on function public.move_learning_objective(uuid, text) to authenticated;
