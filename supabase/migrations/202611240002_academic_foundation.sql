begin;
create sequence app_private.student_code_seq;
create sequence app_private.teacher_code_seq;
create table app_private.students (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('HV-'||lpad(nextval('app_private.student_code_seq')::text,7,'0')),
  full_name text not null check(length(btrim(full_name))>0), birth_date date, gender text,
  grade smallint not null check(grade between 6 and 12), school text, phone text, address text,
  admission_date date not null, status text not null default 'studying' check(status in ('studying','paused','left')), notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references app_private.app_users(id), updated_by uuid references app_private.app_users(id),
  version integer not null default 1
);
create index students_name_idx on app_private.students(lower(full_name));
create index students_phone_idx on app_private.students(phone);
create index students_grade_status_idx on app_private.students(grade,status);
create table app_private.guardians (
  id uuid primary key default gen_random_uuid(), full_name text not null check(length(btrim(full_name))>0),
  phone text not null, email text, address text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references app_private.app_users(id), updated_by uuid references app_private.app_users(id), version integer not null default 1
);
create table app_private.student_guardians (
  id uuid primary key default gen_random_uuid(), student_id uuid not null references app_private.students(id),
  guardian_id uuid not null references app_private.guardians(id), relationship text not null,
  is_primary boolean not null default false, unique(student_id,guardian_id)
);
create unique index primary_guardian_idx on app_private.student_guardians(student_id) where is_primary;
create index guardian_students_idx on app_private.student_guardians(guardian_id);
create table app_private.teachers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('GV-'||lpad(nextval('app_private.teacher_code_seq')::text,7,'0')),
  full_name text not null check(length(btrim(full_name))>0), birth_date date, phone text not null,
  email text, address text, started_on date not null,
  status text not null default 'active' check(status in ('active','inactive')), notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references app_private.app_users(id), updated_by uuid references app_private.app_users(id), version integer not null default 1
);
alter table app_private.app_users add column teacher_id uuid unique references app_private.teachers(id);
create table app_private.subjects (
  id uuid primary key default gen_random_uuid(), code text not null unique, name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references app_private.app_users(id), updated_by uuid references app_private.app_users(id), version integer not null default 1
);
create table app_private.teacher_subjects (
  id uuid primary key default gen_random_uuid(), teacher_id uuid not null references app_private.teachers(id),
  subject_id uuid not null references app_private.subjects(id), unique(teacher_id,subject_id)
);
create index teacher_subject_reverse_idx on app_private.teacher_subjects(subject_id);
create table app_private.rooms (
  id uuid primary key default gen_random_uuid(), code text not null unique, name text not null,
  capacity integer not null check(capacity>0), status text not null default 'active' check(status in ('active','inactive')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references app_private.app_users(id), updated_by uuid references app_private.app_users(id), version integer not null default 1
);
create table app_private.classes (
  id uuid primary key default gen_random_uuid(), code text not null unique, name text not null,
  grade smallint not null check(grade between 6 and 12), capacity integer not null check(capacity>0),
  start_date date not null, end_date date, default_room_id uuid references app_private.rooms(id),
  status text not null default 'planned' check(status in ('planned','active','closed')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references app_private.app_users(id), updated_by uuid references app_private.app_users(id), version integer not null default 1,
  check(end_date is null or end_date>=start_date)
);
create index class_room_idx on app_private.classes(default_room_id);
create table app_private.class_subjects (
  id uuid primary key default gen_random_uuid(), class_id uuid not null references app_private.classes(id),
  subject_id uuid not null references app_private.subjects(id),
  status text not null default 'active' check(status in ('active','closed')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references app_private.app_users(id), updated_by uuid references app_private.app_users(id), version integer not null default 1,
  unique(class_id,subject_id)
);
create index class_subject_reverse_idx on app_private.class_subjects(subject_id);
create table app_private.student_enrollments (
  id uuid primary key default gen_random_uuid(), student_id uuid not null references app_private.students(id),
  class_subject_id uuid not null references app_private.class_subjects(id), start_date date not null, end_date date,
  status text not null default 'active' check(status in ('active','paused','ended')),
  transferred_from_id uuid references app_private.student_enrollments(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references app_private.app_users(id), updated_by uuid references app_private.app_users(id), version integer not null default 1,
  check(end_date is null or end_date>start_date), check(status<>'ended' or end_date is not null)
);
create index enrollment_student_idx on app_private.student_enrollments(student_id,status);
create index enrollment_class_subject_idx on app_private.student_enrollments(class_subject_id,status);
create index enrollment_transfer_idx on app_private.student_enrollments(transferred_from_id);
-- Overlap exclusion, temporal terms, assignments and their RPCs arrive in stage 4.
-- All business writes stay inaccessible to application roles until then.
create table app_private.center_settings (
  id uuid primary key default gen_random_uuid(), singleton boolean not null default true unique check(singleton),
  name text not null, slogan text not null, timezone text not null default 'Asia/Ho_Chi_Minh',
  currency text not null default 'VND' check(currency='VND'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references app_private.app_users(id), updated_by uuid references app_private.app_users(id), version integer not null default 1
);

do $$ declare t text; begin
  foreach t in array array['students','guardians','teachers','subjects','rooms','classes','class_subjects','student_enrollments','center_settings'] loop
    execute format('create trigger %I before update on app_private.%I for each row execute function app_private.touch_version()',t||'_touch',t);
  end loop;
  foreach t in array array['students','guardians','student_guardians','teachers','subjects','teacher_subjects','rooms','classes','class_subjects','student_enrollments','center_settings'] loop
    execute format('alter table app_private.%I enable row level security',t);
    execute format('create trigger %I after insert or update or delete on app_private.%I for each row execute function app_private.capture_audit()',t||'_audit',t);
  end loop;
end $$;
revoke all on all tables in schema app_private from public,anon,authenticated,service_role;
revoke all on all sequences in schema app_private from public,anon,authenticated,service_role;
revoke all on all functions in schema app_private from public,anon,authenticated,service_role;
insert into app_private.schema_versions(version) values('202611240002');

-- Operator verification only. Never exposed to the anonymous frontend.
create function app_api.schema_status() returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('versions',jsonb_agg(version order by version)) from app_private.schema_versions;
$$;
revoke all on function app_api.schema_status() from public,anon,authenticated;
grant execute on function app_api.schema_status() to service_role;
commit;
