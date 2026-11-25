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
