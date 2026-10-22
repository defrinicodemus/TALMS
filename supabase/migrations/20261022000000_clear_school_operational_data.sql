-- Reset all operational LMS data before entering real school data.
-- Preserved: school settings and every administrator account/profile.
-- Storage objects are intentionally excluded because physical files must be
-- removed through the Supabase Storage API, not by deleting Storage metadata.

begin;

delete from public.gradebook_locks;
delete from public.grades;

delete from public.quiz_answers;
delete from public.submissions;

delete from public.attendance_records;
delete from public.material_views;
delete from public.class_meetings;
delete from public.materials;
delete from public.assignments;

delete from public.learning_objectives;
delete from public.curriculum_plans;

delete from public.class_teacher_subjects;
delete from public.announcements;

delete from auth.users as target_user
where not exists (
  select 1
  from public.profiles as administrator
  where administrator.id = target_user.id
    and administrator.role = 'admin'
);

delete from public.classes;
delete from public.academic_years;
delete from public.subjects;

commit;
