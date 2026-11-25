import {createServer} from 'node:http';
import {readFile,readdir,mkdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createServer as createVite} from 'vite';
import {hash,compare} from 'bcryptjs';
import {createAuth,AuthError,validatePassword} from '../supabase/functions/edumanager/auth.ts';
import {createHandler} from '../supabase/functions/edumanager/handler.ts';
import {businessErrors} from '../supabase/functions/edumanager/rpc.ts';
const origin='http://127.0.0.1:5173';
await mkdir('work/local-data',{recursive:true});
const db=new PGlite('work/local-data');
await db.exec("do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;create role authenticated;create role service_role bypassrls;end if;end $$;");
for(const file of (await readdir('supabase/migrations')).filter(x=>x.endsWith('.sql')).sort()){
 const exists=(await db.query<{present:boolean}>("select to_regclass('app_private.schema_versions') is not null present")).rows[0].present;
 if(exists&&(await db.query('select 1 from app_private.schema_versions where version=$1',[file.split('_')[0]])).rows.length)continue;
 await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
}
const rpc=async(name:string,args:Record<string,unknown>)=>{
 if(!['bootstrap_admin','auth_command','login_begin','login_finish','academic','operations'].includes(name))throw new AuthError(404,'NOT_FOUND','Không có API.');
 try{return (await db.query<{result:unknown}>(`select app_api.${name}(${Object.keys(args).map((_,i)=>'$'+(i+1)).join(',')}) result`,Object.values(args))).rows[0].result;}
 catch(e){const error=e as Error&{code?:string};const code=error.message;const known:Record<string,string>={...businessErrors,UNAUTHENTICATED:'Phiên đã hết hạn. Vui lòng đăng nhập lại.',FORBIDDEN:'Bạn không có quyền thực hiện thao tác.',CONFLICT:'Dữ liệu đã thay đổi. Hãy tải lại.',BOOTSTRAP_CLOSED:'Đã có tài khoản Admin.',PASSWORD_CHANGE_REQUIRED:'Cần đổi mật khẩu.',LAST_ADMIN:'Không thể gỡ Admin cuối cùng.',INVALID_INPUT:'Dữ liệu không hợp lệ.',NOT_FOUND:'Không tìm thấy dữ liệu.'};throw new AuthError(code==='UNAUTHENTICATED'?401:code==='FORBIDDEN'?403:422,known[code]?code:'INVALID_INPUT',known[code]||(error.code==='23505'?'Dữ liệu đã tồn tại.':'Dữ liệu không hợp lệ. Kiểm tra trường bắt buộc và quan hệ.'));}
};
const handler=createHandler([origin],createAuth(rpc,{hash:p=>hash(p,12),compare},crypto.randomUUID()+crypto.randomUUID()));
process.env.VITE_SUPABASE_URL=origin;process.env.VITE_SUPABASE_ANON_KEY='local-public-placeholder';process.env.VITE_BASE_PATH='/';
const vite=await createVite({server:{middlewareMode:true},define:{'import.meta.env.VITE_LOCAL_MODE':JSON.stringify('true')}});
const server=createServer(async(req,res)=>{
 if(req.headers.host!=='127.0.0.1:5173'){res.writeHead(403);res.end();return;}
 if(!req.url?.startsWith('/functions/v1/edumanager/v1/')){vite.middlewares(req,res);return;}
 try{
  const chunks:Buffer[]=[];let length=0;
  for await(const chunk of req){length+=chunk.length;if(length>524288){res.writeHead(413);res.end();return;}chunks.push(chunk);}
  const request=new Request(origin+req.url,{method:req.method,headers:req.headers as HeadersInit,body:chunks.length?Buffer.concat(chunks):undefined});
  let response:Response;
  if(req.url==='/functions/v1/edumanager/v1/local/setup'){
   if(req.method==='GET')response=Response.json({data:{needs_setup:!(await db.query('select 1 from app_private.app_users limit 1')).rows.length}});
   else if(req.method==='POST'&&req.headers.origin===origin&&req.headers['content-type']?.includes('application/json')){
    const b=await request.json();validatePassword(b.password);
    if(typeof b.username!=='string'||typeof b.display_name!=='string'||!/^[a-z0-9_.-]{3,64}$/.test(b.username))throw new AuthError(422,'INVALID_INPUT','Tên đăng nhập chưa hợp lệ.');
    response=Response.json({data:await rpc('bootstrap_admin',{p_username:b.username,p_name:b.display_name,p_hash:await hash(b.password,12)})});
   }else response=Response.json({error:{code:'FORBIDDEN',message:'Nguồn yêu cầu không hợp lệ.'}},{status:403});
  }else response=await handler(request);
  response.headers.set('Cache-Control','no-store');res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
 }catch(e){const err=e as AuthError;res.writeHead(err.status||500,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:{code:err.code||'LOCAL_ERROR',message:err instanceof AuthError?err.message:'Không xử lý được yêu cầu cục bộ.'}}));}
});
server.listen(5173,'127.0.0.1',()=>console.log('EduManager LOCAL: '+origin+'/#/local-setup\nData: work/local-data. Close with Ctrl+C before backing up this folder.'));
let stopping=false;async function stop(){if(stopping)return;stopping=true;server.close();await vite.close();await db.close();process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
