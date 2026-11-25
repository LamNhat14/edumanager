-- ONLY for a new empty EduManager project. Never run twice.
begin;
create schema if not exists app_private;
create schema if not exists app_api;
revoke all on schema app_private, app_api from public, anon, authenticated;
grant usage on schema app_api to service_role;
-- Default function execute grants are global; a per-schema revoke is insufficient.
alter default privileges revoke execute on functions from public;
alter default privileges in schema app_private revoke all on tables from public, anon, authenticated;
alter default privileges in schema app_private revoke all on sequences from public, anon, authenticated;
alter default privileges in schema app_api revoke all on tables from public, anon, authenticated;
alter default privileges in schema app_api revoke all on sequences from public, anon, authenticated;

create table app_private.schema_versions (
  id uuid primary key default gen_random_uuid(), version text not null unique,
  applied_at timestamptz not null default now()
);
create table app_private.app_users (
  id uuid primary key default gen_random_uuid(),
  username text not null check (username=lower(btrim(username)) and length(username) between 3 and 64),
  display_name text not null check(length(btrim(display_name))>0),
  password_hash text not null,
  status text not null default 'locked' check(status in ('active','locked')),
  must_change_password boolean not null default true,
  password_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references app_private.app_users(id), updated_by uuid references app_private.app_users(id),
  version integer not null default 1 check(version>0), unique(username)
);
create table app_private.roles (
  id uuid primary key default gen_random_uuid(), code text not null unique, name text not null
);
create table app_private.permissions (
  id uuid primary key default gen_random_uuid(), code text not null unique,
  resource text not null, action text not null
);
create table app_private.user_roles (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references app_private.app_users(id),
  role_id uuid not null references app_private.roles(id), unique(user_id,role_id)
);
create table app_private.role_permissions (
  id uuid primary key default gen_random_uuid(), role_id uuid not null references app_private.roles(id),
  permission_id uuid not null references app_private.permissions(id),
  scope text not null check(scope in ('own','assigned','all')), unique(role_id,permission_id)
);
create table app_private.app_sessions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references app_private.app_users(id),
  token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
  key_version integer not null check(key_version>0),
  created_at timestamptz not null default now(), expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(), revoked_at timestamptz,
  user_agent text, ip_hash text, check(expires_at>created_at)
);
create index sessions_user_idx on app_private.app_sessions(user_id);
create index sessions_expiry_idx on app_private.app_sessions(expires_at) where revoked_at is null;
create table app_private.audit_logs (
  id uuid primary key default gen_random_uuid(), actor_id uuid references app_private.app_users(id),
  action text not null, entity_type text not null, entity_id uuid,
  before_data jsonb, after_data jsonb, reason text,
  request_id uuid not null, occurred_at timestamptz not null default now()
);
create index audit_entity_idx on app_private.audit_logs(entity_type,entity_id,occurred_at);
create index audit_actor_idx on app_private.audit_logs(actor_id,occurred_at);
create table app_private.login_attempts (
  id uuid primary key default gen_random_uuid(), account_key_hash text not null, ip_hash text not null,
  occurred_at timestamptz not null default now(), outcome text not null check(outcome in ('success','failure','throttled'))
);
create index login_account_time_idx on app_private.login_attempts(account_key_hash,occurred_at);
create index login_ip_time_idx on app_private.login_attempts(ip_hash,occurred_at);
create table app_private.idempotency_requests (
  id uuid primary key default gen_random_uuid(), actor_id uuid not null references app_private.app_users(id),
  operation text not null, key text not null check(length(key) between 1 and 128), payload_hash text not null,
  result_ref uuid, response_code integer, created_at timestamptz not null default now(),
  unique(actor_id,operation,key)
);

create function app_private.touch_version() returns trigger language plpgsql set search_path='' as $$
begin new.updated_at=clock_timestamp(); new.version=old.version+1; return new; end;
$$;
create trigger app_users_touch before update on app_private.app_users for each row execute function app_private.touch_version();

-- Used only inside trusted, future RPC transactions after authorization.
-- Actor context is transaction-local, not accepted from browser database calls.
create function app_private.capture_audit() returns trigger
language plpgsql security definer set search_path='' as $$
declare old_row jsonb; new_row jsonb; actor uuid; request uuid;
begin
  actor=nullif(current_setting('app.actor_id',true),'')::uuid;
  request=nullif(current_setting('app.request_id',true),'')::uuid;
  if actor is null or request is null then raise exception 'Audit context required' using errcode='42501'; end if;
  if tg_op<>'INSERT' then old_row=to_jsonb(old)-array['password_hash','token_hash','ip_hash']; end if;
  if tg_op<>'DELETE' then new_row=to_jsonb(new)-array['password_hash','token_hash','ip_hash']; end if;
  insert into app_private.audit_logs(actor_id,action,entity_type,entity_id,before_data,after_data,reason,request_id)
  values(actor,tg_op,tg_table_name,coalesce(new_row->>'id',old_row->>'id')::uuid,old_row,new_row,
    nullif(current_setting('app.reason',true),''),request);
  if tg_op='DELETE' then return old; end if; return new;
end;
$$;
create function app_private.reject_audit_mutation() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Audit records are append-only' using errcode='42501'; end;
$$;
create trigger audit_immutable before update or delete or truncate on app_private.audit_logs
for each statement execute function app_private.reject_audit_mutation();

-- No users, sample records, or passwords are seeded.
insert into app_private.roles(code,name) values
('admin','Admin'),('manager','Quản lý'),('accountant','Kế toán'),('academic','Học vụ'),('teacher','Giáo viên');
insert into app_private.schema_versions(version) values('202611240001');

do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname='app_private' loop
    execute format('alter table app_private.%I enable row level security',t.tablename);
  end loop;
end $$;
revoke all on all tables in schema app_private from public,anon,authenticated,service_role;
revoke all on all sequences in schema app_private from public,anon,authenticated,service_role;
revoke all on all functions in schema app_private from public,anon,authenticated,service_role;
commit;

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

begin;
insert into app_private.permissions(code,resource,action) values
('users.manage','users','manage'),('audit.view','audit','view');
insert into app_private.role_permissions(role_id,permission_id,scope)
select r.id,p.id,'all' from app_private.roles r cross join app_private.permissions p where r.code='admin';

create function app_private.user_view(uid uuid) returns jsonb language sql stable set search_path='' as $$
select jsonb_build_object('id',u.id,'username',u.username,'display_name',u.display_name,'status',u.status,
 'must_change_password',u.must_change_password,'version',u.version,
 'roles',coalesce((select jsonb_agg(r.code order by r.code) from app_private.user_roles ur join app_private.roles r on r.id=ur.role_id where ur.user_id=u.id),'[]'::jsonb),
 'permissions',coalesce((select jsonb_agg(distinct p.code) from app_private.user_roles ur join app_private.role_permissions rp on rp.role_id=ur.role_id join app_private.permissions p on p.id=rp.permission_id where ur.user_id=u.id),'[]'::jsonb))
from app_private.app_users u where u.id=uid;
$$;

