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

