-- Never trust user-editable metadata for role, school, class, or login identity.
-- Admin account creation supplies a trusted, creation-only profile snapshot in
-- app_metadata.lms_profile. Authorization after creation still uses profiles.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  initial_profile jsonb := new.raw_app_meta_data -> 'lms_profile';
begin
  if tg_op = 'UPDATE' then
    -- Consume the trusted snapshot only once. Subsequent Auth metadata changes
    -- must not undo profile edits, class promotion, or role changes by an admin.
    if old.raw_app_meta_data -> 'lms_profile' is not null
       or initial_profile is null then
      return new;
    end if;
  else
    -- A public signup, if enabled in Auth settings, gets no assigned school,
    -- class, username, NISN, NIP, or privileged role from its request metadata.
    insert into public.profiles (id, role, full_name, avatar_emoji)
    values (
      new.id,
      'student',
      coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), new.email, 'Pengguna'),
      new.raw_user_meta_data ->> 'avatar_emoji'
    );
  end if;

  if initial_profile is null then
    return new;
  end if;

  if jsonb_typeof(initial_profile) is distinct from 'object'
     or coalesce(initial_profile ->> 'role', '') not in ('student', 'teacher', 'principal', 'admin')
     or nullif(btrim(initial_profile ->> 'full_name'), '') is null
     or nullif(btrim(initial_profile ->> 'username'), '') is null then
    raise exception using
      errcode = '22023',
      message = 'Data awal profil dari admin tidak valid.';
  end if;

  update public.profiles
  set role = (initial_profile ->> 'role')::public.user_role,
      school_id = nullif(initial_profile ->> 'school_id', '')::uuid,
      class_id = nullif(initial_profile ->> 'class_id', '')::uuid,
      full_name = initial_profile ->> 'full_name',
      username = initial_profile ->> 'username',
      nisn = nullif(initial_profile ->> 'nisn', ''),
      nip = nullif(initial_profile ->> 'nip', ''),
      avatar_emoji = coalesce(initial_profile ->> 'avatar_emoji', avatar_emoji)
  where id = new.id;

  if not found then
    raise exception 'Profil pengguna tidak ditemukan saat pembuatan akun.';
  end if;

  return new;
end;
$$;

-- Supabase Auth's admin createUser inserts auth.users before applying custom
-- app_metadata, in the same transaction. Support both that UPDATE and direct
-- INSERTs with app_metadata (such as the local seed).
create trigger on_auth_user_profile_provisioned
  after update of raw_app_meta_data on auth.users
  for each row
  when ((old.raw_app_meta_data -> 'lms_profile') is null
    and (new.raw_app_meta_data -> 'lms_profile') is not null)
  execute function public.handle_new_user();

revoke all on function public.handle_new_user() from public, anon, authenticated;
