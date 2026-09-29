-- RLS limits which profiles a user can update, but does not limit columns.
-- Keep self-service edits to the fields used by updateOwnProfile and
-- markAnnouncementsSeen. Everything else requires an administrator.
create function public.guard_profile_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Check the actual database role, never a client-supplied metadata field.
  -- SECURITY INVOKER is required: SECURITY DEFINER would make every caller
  -- appear to be the function owner and bypass this protection.
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;

  -- This helper reads the caller's existing profile, before this update.
  if public.is_admin() is true then
    return new;
  end if;

  -- An allowlist also protects new profile columns by default. updated_at
  -- is maintained separately by profiles_set_updated_at.
  if (to_jsonb(new) - array['avatar_emoji', 'last_seen_announcements_at', 'updated_at'])
     is distinct from
     (to_jsonb(old) - array['avatar_emoji', 'last_seen_announcements_at', 'updated_at']) then
    raise exception using
      errcode = '42501',
      message = 'Hanya admin yang dapat mengubah identitas, peran, kelas, atau sekolah pengguna.';
  end if;

  return new;
end;
$$;

create trigger profiles_guard_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();

revoke all on function public.guard_profile_update() from public, anon, authenticated;
