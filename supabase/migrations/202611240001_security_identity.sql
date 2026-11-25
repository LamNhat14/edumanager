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