create function app_api.bootstrap_admin(p_username text,p_name text,p_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=gen_random_uuid(); begin
 perform pg_advisory_xact_lock(731903);
 if exists(select 1 from app_private.app_users) then raise exception 'BOOTSTRAP_CLOSED'; end if;
 if p_username !~ '^[a-z0-9_.-]{3,64}$' or length(btrim(p_name)) not between 1 and 120 or p_hash !~ '^\$2[ab]\$12\$[./A-Za-z0-9]{53}$' then raise exception 'INVALID_INPUT'; end if;
 insert into app_private.app_users(id,username,display_name,password_hash,status,must_change_password) values(uid,p_username,p_name,p_hash,'active',false);
 insert into app_private.user_roles(user_id,role_id) select uid,id from app_private.roles where code='admin';
 insert into app_private.audit_logs(actor_id,action,entity_type,entity_id,after_data,request_id) values(uid,'bootstrap','app_users',uid,app_private.user_view(uid),gen_random_uuid());
 return app_private.user_view(uid);
end $$;

-- Reservations count ALL attempts, including successful and unfinished attempts.
-- Account and trusted gateway IP limits persist across Edge instances.
create function app_api.login_begin(p_username text,p_account text,p_ip text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare attempt uuid; u app_private.app_users; begin
 perform pg_advisory_xact_lock(731904);
 if (select count(*) from app_private.login_attempts where account_key_hash=p_account and occurred_at>now()-interval '15 minutes')>=10
 or (select count(*) from app_private.login_attempts where ip_hash=p_ip and occurred_at>now()-interval '15 minutes')>=60 then
 return jsonb_build_object('limited',true); end if;
 insert into app_private.login_attempts(account_key_hash,ip_hash,outcome) values(p_account,p_ip,'failure') returning id into attempt;
 select * into u from app_private.app_users where username=p_username;
 return jsonb_build_object('attempt',attempt,'user_id',u.id,'password_hash',u.password_hash);
end $$;

create function app_api.login_finish(p_attempt uuid,p_uid uuid,p_expected_hash text,p_token_hash text,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u app_private.app_users; begin
 perform pg_advisory_xact_lock(731903);
 if not exists(select 1 from app_private.login_attempts where id=p_attempt and outcome='failure' and occurred_at>now()-interval '2 minutes' for update) then raise exception 'UNAUTHENTICATED'; end if;
 select * into u from app_private.app_users where id=p_uid for update;
 if u.id is null or u.status<>'active' or u.password_hash<>p_expected_hash then raise exception 'UNAUTHENTICATED'; end if;
 update app_private.login_attempts set outcome='success' where id=p_attempt;
 insert into app_private.app_sessions(user_id,token_hash,key_version,expires_at) values(u.id,p_token_hash,1,now()+interval '8 hours');
 insert into app_private.audit_logs(actor_id,action,entity_type,entity_id,request_id) values(u.id,'login','app_users',u.id,p_request);
 return jsonb_build_object('user',app_private.user_view(u.id),'expires_at',now()+interval '8 hours');
end $$;

create function app_api.auth_command(p_hash text,p_action text,p_data jsonb,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s app_private.app_sessions; u app_private.app_users; target app_private.app_users;
 uid uuid; role_code text; before_view jsonb; result jsonb; required_permission text;
begin
 -- Shared ordering with login/admin changes prevents revoke/change races.
 perform pg_advisory_xact_lock(731903);
 select * into s from app_private.app_sessions where token_hash=p_hash for update;
 if s.id is null or s.revoked_at is not null or s.expires_at<=now() or s.last_seen_at<=now()-interval '30 minutes' then raise exception 'UNAUTHENTICATED'; end if;
 select * into u from app_private.app_users where id=s.user_id for update;
 if u.status<>'active' then raise exception 'UNAUTHENTICATED'; end if;
 if u.must_change_password and p_action not in ('me','logout','password_material','change_password') then raise exception 'PASSWORD_CHANGE_REQUIRED'; end if;
 -- Passive /me polls do not prolong the idle expiry.
 if p_action<>'me' then update app_private.app_sessions set last_seen_at=now() where id=s.id; end if;
 if p_action='me' then return app_private.user_view(u.id); end if;
 if p_action='logout' then
  update app_private.app_sessions set revoked_at=now() where id=s.id;
 elsif p_action='password_material' then return jsonb_build_object('password_hash',u.password_hash);
 elsif p_action='change_password' then
  if u.password_hash<>p_data->>'expected_hash' then raise exception 'UNAUTHENTICATED'; end if;
  if p_data->>'password_hash' !~ '^\$2[ab]\$12\$[./A-Za-z0-9]{53}$' then raise exception 'INVALID_INPUT'; end if;
  update app_private.app_users set password_hash=p_data->>'password_hash',must_change_password=false,password_changed_at=now(),updated_by=u.id where id=u.id;
  update app_private.app_sessions set revoked_at=now() where user_id=u.id and revoked_at is null;
 else
  required_permission=case when p_action='audit' then 'audit.view' else 'users.manage' end;
  if not exists(select 1 from app_private.user_roles ur join app_private.role_permissions rp on rp.role_id=ur.role_id join app_private.permissions p on p.id=rp.permission_id where ur.user_id=u.id and p.code=required_permission and rp.scope='all') then raise exception 'FORBIDDEN'; end if;
  if p_action='list_users' then
   return (select coalesce(jsonb_agg(app_private.user_view(id) order by username),'[]'::jsonb) from (select id,username from app_private.app_users where username ilike '%'||left(coalesce(p_data->>'q',''),64)||'%' or display_name ilike '%'||left(coalesce(p_data->>'q',''),64)||'%' order by username limit 50 offset greatest(0,least(coalesce((p_data->>'offset')::integer,0),100000))) page);
  elsif p_action='roles' then return (select jsonb_agg(jsonb_build_object('code',code,'name',name) order by code) from app_private.roles);
  elsif p_action='audit' then return (select coalesce(jsonb_agg(to_jsonb(a) order by occurred_at desc,id),'[]'::jsonb) from (select l.*,coalesce(au.display_name,'Hệ thống') actor_name from app_private.audit_logs l left join app_private.app_users au on au.id=l.actor_id order by l.occurred_at desc,l.id limit 50 offset greatest(0,least(coalesce((p_data->>'offset')::integer,0),100000))) a);
  elsif p_action='create_user' then
   if p_data->>'username' !~ '^[a-z0-9_.-]{3,64}$' or length(btrim(p_data->>'display_name')) not between 1 and 120 or p_data->>'password_hash' !~ '^\$2[ab]\$12\$[./A-Za-z0-9]{53}$' then raise exception 'INVALID_INPUT'; end if;
   if jsonb_array_length(p_data->'roles')<1 then raise exception 'INVALID_INPUT'; end if;
   insert into app_private.app_users(username,display_name,password_hash,status,created_by,must_change_password)
   values(p_data->>'username',p_data->>'display_name',p_data->>'password_hash','active',u.id,true) returning id into uid;
  else
   uid=(p_data->>'id')::uuid;
   select * into target from app_private.app_users where id=uid for update;
   if target.id is null then raise exception 'NOT_FOUND'; end if;
   before_view=app_private.user_view(uid);
   if p_action in ('update_user','set_roles','reset_password') and target.version<>coalesce((p_data->>'version')::integer,-1) then raise exception 'CONFLICT'; end if;
   if p_action='update_user' then
    if p_data->>'status' not in ('active','locked') or length(btrim(p_data->>'display_name')) not between 1 and 120 then raise exception 'INVALID_INPUT'; end if;
    update app_private.app_users set display_name=p_data->>'display_name',status=p_data->>'status',updated_by=u.id where id=uid;
   elsif p_action='set_roles' then
    if jsonb_array_length(p_data->'roles')<1 then raise exception 'INVALID_INPUT'; end if;
    delete from app_private.user_roles where user_id=uid;
    update app_private.app_users set updated_by=u.id where id=uid;
   elsif p_action='reset_password' then
    if p_data->>'password_hash' !~ '^\$2[ab]\$12\$[./A-Za-z0-9]{53}$' then raise exception 'INVALID_INPUT'; end if;
    update app_private.app_users set password_hash=p_data->>'password_hash',must_change_password=true,password_changed_at=now(),updated_by=u.id where id=uid;
   elsif p_action<>'revoke_sessions' then raise exception 'NOT_FOUND'; end if;
   update app_private.app_sessions set revoked_at=now() where user_id=uid and revoked_at is null;
  end if;
  if p_action in ('create_user','set_roles') then
   for role_code in select distinct jsonb_array_elements_text(p_data->'roles') loop
    if not exists(select 1 from app_private.roles where code=role_code) then raise exception 'INVALID_ROLE'; end if;
    insert into app_private.user_roles(user_id,role_id) select uid,id from app_private.roles where code=role_code;
   end loop;
  end if;
  if not exists(select 1 from app_private.app_users a join app_private.user_roles ur on ur.user_id=a.id join app_private.roles r on r.id=ur.role_id where a.status='active' and r.code='admin') then raise exception 'LAST_ADMIN'; end if;
  result=app_private.user_view(uid);
 end if;
 insert into app_private.audit_logs(actor_id,action,entity_type,entity_id,before_data,after_data,reason,request_id)
 values(u.id,p_action,'app_users',coalesce(uid,u.id),before_view,result,nullif(p_data->>'reason',''),p_request);
 return coalesce(result,'{"ok":true}'::jsonb);
end $$;

revoke all on function app_private.user_view(uuid) from public,anon,authenticated,service_role;
revoke all on all functions in schema app_api from public,anon,authenticated;
grant execute on function app_api.bootstrap_admin(text,text,text),app_api.login_begin(text,text,text),app_api.login_finish(uuid,uuid,text,text,uuid),app_api.auth_command(text,text,jsonb,uuid) to service_role;
insert into app_private.schema_versions(version) values('202611240003');
commit;


begin;
insert into app_private.permissions(code,resource,action) values
('academic.view','academic','view'),('academic.write','academic','write'),('academic.export','academic','export'),
('schedule.view','schedule','view'),('schedule.write','schedule','write'),('schedule.approve','schedule','approve'),('schedule.own','schedule','own'),
('billing.view','billing','view'),('billing.write','billing','write'),('billing.configure','billing','configure'),('billing.approve','billing','approve'),('billing.export','billing','export'),
('payroll.view','payroll','view'),('payroll.write','payroll','write'),('payroll.configure','payroll','configure'),('payroll.approve','payroll','approve'),('payroll.own','payroll','own'),('payroll.export','payroll','export'),
('finance.view','finance','view'),('finance.write','finance','write'),('finance.approve','finance','approve'),('finance.export','finance','export'),('settings.manage','settings','manage');
insert into app_private.role_permissions(role_id,permission_id,scope)
select r.id,p.id,'all' from app_private.roles r cross join app_private.permissions p
where r.code='admin' and not exists(select 1 from app_private.role_permissions rp where rp.role_id=r.id and rp.permission_id=p.id);
insert into app_private.role_permissions(role_id,permission_id,scope)
select r.id,p.id,case when p.code like '%.own' then 'own' else 'all' end
from app_private.roles r cross join app_private.permissions p where
(r.code='manager' and p.code not in ('users.manage','settings.manage','audit.view','schedule.own','payroll.own')) or
(r.code='academic' and p.code in ('academic.view','academic.write','academic.export','schedule.view','schedule.write')) or
(r.code='accountant' and p.code in ('academic.view','billing.view','billing.write','billing.export','payroll.view','payroll.write','payroll.export','finance.view','finance.write','finance.export')) or
(r.code='teacher' and p.code in ('schedule.own','payroll.own'));

create function app_private.require_actor(p_hash text,p_permission text,p_request uuid) returns uuid
language plpgsql set search_path='' as $$
declare u jsonb; begin
 u=app_api.auth_command(p_hash,'me','{}',p_request);
 if (u->>'must_change_password')::boolean then raise exception 'PASSWORD_CHANGE_REQUIRED'; end if;
 if not (u->'permissions' ? p_permission) then raise exception 'FORBIDDEN'; end if;
 update app_private.app_sessions set last_seen_at=now() where token_hash=p_hash;
 perform set_config('app.actor_id',u->>'id',true);
 perform set_config('app.request_id',p_request::text,true);
 return (u->>'id')::uuid;
end $$;

alter table app_private.students add column guardian_name text;
alter table app_private.students add column guardian_phone text;
create table app_private.enrollment_status_history (
 id uuid primary key default gen_random_uuid(), enrollment_id uuid not null references app_private.student_enrollments(id),
 status text not null, effective_on date not null, reason text not null, created_at timestamptz not null default now(), created_by uuid not null references app_private.app_users(id)
);
create table app_private.student_status_history (
 id uuid primary key default gen_random_uuid(),student_id uuid not null references app_private.students(id),status text not null,
 effective_on date not null,reason text not null,created_at timestamptz not null default now(),created_by uuid not null references app_private.app_users(id)
);
create function app_private.enrollment_guard() returns trigger language plpgsql set search_path='' as $$
declare cls app_private.classes; begin
 perform pg_advisory_xact_lock(731905);
 if tg_op='UPDATE' and (new.student_id<>old.student_id or new.class_subject_id<>old.class_subject_id or new.start_date<>old.start_date) then raise exception 'IMMUTABLE_ENROLLMENT'; end if;
 if exists(select 1 from app_private.student_enrollments e where e.id<>new.id and e.student_id=new.student_id and e.class_subject_id=new.class_subject_id and daterange(e.start_date,e.end_date,'[)') && daterange(new.start_date,new.end_date,'[)')) then raise exception 'ENROLLMENT_OVERLAP'; end if;
 select c.* into cls from app_private.classes c join app_private.class_subjects cs on cs.class_id=c.id where cs.id=new.class_subject_id;
 if new.start_date<cls.start_date or (cls.end_date is not null and new.start_date>cls.end_date) then raise exception 'OUTSIDE_CLASS_DATES'; end if;
 return new;
end $$;
create trigger enrollment_guard before insert or update on app_private.student_enrollments for each row execute function app_private.enrollment_guard();

-- All names/columns come from this fixed registry, never client SQL fragments.
create function app_private.resource_columns(resource text) returns text[] language sql immutable set search_path='' as $$
select case resource
when 'students' then array['full_name','birth_date','gender','grade','school','phone','address','admission_date','status','notes','guardian_name','guardian_phone']
when 'teachers' then array['full_name','birth_date','phone','email','address','started_on','status','notes']
when 'classes' then array['code','name','grade','capacity','start_date','end_date','default_room_id','status']
when 'subjects' then array['code','name','active']
when 'rooms' then array['code','name','capacity','status']
when 'class_subjects' then array['class_id','subject_id','status']
when 'student_enrollments' then array['student_id','class_subject_id','start_date','end_date','status']
when 'center_settings' then array['name','slogan','timezone','currency']
end;
$$;

create function app_private.save_resource(p_resource text,p_data jsonb,p_id uuid,p_version integer,p_actor uuid,p_reason text) returns jsonb
language plpgsql set search_path='' as $$
declare allowed text[];field text;cols text:='';vals text:='';sets text:='';typ text;result jsonb;oldrow jsonb;
begin
 allowed=app_private.resource_columns(p_resource);
 if allowed is null or jsonb_typeof(p_data)<>'object' then raise exception 'INVALID_INPUT'; end if;
 if p_id is not null and nullif(btrim(p_reason),'') is null then raise exception 'REASON_REQUIRED'; end if;
 perform set_config('app.reason',coalesce(p_reason,''),true);
 for field in select jsonb_object_keys(p_data) loop
  if not field=any(allowed) then raise exception 'INVALID_FIELD'; end if;
  select format_type(a.atttypid,a.atttypmod) into typ from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='app_private' and c.relname=p_resource and a.attname=field and a.attnum>0;
  cols=cols||format('%I,',field); vals=vals||format('($1->>%L)::%s,',field,typ);sets=sets||format('%I=($1->>%L)::%s,',field,field,typ);
 end loop;
 if cols='' then raise exception 'INVALID_INPUT'; end if;
 if p_id is null then
  execute format('insert into app_private.%I(%screated_by,updated_by) select %s$2,$2 returning to_jsonb(%I.*)',p_resource,cols,vals,p_resource) into result using p_data,p_actor;
 else
  execute format('select to_jsonb(t) from app_private.%I t where id=$1 for update',p_resource) into oldrow using p_id;
  if oldrow is null then raise exception 'NOT_FOUND'; end if;
  if p_resource='class_subjects' and ((p_data ? 'class_id' and p_data->>'class_id'<>oldrow->>'class_id') or (p_data ? 'subject_id' and p_data->>'subject_id'<>oldrow->>'subject_id')) then raise exception 'IMMUTABLE_ENROLLMENT';end if;
  execute format('update app_private.%I set %s updated_by=$2 where id=$3 and version=$4 returning to_jsonb(%I.*)',p_resource,sets,p_resource) into result using p_data,p_actor,p_id,p_version;
  if result is null then raise exception 'CONFLICT'; end if;
 end if;
 if p_resource='student_enrollments' and (oldrow is null or oldrow->>'status'<>result->>'status') then
  insert into app_private.enrollment_status_history(enrollment_id,status,effective_on,reason,created_by) values((result->>'id')::uuid,result->>'status',case when oldrow is null then (result->>'start_date')::date else current_date end,coalesce(p_reason,'Đăng ký mới'),p_actor);
 elsif p_resource='students' and (oldrow is null or oldrow->>'status'<>result->>'status') then
  insert into app_private.student_status_history(student_id,status,effective_on,reason,created_by) values((result->>'id')::uuid,result->>'status',case when oldrow is null then (result->>'admission_date')::date else current_date end,coalesce(p_reason,'Hồ sơ mới'),p_actor);
 end if;
 return result;
end $$;

create function app_api.academic(p_hash text,p_action text,p_data jsonb,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid;resource text:=p_data->>'resource';result jsonb;old_enrollment app_private.student_enrollments;warning text;
begin
 actor=app_private.require_actor(p_hash,case when resource='center_settings' then 'settings.manage' when p_action='export' then 'academic.export' when p_action='list' then 'academic.view' else 'academic.write' end,p_request);
 if app_private.resource_columns(resource) is null then raise exception 'NOT_FOUND'; end if;
 if p_action in ('list','export') then
  execute format('select coalesce(jsonb_agg(rowdata),''[]''::jsonb) from (select to_jsonb(t) rowdata from app_private.%I t where ($1='''' or to_jsonb(t)::text ilike ''%%''||$1||''%%'') and ($2='''' or to_jsonb(t)->>''status''=$2) order by created_at desc,id limit $3 offset $4) rows',resource)
  into result using left(coalesce(p_data->>'q',''),100),coalesce(p_data->>'status',''),case when p_action='export' then 10000 else 100 end,greatest(0,least(coalesce((p_data->>'offset')::integer,0),100000));
  if not (app_private.user_view(actor)->'permissions' ? 'academic.write') and resource in ('students','teachers') then
   select coalesce(jsonb_agg(x - array['birth_date','address','notes','guardian_name','guardian_phone','phone','email','school','gender']),'[]') into result from jsonb_array_elements(result) x;
  end if;
  return result;
 elsif p_action='save' then
  result=app_private.save_resource(resource,p_data->'values',nullif(p_data->>'id','')::uuid,(p_data->>'version')::integer,actor,p_data->>'reason');
  if resource='student_enrollments' then
   if (select count(*) from app_private.student_enrollments e where e.class_subject_id=(result->>'class_subject_id')::uuid and e.status='active' and e.end_date is null) > (select c.capacity from app_private.classes c join app_private.class_subjects cs on cs.class_id=c.id where cs.id=(result->>'class_subject_id')::uuid) then warning='Sĩ số môn vượt mức tối đa của lớp.';end if;
  end if;
  return jsonb_build_object('record',result,'warning',warning);
 elsif p_action='transfer' and resource='student_enrollments' then
  select * into old_enrollment from app_private.student_enrollments where id=(p_data->>'id')::uuid for update;
  if old_enrollment.id is null then raise exception 'NOT_FOUND';end if;
  perform app_private.save_resource(resource,jsonb_build_object('end_date',p_data->>'date','status','ended'),old_enrollment.id,old_enrollment.version,actor,p_data->>'reason');
  result=app_private.save_resource(resource,jsonb_build_object('student_id',old_enrollment.student_id,'class_subject_id',p_data->>'class_subject_id','start_date',p_data->>'date','status','active'),null,null,actor,p_data->>'reason');
  update app_private.student_enrollments set transferred_from_id=old_enrollment.id where id=(result->>'id')::uuid;
  return result;
 elsif p_action='import' and resource='students' then
  if jsonb_typeof(p_data->'rows') is distinct from 'array' or jsonb_array_length(p_data->'rows') not between 1 and 500 then raise exception 'IMPORT_LIMIT';end if;
  for result in select * from jsonb_array_elements(p_data->'rows') loop
   if exists(select 1 from app_private.students s where lower(btrim(s.full_name))=lower(btrim(result->>'full_name')) and s.birth_date is not distinct from nullif(result->>'birth_date','')::date and s.grade=(result->>'grade')::integer) then raise exception 'DUPLICATE_STUDENT';end if;
   perform app_private.save_resource(resource,result,null,null,actor,'Nhập Excel đã xác nhận');
  end loop;
  return jsonb_build_object('imported',jsonb_array_length(p_data->'rows'));
 end if;
 raise exception 'NOT_FOUND';
end $$;

alter table app_private.enrollment_status_history enable row level security;
alter table app_private.student_status_history enable row level security;
revoke all on all functions in schema app_private from public,anon,authenticated,service_role;
revoke all on all tables in schema app_private from public,anon,authenticated,service_role;
revoke all on function app_api.academic(text,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function app_api.academic(text,text,jsonb,uuid) to service_role;
insert into app_private.schema_versions(version) values('202611240004');
commit;

begin;
-- Monetary values are integral VND. Policies and posted ledger entries are append-only.
create table app_private.fee_policies(id uuid primary key default gen_random_uuid(),class_subject_id uuid not null references app_private.class_subjects(id),effective_on date not null,amount numeric(16,0) not null check(amount>=0),reason text not null check(length(btrim(reason))>0),created_at timestamptz not null default now(),unique(class_subject_id,effective_on));
create table app_private.assignments(id uuid primary key default gen_random_uuid(),class_subject_id uuid not null references app_private.class_subjects(id),teacher_id uuid not null references app_private.teachers(id),start_date date not null,end_date date,percent numeric(7,4) not null default 0 check(percent between 0 and 100),per_session numeric(16,0) not null default 0 check(per_session>=0),per_hour numeric(16,0) not null default 0 check(per_hour>=0),fixed_month numeric(16,0) not null default 0 check(fixed_month>=0),reason text not null,created_at timestamptz not null default now(),check(end_date is null or end_date>start_date));
create table app_private.sessions(id uuid primary key default gen_random_uuid(),assignment_id uuid not null references app_private.assignments(id),room_id uuid not null references app_private.rooms(id),starts_at timestamptz not null,ends_at timestamptz not null,status text not null default 'planned' check(status in ('planned','confirmed','approved','rejected','cancelled')),note text not null default '',makeup_for uuid references app_private.sessions(id),pay_month date,created_at timestamptz not null default now(),version integer not null default 1,check(ends_at>starts_at and ends_at<=starts_at+interval '12 hours'));
create index sessions_time on app_private.sessions(starts_at,ends_at);
create table app_private.combos(id uuid primary key default gen_random_uuid(),name text not null,kind text not null check(kind in ('fixed','percent')),value numeric(16,2) not null check(value>0),cap numeric(16,0) check(cap>0),starts_on date not null,ends_on date not null,subject_ids uuid[] not null check(cardinality(subject_ids)=3),created_at timestamptz not null default now(),check(ends_on>=starts_on),check(kind<>'percent' or value<=100));
create table app_private.invoices(id uuid primary key default gen_random_uuid(),student_id uuid not null references app_private.students(id),month date not null check(extract(day from month)=1),combo_snapshot jsonb,reason text,created_at timestamptz not null default now(),unique(student_id,month));
create table app_private.invoice_lines(id uuid primary key default gen_random_uuid(),invoice_id uuid not null references app_private.invoices(id),enrollment_id uuid not null references app_private.student_enrollments(id),month date not null,fee_policy_id uuid not null references app_private.fee_policies(id),assignment_id uuid not null references app_private.assignments(id),label text not null,gross numeric(16,0) not null check(gross>=0),discount numeric(16,0) not null default 0 check(discount>=0 and discount<=gross),snapshot jsonb not null,created_at timestamptz not null default now(),unique(enrollment_id,month));
create table app_private.payments(id uuid primary key default gen_random_uuid(),student_id uuid not null references app_private.students(id),amount numeric(16,0) not null check(amount>0),paid_on date not null,method text not null check(method in ('cash','bank')),reference text not null default '',created_at timestamptz not null default now());
create table app_private.refunds(id uuid primary key default gen_random_uuid(),payment_id uuid not null references app_private.payments(id),amount numeric(16,0) not null check(amount>0),reason text not null check(length(btrim(reason))>0),status text not null default 'requested' check(status in ('requested','approved','rejected','executed')),requested_by uuid not null references app_private.app_users(id),approved_by uuid references app_private.app_users(id),executed_on date,created_at timestamptz not null default now());
create table app_private.allocations(id uuid primary key default gen_random_uuid(),payment_id uuid not null references app_private.payments(id),line_id uuid not null references app_private.invoice_lines(id),amount numeric(16,0) not null check(amount<>0),book_month date not null,refund_id uuid references app_private.refunds(id),reverses_id uuid references app_private.allocations(id),created_at timestamptz not null default now(),check((amount>0 and refund_id is null and reverses_id is null) or (amount<0 and refund_id is not null and reverses_id is not null)));
create index allocations_line on app_private.allocations(line_id);
create index allocations_payment on app_private.allocations(payment_id);
create table app_private.payroll_adjustments(id uuid primary key default gen_random_uuid(),teacher_id uuid not null references app_private.teachers(id),month date not null,amount numeric(16,0) not null check(amount<>0),reason text not null check(length(btrim(reason))>0),created_at timestamptz not null default now());
create table app_private.payroll_batches(id uuid primary key default gen_random_uuid(),month date not null unique check(extract(day from month)=1),closed_by uuid not null references app_private.app_users(id),created_at timestamptz not null default now());
create table app_private.payroll_lines(id uuid primary key default gen_random_uuid(),batch_id uuid not null references app_private.payroll_batches(id),teacher_id uuid not null references app_private.teachers(id),amount numeric(16,0) not null,snapshot jsonb not null,created_at timestamptz not null default now(),unique(batch_id,teacher_id));
create table app_private.payroll_payments(id uuid primary key default gen_random_uuid(),payroll_line_id uuid not null references app_private.payroll_lines(id),amount numeric(16,0) not null check(amount>0),paid_on date not null,reference text not null,created_at timestamptz not null default now());
create table app_private.cash_entries(id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('income','expense')),amount numeric(16,0) not null check(amount>0),paid_on date not null,category text not null,description text not null,created_at timestamptz not null default now());
create table app_private.operation_receipts(id uuid primary key default gen_random_uuid(),actor_id uuid not null references app_private.app_users(id),key uuid not null,payload jsonb not null,result jsonb not null,created_at timestamptz not null default now(),unique(actor_id,key));

create function app_private.immutable_ledger() returns trigger language plpgsql set search_path='' as $$ begin raise exception 'IMMUTABLE_LEDGER';end $$;
do $$ declare t text;begin
 foreach t in array array['fee_policies','combos','invoices','invoice_lines','payments','allocations','payroll_adjustments','payroll_batches','payroll_lines','payroll_payments','cash_entries','operation_receipts'] loop
  execute format('create trigger immutable before update or delete on app_private.%I for each row execute function app_private.immutable_ledger()',t);
 end loop;
 foreach t in array array['fee_policies','assignments','sessions','combos','invoices','invoice_lines','payments','refunds','allocations','payroll_adjustments','payroll_batches','payroll_lines','payroll_payments','cash_entries'] loop
  execute format('create trigger audit after insert or update or delete on app_private.%I for each row execute function app_private.capture_audit()',t);
 end loop;
end $$;
create function app_private.assignment_guard() returns trigger language plpgsql set search_path='' as $$ begin
 if tg_op='DELETE' then raise exception 'IMMUTABLE_LEDGER';end if;
 if (to_jsonb(new)-'end_date')<>(to_jsonb(old)-'end_date') or new.end_date is null or (old.end_date is not null and new.end_date>old.end_date) then raise exception 'IMMUTABLE_LEDGER';end if;
 if exists(select 1 from app_private.sessions where assignment_id=old.id and status<>'cancelled' and (starts_at at time zone 'Asia/Ho_Chi_Minh')::date>=new.end_date) or exists(select 1 from app_private.invoice_lines where assignment_id=old.id and month>=new.end_date) then raise exception 'ASSIGNMENT_IN_USE';end if;
 return new;end $$;
create trigger assignment_guard before update or delete on app_private.assignments for each row execute function app_private.assignment_guard();
create function app_private.open_month(p_month date) returns date language plpgsql set search_path='' as $$
declare m date:=date_trunc('month',p_month)::date;begin
 while exists(select 1 from app_private.payroll_batches where month=m) loop m=(m+interval '1 month')::date;end loop;return m;
end $$;
create function app_private.session_guard() returns trigger language plpgsql set search_path='' as $$
declare a app_private.assignments; b app_private.classes; local_day date;begin
 perform pg_advisory_xact_lock(731906);
 select * into a from app_private.assignments where id=new.assignment_id;
 select c.* into b from app_private.classes c join app_private.class_subjects cs on cs.class_id=c.id where cs.id=a.class_subject_id;
 local_day=(new.starts_at at time zone 'Asia/Ho_Chi_Minh')::date;
 if local_day<a.start_date or (a.end_date is not null and local_day>=a.end_date) or local_day<b.start_date or (b.end_date is not null and local_day>b.end_date) then raise exception 'OUTSIDE_CLASS_DATES';end if;
 if new.status<>'cancelled' and exists(select 1 from app_private.sessions s join app_private.assignments x on x.id=s.assignment_id where s.id<>new.id and s.status<>'cancelled' and tstzrange(s.starts_at,s.ends_at,'[)') && tstzrange(new.starts_at,new.ends_at,'[)') and (s.room_id=new.room_id or x.teacher_id=a.teacher_id or x.class_subject_id=a.class_subject_id)) then raise exception 'SCHEDULE_CONFLICT';end if;
 if tg_op='UPDATE' then new.version=old.version+1;end if;return new;
end $$;
create trigger session_guard before insert or update on app_private.sessions for each row execute function app_private.session_guard();

create function app_private.allocate_credit(p_student uuid) returns void language plpgsql set search_path='' as $$
declare p record;l record;available numeric;due numeric;take numeric;begin
 for p in select * from app_private.payments where student_id=p_student order by paid_on,created_at,id loop
  select p.amount-coalesce((select sum(amount) from app_private.refunds where payment_id=p.id and status='executed'),0)-coalesce((select sum(amount) from app_private.allocations where payment_id=p.id),0) into available;
  for l in select il.* from app_private.invoice_lines il join app_private.invoices i on i.id=il.invoice_id where i.student_id=p_student order by i.month,il.id loop
   -- Negative allocations cancel both paid amount and corresponding tuition obligation.
   select l.gross-l.discount-coalesce(sum(case when amount>0 then amount else 0 end),0) into due from app_private.allocations where line_id=l.id;
   take=least(available,due);
   if take>0 then insert into app_private.allocations(payment_id,line_id,amount,book_month) values(p.id,l.id,take,app_private.open_month(greatest(p.paid_on,l.month,(now() at time zone 'Asia/Ho_Chi_Minh')::date)));available=available-take;end if;
   exit when available<=0;
  end loop;
 end loop;
end $$;

create function app_private.payroll_preview(p_month date,p_teacher uuid default null) returns jsonb language sql set search_path='' as $$
with revenue as (select a.teacher_id,round(sum(x.amount*a.percent/100)) amount,jsonb_agg(jsonb_build_object('allocation',x.id,'line',x.line_id,'amount',x.amount,'percent',a.percent,'assignment',a.id)) details from app_private.allocations x join app_private.invoice_lines il on il.id=x.line_id join app_private.assignments a on a.id=il.assignment_id where x.book_month=p_month group by a.teacher_id),
teaching as (select a.teacher_id,round(sum(a.per_session+a.per_hour*extract(epoch from (s.ends_at-s.starts_at))/3600)) amount,jsonb_agg(jsonb_build_object('session',s.id,'assignment',a.id,'per_session',a.per_session,'per_hour',a.per_hour,'hours',extract(epoch from (s.ends_at-s.starts_at))/3600)) details from app_private.sessions s join app_private.assignments a on a.id=s.assignment_id where s.status='approved' and s.pay_month=p_month group by a.teacher_id),
fixed as (select teacher_id,sum(fixed_month) amount,jsonb_agg(jsonb_build_object('assignment',id,'amount',fixed_month)) details from app_private.assignments where start_date<=p_month and (end_date is null or end_date>p_month) group by teacher_id),
adjustment as (select teacher_id,sum(amount) amount,jsonb_agg(jsonb_build_object('id',id,'amount',amount,'reason',reason)) details from app_private.payroll_adjustments where month=p_month group by teacher_id)
select coalesce(jsonb_agg(jsonb_build_object('teacher_id',t.id,'teacher',t.full_name,'revenue',coalesce(r.amount,0),'teaching',coalesce(s.amount,0),'fixed',coalesce(f.amount,0),'adjustment',coalesce(a.amount,0),'amount',coalesce(r.amount,0)+coalesce(s.amount,0)+coalesce(f.amount,0)+coalesce(a.amount,0),'allocations',r.details,'sessions',s.details,'fixed_details',f.details,'adjustments',a.details)),'[]') from app_private.teachers t left join revenue r on r.teacher_id=t.id left join teaching s on s.teacher_id=t.id left join fixed f on f.teacher_id=t.id left join adjustment a on a.teacher_id=t.id where (p_teacher is null or t.id=p_teacher) and (r.teacher_id is not null or s.teacher_id is not null or f.teacher_id is not null or a.teacher_id is not null);
$$;

create function app_api.operations(p_hash text,p_action text,p_data jsonb,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;u jsonb;perm text;result jsonb;v jsonb;rowdata jsonb;res text:=p_data->>'resource';ident uuid;own_teacher uuid;monthdate date;d date;en record;pol record;ass record;ses app_private.sessions;pay app_private.payments;refund app_private.refunds;allocation record;total numeric;discount_total numeric;remaining numeric;take numeric;gross numeric;cnt integer;combo app_private.combos;keyid uuid;receipt app_private.operation_receipts;inv uuid;line uuid;
begin
 u=app_api.auth_command(p_hash,'me','{}',p_request);
 perm=case
 when p_action='list' then case when res='assignments' and u->'permissions' ? 'payroll.view' then 'payroll.view' when res in ('fee_policies','combos','invoices','invoice_lines','payments','allocations','refunds','balances') then 'billing.view' when res in ('payroll_batches','payroll_lines','payroll_payments','payroll_adjustments') then 'payroll.view' when res='cash_entries' then 'finance.view' else 'schedule.view' end
 when p_action in ('session_create','session_status') then 'schedule.write'
 when p_action='session_approve' then 'schedule.approve'
 when p_action in ('fee_create','combo_create') then 'billing.configure'
 when p_action in ('assignment_create','assignment_end') then 'payroll.configure'
 when p_action in ('invoice_create','payment_create','refund_request') then 'billing.write'
 when p_action in ('refund_approve','refund_execute') then 'billing.approve'
 when p_action='payroll_preview' then 'payroll.view'
 when p_action in ('payroll_close','adjustment_create') then 'payroll.approve'
 when p_action='payroll_pay' then 'payroll.write'
 when p_action='cash_create' then 'finance.write'
 when p_action='report' then 'finance.view'
 when p_action='teacher_link' then 'users.manage'
 when p_action='catalog' then case when u->'permissions' ? 'academic.view' then 'academic.view' when u->'permissions' ? 'schedule.own' then 'schedule.own' else 'schedule.view' end
 else null end;
 if perm is null then raise exception 'NOT_FOUND';end if;
 if not (u->'permissions' ? perm) then
  if ((p_action='list' and res in ('sessions','assignments')) or p_action='session_status') and u->'permissions' ? 'schedule.own' then perm='schedule.own';
  elsif ((p_action='list' and res in ('payroll_lines','payroll_payments')) or p_action='payroll_preview') and u->'permissions' ? 'payroll.own' then perm='payroll.own';
  else raise exception 'FORBIDDEN';end if;
 end if;
 actor=app_private.require_actor(p_hash,perm,p_request);
 if perm like '%.own' then select teacher_id into own_teacher from app_private.app_users where id=actor;if own_teacher is null then raise exception 'TEACHER_NOT_LINKED';end if;end if;
 perform pg_advisory_xact_lock(731906);
 perform set_config('app.reason',coalesce(p_data->>'reason',''),true);
 if p_action not in ('list','report','payroll_preview','catalog') then
  keyid=(p_data->>'key')::uuid;if keyid is null then raise exception 'IDEMPOTENCY_REQUIRED';end if;
  select * into receipt from app_private.operation_receipts where actor_id=actor and key=keyid;
  if receipt.id is not null then if receipt.payload<>jsonb_build_object('action',p_action,'data',p_data) then raise exception 'IDEMPOTENCY_CONFLICT';end if;return receipt.result;end if;
 end if;
 if p_action='catalog' then
  return jsonb_build_object(
   'classes',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'code',c.code,'name',c.name)) from app_private.classes c where own_teacher is null or exists(select 1 from app_private.class_subjects cs join app_private.assignments a on a.class_subject_id=cs.id where cs.class_id=c.id and a.teacher_id=own_teacher)),'[]'),
   'class_subjects',coalesce((select jsonb_agg(jsonb_build_object('id',cs.id,'class_id',cs.class_id,'subject_id',cs.subject_id)) from app_private.class_subjects cs where own_teacher is null or exists(select 1 from app_private.assignments a where a.class_subject_id=cs.id and a.teacher_id=own_teacher)),'[]'),
   'subjects',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'code',s.code)) from app_private.subjects s where own_teacher is null or exists(select 1 from app_private.class_subjects cs join app_private.assignments a on a.class_subject_id=cs.id where cs.subject_id=s.id and a.teacher_id=own_teacher)),'[]'),
   'rooms',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'code',r.code)) from app_private.rooms r where own_teacher is null or exists(select 1 from app_private.sessions ss join app_private.assignments a on a.id=ss.assignment_id where ss.room_id=r.id and a.teacher_id=own_teacher)),'[]'),
   'teachers',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'full_name',t.full_name,'code',t.code)) from app_private.teachers t where own_teacher is null or t.id=own_teacher),'[]'));
 end if;
 if p_action not in ('list','report','payroll_preview') then
  for rowdata in select jsonb_build_object('key',k,'value',p_data->>k) from unnest(array['amount','per_session','per_hour','fixed_month','cap']) k where nullif(p_data->>k,'') is not null loop
   if (rowdata->>'value')::numeric<>trunc((rowdata->>'value')::numeric) or abs((rowdata->>'value')::numeric)>999999999999 then raise exception 'INVALID_INPUT';end if;
  end loop;
  if p_data->>'paid_on' is not null and (p_data->>'paid_on')::date>(now() at time zone 'Asia/Ho_Chi_Minh')::date then raise exception 'INVALID_INPUT';end if;
 end if;
 if p_action='list' then
  if res='balances' then
   select coalesce(jsonb_agg(to_jsonb(z)),'[]') into result from (
    select s.id,s.code,s.full_name,
    coalesce((select sum(il.gross-il.discount) from app_private.invoice_lines il join app_private.invoices i on i.id=il.invoice_id where i.student_id=s.id),0)-coalesce((select sum(a.amount) from app_private.allocations a join app_private.payments p on p.id=a.payment_id where p.student_id=s.id and a.amount>0),0) debt,
    coalesce((select sum(p.amount) from app_private.payments p where p.student_id=s.id),0)-coalesce((select sum(r.amount) from app_private.refunds r join app_private.payments p on p.id=r.payment_id where p.student_id=s.id and r.status='executed'),0)-coalesce((select sum(a.amount) from app_private.allocations a join app_private.payments p on p.id=a.payment_id where p.student_id=s.id),0) credit
    from app_private.students s order by s.code limit 100 offset greatest(0,coalesce((p_data->>'offset')::integer,0))) z;
  elsif res=any(array['fee_policies','assignments','sessions','combos','invoices','invoice_lines','payments','allocations','refunds','payroll_batches','payroll_lines','payroll_payments','payroll_adjustments','cash_entries']) then
   if own_teacher is not null then
    if res='sessions' then select coalesce(jsonb_agg(to_jsonb(z)),'[]') into result from (select s.* from app_private.sessions s join app_private.assignments a on a.id=s.assignment_id where a.teacher_id=own_teacher order by s.starts_at desc limit 100 offset greatest(0,coalesce((p_data->>'offset')::integer,0))) z;
    elsif res='assignments' then select coalesce(jsonb_agg(to_jsonb(z)-array['percent','per_session','per_hour','fixed_month']),'[]') into result from (select * from app_private.assignments where teacher_id=own_teacher) z;
    elsif res='payroll_lines' then select coalesce(jsonb_agg(to_jsonb(z)),'[]') into result from (select * from app_private.payroll_lines where teacher_id=own_teacher order by created_at desc limit 100 offset greatest(0,coalesce((p_data->>'offset')::integer,0))) z;
    else select coalesce(jsonb_agg(to_jsonb(z)),'[]') into result from (select p.* from app_private.payroll_payments p join app_private.payroll_lines l on l.id=p.payroll_line_id where l.teacher_id=own_teacher order by p.created_at desc limit 100 offset greatest(0,coalesce((p_data->>'offset')::integer,0))) z;end if;
   else
    execute format('select coalesce(jsonb_agg(to_jsonb(z)),''[]'') from (select * from app_private.%I order by created_at desc,id limit 100 offset $1) z',res) into result using greatest(0,least(100000,coalesce((p_data->>'offset')::integer,0)));
    if res='assignments' and not (u->'permissions' ? 'payroll.view') then select coalesce(jsonb_agg(x-array['percent','per_session','per_hour','fixed_month']),'[]') into result from jsonb_array_elements(result) x;end if;
   end if;
  else raise exception 'NOT_FOUND';end if;
  return result;
 elsif p_action='teacher_link' then
  update app_private.app_users set teacher_id=(p_data->>'teacher_id')::uuid where id=(p_data->>'user_id')::uuid returning id into ident;if ident is null then raise exception 'NOT_FOUND';end if;
  update app_private.app_sessions set revoked_at=now() where user_id=ident and revoked_at is null;
  insert into app_private.audit_logs(actor_id,action,entity_type,entity_id,after_data,reason,request_id) values(actor,'LINK_TEACHER','app_users',ident,jsonb_build_object('teacher_id',p_data->>'teacher_id'),p_data->>'reason',p_request);
 elsif p_action='fee_create' then
  insert into app_private.fee_policies(class_subject_id,effective_on,amount,reason) values((p_data->>'class_subject_id')::uuid,(p_data->>'effective_on')::date,(p_data->>'amount')::numeric,p_data->>'reason') returning id into ident;
 elsif p_action='assignment_create' then
  if nullif(btrim(p_data->>'reason'),'') is null then raise exception 'REASON_REQUIRED';end if;
  if exists(select 1 from app_private.assignments where class_subject_id=(p_data->>'class_subject_id')::uuid and daterange(start_date,end_date,'[)') && daterange((p_data->>'start_date')::date,nullif(p_data->>'end_date','')::date,'[)')) then raise exception 'ASSIGNMENT_OVERLAP';end if;
  insert into app_private.assignments(class_subject_id,teacher_id,start_date,end_date,percent,per_session,per_hour,fixed_month,reason) values((p_data->>'class_subject_id')::uuid,(p_data->>'teacher_id')::uuid,(p_data->>'start_date')::date,nullif(p_data->>'end_date','')::date,coalesce((p_data->>'percent')::numeric,0),coalesce((p_data->>'per_session')::numeric,0),coalesce((p_data->>'per_hour')::numeric,0),coalesce((p_data->>'fixed_month')::numeric,0),p_data->>'reason') returning id into ident;
 elsif p_action='assignment_end' then
  if nullif(btrim(p_data->>'reason'),'') is null then raise exception 'REASON_REQUIRED';end if;
  update app_private.assignments set end_date=(p_data->>'end_date')::date where id=(p_data->>'id')::uuid returning id into ident;
  if ident is null then raise exception 'NOT_FOUND';end if;
 elsif p_action='session_create' then
  cnt=coalesce((p_data->>'weeks')::integer,1);if cnt not between 1 and 52 then raise exception 'INVALID_INPUT';end if;
  for i in 0..cnt-1 loop
   insert into app_private.sessions(assignment_id,room_id,starts_at,ends_at,note,makeup_for) values((p_data->>'assignment_id')::uuid,(p_data->>'room_id')::uuid,(p_data->>'starts_at')::timestamptz+i*interval '7 days',(p_data->>'ends_at')::timestamptz+i*interval '7 days',coalesce(p_data->>'note',''),nullif(p_data->>'makeup_for','')::uuid) returning id into ident;
  end loop;
 elsif p_action in ('session_status','session_approve') then
  select * into ses from app_private.sessions where id=(p_data->>'id')::uuid;
  if ses.id is null then raise exception 'NOT_FOUND';end if;
  if ses.version<>(p_data->>'version')::integer or p_data->>'version' is null then raise exception 'CONFLICT';end if;
  if own_teacher is not null and not exists(select 1 from app_private.assignments where id=ses.assignment_id and teacher_id=own_teacher) then raise exception 'FORBIDDEN';end if;
  if p_action='session_approve' then
   if ses.status<>'confirmed' or (p_data->>'status') not in ('approved','rejected') then raise exception 'INVALID_STATE';end if;
  else
   if (p_data->>'status')='confirmed' then if ses.status not in ('planned','rejected') or ses.ends_at>now() then raise exception 'INVALID_STATE';end if;
   elsif (p_data->>'status')='cancelled' then if own_teacher is not null or ses.status not in ('planned','rejected') then raise exception 'INVALID_STATE';end if;
   else raise exception 'INVALID_STATE';end if;
  end if;
  if nullif(btrim(p_data->>'reason'),'') is null then raise exception 'REASON_REQUIRED';end if;
  update app_private.sessions set status=p_data->>'status',note=p_data->>'reason',pay_month=case when p_data->>'status'='approved' then app_private.open_month((starts_at at time zone 'Asia/Ho_Chi_Minh')::date) else null end where id=ses.id returning id into ident;
 elsif p_action='combo_create' then
  if p_data->>'kind'='fixed' and (p_data->>'value')::numeric<>trunc((p_data->>'value')::numeric) then raise exception 'INVALID_INPUT';end if;
  if (select count(distinct x) from jsonb_array_elements_text(p_data->'subject_ids') x)<>3 or exists(select 1 from jsonb_array_elements_text(p_data->'subject_ids') x where not exists(select 1 from app_private.subjects where id=x::uuid)) then raise exception 'INVALID_COMBO';end if;
  insert into app_private.combos(name,kind,value,cap,starts_on,ends_on,subject_ids) values(p_data->>'name',p_data->>'kind',(p_data->>'value')::numeric,nullif(p_data->>'cap','')::numeric,(p_data->>'starts_on')::date,(p_data->>'ends_on')::date,array(select x::uuid from jsonb_array_elements_text(p_data->'subject_ids') x)) returning id into ident;
 elsif p_action='invoice_create' then
  monthdate=(p_data->>'month')::date;if monthdate<>date_trunc('month',monthdate)::date or monthdate is null then raise exception 'INVALID_INPUT';end if;
  if coalesce(p_data->'overrides','{}')<>'{}'::jsonb and (not (u->'permissions' ? 'billing.approve') or nullif(btrim(p_data->>'reason'),'') is null) then raise exception 'OVERRIDE_APPROVAL_REQUIRED';end if;
  if nullif(p_data->>'combo_id','') is not null then
   select * into combo from app_private.combos where id=(p_data->>'combo_id')::uuid and starts_on<=monthdate and ends_on>=monthdate;
   if combo.id is null then raise exception 'INVALID_COMBO';end if;
   select count(distinct cs.subject_id) into cnt from app_private.student_enrollments e join app_private.class_subjects cs on cs.id=e.class_subject_id where e.student_id=(p_data->>'student_id')::uuid and coalesce((select h.status from app_private.enrollment_status_history h where h.enrollment_id=e.id and h.effective_on<=greatest(monthdate,e.start_date) order by h.effective_on desc,h.created_at desc limit 1),e.status)='active' and e.start_date<monthdate+interval '1 month' and (e.end_date is null or e.end_date>monthdate) and cs.subject_id=any(combo.subject_ids);
   if cnt<>3 then raise exception 'INVALID_COMBO';end if;
  end if;
  insert into app_private.invoices(student_id,month,combo_snapshot,reason) values((p_data->>'student_id')::uuid,monthdate,case when combo.id is null then null else to_jsonb(combo) end,p_data->>'reason') returning id into inv;
  -- Build lines in memory first; discount rounding is exact and deterministic.
  v='[]';
  for en in select e.*,c.name class_name,s.name subject_name,s.id subject_id from app_private.student_enrollments e join app_private.class_subjects cs on cs.id=e.class_subject_id join app_private.classes c on c.id=cs.class_id join app_private.subjects s on s.id=cs.subject_id where e.student_id=(p_data->>'student_id')::uuid and e.status='active' and e.start_date<monthdate+interval '1 month' and (e.end_date is null or e.end_date>monthdate) order by e.id loop
   select * into pol from app_private.fee_policies where class_subject_id=en.class_subject_id and effective_on<=greatest(monthdate,en.start_date) order by effective_on desc limit 1;
   select * into ass from app_private.assignments where class_subject_id=en.class_subject_id and start_date<=greatest(monthdate,en.start_date) and (end_date is null or end_date>greatest(monthdate,en.start_date));
   if pol.id is null or ass.id is null then raise exception 'POLICY_REQUIRED';end if;
   if (en.start_date>monthdate or (en.end_date is not null and en.end_date<monthdate+interval '1 month') or exists(select 1 from app_private.enrollment_status_history h where h.enrollment_id=en.id and h.effective_on>monthdate and h.effective_on<monthdate+interval '1 month')) and not (coalesce(p_data->'overrides','{}') ? en.id::text) then raise exception 'MIDMONTH_DECISION_REQUIRED';end if;
   gross=coalesce((p_data->'overrides'->>en.id::text)::numeric,pol.amount);if gross<0 or gross<>trunc(gross) then raise exception 'INVALID_INPUT';end if;
   v=v||jsonb_build_object('enrollment_id',en.id,'fee_policy_id',pol.id,'assignment_id',ass.id,'label',en.class_name||' / '||en.subject_name,'gross',gross,'eligible',combo.id is not null and en.subject_id=any(combo.subject_ids),'snapshot',jsonb_build_object('fee',to_jsonb(pol),'assignment',to_jsonb(ass),'enrollment',to_jsonb(en),'reason',p_data->>'reason'));
  end loop;
  if jsonb_array_length(v)=0 then raise exception 'NO_ENROLLMENTS';end if;
  select coalesce(sum((x->>'gross')::numeric),0) into total from jsonb_array_elements(v) x where (x->>'eligible')::boolean;
  discount_total=case when combo.id is null then 0 when combo.kind='fixed' then least(total,combo.value) else round(total*combo.value/100) end;
  discount_total=least(discount_total,coalesce(combo.cap,discount_total));
  for rowdata in with base as(select x,case when (x->>'eligible')::boolean and total>0 then discount_total*(x->>'gross')::numeric/total else 0 end raw from jsonb_array_elements(v) x),ranked as(select *,row_number() over(order by (raw-floor(raw)) desc,x->>'enrollment_id') rn,discount_total-sum(floor(raw)) over() leftover from base) select x||jsonb_build_object('discount',floor(raw)+case when rn<=leftover then 1 else 0 end) from ranked loop
   insert into app_private.invoice_lines(invoice_id,enrollment_id,month,fee_policy_id,assignment_id,label,gross,discount,snapshot) values(inv,(rowdata->>'enrollment_id')::uuid,monthdate,(rowdata->>'fee_policy_id')::uuid,(rowdata->>'assignment_id')::uuid,rowdata->>'label',(rowdata->>'gross')::numeric,(rowdata->>'discount')::numeric,rowdata->'snapshot');
  end loop;
  perform app_private.allocate_credit((p_data->>'student_id')::uuid);ident=inv;
 elsif p_action='payment_create' then
  insert into app_private.payments(student_id,amount,paid_on,method,reference) values((p_data->>'student_id')::uuid,(p_data->>'amount')::numeric,(p_data->>'paid_on')::date,p_data->>'method',coalesce(p_data->>'reference','')) returning id into ident;
  perform app_private.allocate_credit((p_data->>'student_id')::uuid);
 elsif p_action='refund_request' then
  select * into pay from app_private.payments where id=(p_data->>'payment_id')::uuid;
  if pay.id is null then raise exception 'NOT_FOUND';end if;
  if (p_data->>'amount')::numeric>pay.amount-coalesce((select sum(amount) from app_private.refunds where payment_id=pay.id and status in ('requested','approved','executed')),0) then raise exception 'REFUND_EXCEEDS_PAYMENT';end if;
  insert into app_private.refunds(payment_id,amount,reason,requested_by) values(pay.id,(p_data->>'amount')::numeric,p_data->>'reason',actor) returning id into ident;
 elsif p_action in ('refund_approve','refund_execute') then
  select * into refund from app_private.refunds where id=(p_data->>'id')::uuid;
  if refund.id is null then raise exception 'NOT_FOUND';end if;
  if p_action='refund_approve' then
   if refund.status<>'requested' or p_data->>'status' not in ('approved','rejected') then raise exception 'INVALID_STATE';end if;
   update app_private.refunds set status=p_data->>'status',approved_by=actor where id=refund.id;
  else
   if refund.status<>'approved' then raise exception 'INVALID_STATE';end if;
   select * into pay from app_private.payments where id=refund.payment_id;
   remaining=refund.amount-greatest(0,pay.amount-coalesce((select sum(amount) from app_private.refunds where payment_id=pay.id and status='executed'),0)-coalesce((select sum(amount) from app_private.allocations where payment_id=pay.id),0));
   for allocation in select a.*,a.amount+coalesce((select sum(r.amount) from app_private.allocations r where r.reverses_id=a.id),0) reversible from app_private.allocations a where a.payment_id=pay.id and a.amount>0 order by a.created_at desc,a.id loop
    take=least(remaining,allocation.reversible);if take>0 then insert into app_private.allocations(payment_id,line_id,amount,book_month,refund_id,reverses_id) values(pay.id,allocation.line_id,-take,app_private.open_month((now() at time zone 'Asia/Ho_Chi_Minh')::date),refund.id,allocation.id);remaining=remaining-take;end if;exit when remaining<=0;
   end loop;
   if remaining>0 then raise exception 'INVALID_STATE';end if;
   update app_private.refunds set status='executed',executed_on=(now() at time zone 'Asia/Ho_Chi_Minh')::date where id=refund.id;
  end if;ident=refund.id;
 elsif p_action='payroll_preview' then
  return app_private.payroll_preview(date_trunc('month',(p_data->>'month')::date)::date,own_teacher);
 elsif p_action='payroll_close' then
  monthdate=(p_data->>'month')::date;if monthdate<>date_trunc('month',monthdate)::date or monthdate is null or monthdate>=date_trunc('month',now() at time zone 'Asia/Ho_Chi_Minh')::date then raise exception 'PERIOD_NOT_ENDED';end if;
  if exists(select 1 from app_private.sessions where starts_at>=monthdate::timestamp at time zone 'Asia/Ho_Chi_Minh' and starts_at<(monthdate+interval '1 month') at time zone 'Asia/Ho_Chi_Minh' and status in ('planned','confirmed','rejected')) then raise exception 'UNREVIEWED_SESSIONS';end if;
  result=app_private.payroll_preview(monthdate);
  insert into app_private.payroll_batches(month,closed_by) values(monthdate,actor) returning id into ident;
  for rowdata in select * from jsonb_array_elements(result) loop insert into app_private.payroll_lines(batch_id,teacher_id,amount,snapshot) values(ident,(rowdata->>'teacher_id')::uuid,(rowdata->>'amount')::numeric,rowdata);end loop;
 elsif p_action='adjustment_create' then
  monthdate=(p_data->>'month')::date;if monthdate<>app_private.open_month(monthdate) then raise exception 'PERIOD_CLOSED';end if;
  insert into app_private.payroll_adjustments(teacher_id,month,amount,reason) values((p_data->>'teacher_id')::uuid,monthdate,(p_data->>'amount')::numeric,p_data->>'reason') returning id into ident;
 elsif p_action='payroll_pay' then
  select amount-coalesce((select sum(amount) from app_private.payroll_payments where payroll_line_id=l.id),0) into remaining from app_private.payroll_lines l where l.id=(p_data->>'payroll_line_id')::uuid;
  if remaining is null then raise exception 'NOT_FOUND';end if;
  if (p_data->>'amount')::numeric>remaining then raise exception 'OVERPAYMENT';end if;
  insert into app_private.payroll_payments(payroll_line_id,amount,paid_on,reference) values((p_data->>'payroll_line_id')::uuid,(p_data->>'amount')::numeric,(p_data->>'paid_on')::date,coalesce(p_data->>'reference','')) returning id into ident;
 elsif p_action='cash_create' then
  insert into app_private.cash_entries(kind,amount,paid_on,category,description) values(p_data->>'kind',(p_data->>'amount')::numeric,(p_data->>'paid_on')::date,p_data->>'category',p_data->>'description') returning id into ident;
 elsif p_action='report' then
  monthdate=date_trunc('month',(p_data->>'month')::date)::date;d=(monthdate+interval '1 month')::date;
  select jsonb_build_object(
   'month',monthdate,
   'tuition_cash',coalesce((select sum(amount) from app_private.payments where paid_on>=monthdate and paid_on<d),0),
   'refund_cash',coalesce((select sum(amount) from app_private.refunds where status='executed' and executed_on>=monthdate and executed_on<d),0),
   'allocated',coalesce((select sum(amount) from app_private.allocations where book_month=monthdate),0),
   'other_income',coalesce((select sum(amount) from app_private.cash_entries where kind='income' and paid_on>=monthdate and paid_on<d),0),
   'expenses',coalesce((select sum(amount) from app_private.cash_entries where kind='expense' and paid_on>=monthdate and paid_on<d),0),
   'payroll_cash',coalesce((select sum(amount) from app_private.payroll_payments where paid_on>=monthdate and paid_on<d),0),
   'payroll_earned',coalesce((select sum(l.amount) from app_private.payroll_lines l join app_private.payroll_batches b on b.id=l.batch_id where b.month=monthdate),(select sum((x->>'amount')::numeric) from jsonb_array_elements(app_private.payroll_preview(monthdate)) x),0),
   'payroll_closed',exists(select 1 from app_private.payroll_batches where month=monthdate),
   'debt_current',coalesce((select sum(il.gross-il.discount) from app_private.invoice_lines il),0)-coalesce((select sum(amount) from app_private.allocations where amount>0),0),
   'credit_current',coalesce((select sum(amount) from app_private.payments),0)-coalesce((select sum(amount) from app_private.refunds where status='executed'),0)-coalesce((select sum(amount) from app_private.allocations),0),
   'students_active',(select count(*) from app_private.students where status='studying'),
   'enrollments_active',(select count(*) from app_private.student_enrollments where status='active' and start_date<=current_date and (end_date is null or end_date>current_date))) into result;return result;
 end if;
 result=jsonb_build_object('id',ident,'ok',true);
 insert into app_private.operation_receipts(actor_id,key,payload,result) values(actor,keyid,jsonb_build_object('action',p_action,'data',p_data),result);
 return result;
end $$;
do $$ declare t record;begin for t in select tablename from pg_tables where schemaname='app_private' loop execute format('alter table app_private.%I enable row level security',t.tablename);end loop;end $$;
revoke all on all tables in schema app_private from public,anon,authenticated,service_role;
revoke all on all functions in schema app_private from public,anon,authenticated,service_role;
revoke all on function app_api.operations(text,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function app_api.operations(text,text,jsonb,uuid) to service_role;
insert into app_private.schema_versions(version) values('202611240005');
commit;

