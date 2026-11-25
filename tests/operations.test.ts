import { PGlite } from '@electric-sql/pglite';
import { beforeAll,afterAll,it,expect } from 'vitest';
import { readFile,readdir } from 'node:fs/promises';
const db=new PGlite();const hash='a'.repeat(64);let actor:string;let student:string,teacher:string,room:string,cls:string;const subjects:string[]=[],cs:string[]=[],enrollments:string[]=[],assignments:string[]=[];
const now=new Date();const month=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)).toISOString().slice(0,10);const past=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,1)).toISOString().slice(0,10);
async function rpc(name:string,action:string,data:Record<string,unknown>,token=hash):Promise<any>{return (await db.query<{result:any}>(`select app_api.${name}($1,$2,$3,$4) result`,[token,action,JSON.stringify(data),crypto.randomUUID()])).rows[0].result;}
const op=(action:string,data:Record<string,unknown>={})=>rpc('operations',action,{key:crypto.randomUUID(),...data});
async function save(resource:string,values:Record<string,unknown>){return (await rpc('academic','save',{resource,values})).record.id;}
beforeAll(async()=>{
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
 for(const file of (await readdir('supabase/migrations')).sort())await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
 actor=(await db.query<{id:string}>("insert into app_private.app_users(username,display_name,password_hash,status,must_change_password) values('operator','Operator','TEST_ONLY','active',false) returning id")).rows[0].id;
 await db.query("insert into app_private.user_roles(user_id,role_id) select $1,id from app_private.roles where code='admin'",[actor]);
 await db.query("insert into app_private.app_sessions(user_id,token_hash,key_version,expires_at) values($1,$2,1,now()+interval '8 hours')",[actor,hash]);
 student=await save('students',{full_name:'Test Student',grade:7,admission_date:past});teacher=await save('teachers',{full_name:'Test Teacher',phone:'TEST',started_on:past});
 room=await save('rooms',{code:'R1',name:'Room',capacity:30});cls=await save('classes',{code:'C1',name:'Class',capacity:30,grade:7,start_date:past});
 for(let i=0;i<3;i++){
  subjects.push(await save('subjects',{code:'S'+i,name:'Subject '+i}));cs.push(await save('class_subjects',{class_id:cls,subject_id:subjects[i]}));
  enrollments.push(await save('student_enrollments',{student_id:student,class_subject_id:cs[i],start_date:past}));
  assignments.push((await op('assignment_create',{class_subject_id:cs[i],teacher_id:teacher,start_date:past,percent:30,reason:'Test policy'})).id);
  await op('fee_create',{class_subject_id:cs[i],effective_on:past,amount:100001+i,reason:'Test fee'});
 }
},30000);
afterAll(()=>db.close());
it('rejects overlapping enrollment atomically',async()=>{await expect(save('student_enrollments',{student_id:student,class_subject_id:cs[0],start_date:month})).rejects.toThrow('ENROLLMENT_OVERLAP');});
it('requires optimistic version and reason on academic edits',async()=>{await expect(rpc('academic','save',{resource:'students',id:student,version:999,reason:'Edit',values:{full_name:'Changed'}})).rejects.toThrow('CONFLICT');await expect(rpc('academic','save',{resource:'students',id:student,version:1,values:{full_name:'Changed'}})).rejects.toThrow('REASON_REQUIRED');});
let session:string;
it('creates weekly sessions and rolls back every recurrence on conflict',async()=>{
 session=(await op('session_create',{assignment_id:assignments[0],room_id:room,starts_at:past+'T08:00:00+07:00',ends_at:past+'T09:00:00+07:00',weeks:2})).id;
 await expect(op('session_create',{assignment_id:assignments[1],room_id:room,starts_at:past+'T08:30:00+07:00',ends_at:past+'T09:30:00+07:00',weeks:3})).rejects.toThrow('SCHEDULE_CONFLICT');
 expect((await op('list',{resource:'sessions'})).length).toBe(2);
});
it('requires confirmation before approval and rejects stale version',async()=>{
 await expect(op('session_approve',{id:session,version:1,status:'approved',reason:'Checked'})).rejects.toThrow('INVALID_STATE');
 await op('session_status',{id:session,version:1,status:'confirmed',reason:'Taught'});
 await expect(op('session_approve',{id:session,version:1,status:'approved',reason:'Checked'})).rejects.toThrow('CONFLICT');
 await op('session_approve',{id:session,version:2,status:'approved',reason:'Checked'});
});
it('refuses payroll close while sessions await review',async()=>{await expect(op('payroll_close',{month:past})).rejects.toThrow('UNREVIEWED_SESSIONS');});
it('closes payroll after review and prevents duplicate close',async()=>{
 const rows=await op('list',{resource:'sessions'});for(const s of rows.filter((s:any)=>s.status==='planned'))await op('session_status',{id:s.id,version:s.version,status:'cancelled',reason:'Cancelled'});
 await op('payroll_close',{month:past});await expect(op('payroll_close',{month:past})).rejects.toThrow();
 await expect(op('adjustment_create',{teacher_id:teacher,month:past,amount:100,reason:'Late'})).rejects.toThrow('PERIOD_CLOSED');
});
let invoice:string,payment:string;
it('allocates combo exactly with largest remainders and snapshots policies',async()=>{
 const combo=await op('combo_create',{name:'3 subjects',kind:'fixed',value:100000,starts_on:past,ends_on:'2099-12-31',subject_ids:subjects});
 invoice=(await op('invoice_create',{student_id:student,month,combo_id:combo.id})).id;
 const lines=await op('list',{resource:'invoice_lines'});
 expect(lines.reduce((s:number,x:any)=>s+Number(x.discount),0)).toBe(100000);
 expect(lines.reduce((s:number,x:any)=>s+Number(x.gross)-Number(x.discount),0)).toBe(200006);
 expect(lines.every((x:any)=>x.snapshot.assignment.percent===30)).toBe(true);
 await expect(op('invoice_create',{student_id:student,month})).rejects.toThrow();
});
it('accepts partial payments, leaves debt, and is idempotent',async()=>{
 const payload={student_id:student,amount:100000,paid_on:month,method:'cash',key:crypto.randomUUID()};
 const first=await op('payment_create',payload);expect(await op('payment_create',payload)).toEqual(first);payment=first.id;
 await expect(op('payment_create',{...payload,amount:100001})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
 const balance=(await op('list',{resource:'balances'}))[0];expect(Number(balance.debt)).toBe(100006);expect(Number(balance.credit)).toBe(0);
});
it('stores advance and excludes advance from percentage salary',async()=>{
 await op('payment_create',{student_id:student,amount:150006,paid_on:month,method:'bank'});
 const balance=(await op('list',{resource:'balances'}))[0];expect(Number(balance.debt)).toBe(0);expect(Number(balance.credit)).toBe(50000);
 const payroll=await op('payroll_preview',{month});expect(Number(payroll[0].revenue)).toBe(Math.round(200006*.3));
});
it('requires approval before refunds, reverses allocation and salary without reopening debt',async()=>{
 const r=await op('refund_request',{payment_id:payment,amount:20000,reason:'Refund'});
 await expect(op('refund_execute',{id:r.id})).rejects.toThrow('INVALID_STATE');
 await op('refund_approve',{id:r.id,status:'approved'});await op('refund_execute',{id:r.id});
 await expect(op('refund_execute',{id:r.id})).rejects.toThrow('INVALID_STATE');
 const balance=(await op('list',{resource:'balances'}))[0];expect(Number(balance.debt)).toBe(0);expect(Number(balance.credit)).toBe(50000);
 const payroll=await op('payroll_preview',{month});expect(Number(payroll[0].revenue)).toBe(Math.round(180006*.3));
});
it('preserves posted ledger and invoices',async()=>{for(const t of ['payments','invoice_lines','allocations'])await expect(db.exec(`update app_private.${t} set id=id`)).rejects.toThrow('IMMUTABLE_LEDGER');});
it('reports cash separately from allocation and credits',async()=>{
 await op('cash_create',{kind:'expense',amount:1000,paid_on:month,category:'Supplies',description:'Test'});
 const report=await op('report',{month});expect(Number(report.tuition_cash)).toBe(250006);expect(Number(report.refund_cash)).toBe(20000);expect(Number(report.allocated)).toBe(180006);expect(Number(report.expenses)).toBe(1000);expect(Number(report.credit_current)).toBe(50000);
});
it('denies operations to anonymous and restricts teacher to linked own rows',async()=>{
 await expect(rpc('operations','list',{resource:'payments'},'b'.repeat(64))).rejects.toThrow('UNAUTHENTICATED');
 const t=(await db.query<{id:string}>("insert into app_private.app_users(username,display_name,password_hash,status,must_change_password,teacher_id) values('teacher_test','Teacher','TEST','active',false,$1) returning id",[teacher])).rows[0].id;
 await db.query("insert into app_private.user_roles(user_id,role_id) select $1,id from app_private.roles where code='teacher'",[t]);await db.query("insert into app_private.app_sessions(user_id,token_hash,key_version,expires_at) values($1,$2,1,now()+interval '8 hours')",[t,'c'.repeat(64)]);
 await expect(rpc('operations','list',{resource:'payments'},'c'.repeat(64))).rejects.toThrow('FORBIDDEN');
 expect((await rpc('operations','list',{resource:'sessions'},'c'.repeat(64))).length).toBe(2);
 await expect(rpc('academic','list',{resource:'students'},'c'.repeat(64))).rejects.toThrow('FORBIDDEN');
});
it('auto applies advance to next invoice and requires a mid-month decision',async()=>{
 const next=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1)).toISOString().slice(0,10);
 await op('invoice_create',{student_id:student,month:next});const balance=(await op('list',{resource:'balances'}))[0];expect(Number(balance.credit)).toBe(0);expect(Number(balance.debt)).toBe(250006);
 const late=await save('students',{full_name:'Late',grade:7,admission_date:month.slice(0,8)+'15'});const e=await save('student_enrollments',{student_id:late,class_subject_id:cs[0],start_date:month.slice(0,8)+'15'});
 await expect(op('invoice_create',{student_id:late,month})).rejects.toThrow('MIDMONTH_DECISION_REQUIRED');
 await op('invoice_create',{student_id:late,month,overrides:{[e]:50000},reason:'Manager decision'});
});
it('Excel import is atomic on a duplicate within the upload',async()=>{
 const row={full_name:'Import duplicate',grade:8,admission_date:month};await expect(rpc('academic','import',{resource:'students',rows:[row,row]})).rejects.toThrow('DUPLICATE_STUDENT');
 expect((await rpc('academic','list',{resource:'students',q:'Import duplicate'})).length).toBe(0);
});
it('rejects fractional VND before database rounding',async()=>{
 await expect(op('payment_create',{student_id:student,amount:1.5,paid_on:month,method:'cash'})).rejects.toThrow('INVALID_INPUT');
 await expect(op('combo_create',{name:'Bad',kind:'fixed',value:1.5,starts_on:past,ends_on:'2099-12-31',subject_ids:subjects})).rejects.toThrow('INVALID_INPUT');
});
it('prevents repointing an existing class subject',async()=>{await expect(rpc('academic','save',{resource:'class_subjects',id:cs[0],version:1,reason:'Change',values:{subject_id:subjects[1]}})).rejects.toThrow('IMMUTABLE_ENROLLMENT');});
it('teacher catalog contains only own assigned classes and own profile',async()=>{
 const other=await save('teachers',{full_name:'Unrelated',phone:'TEST2',started_on:past});
 const catalog=await rpc('operations','catalog',{},'c'.repeat(64));expect(catalog.teachers.some((r:any)=>r.id===other)).toBe(false);expect(catalog.teachers[0].id).toBe(teacher);expect(catalog.class_subjects.length).toBe(3);
});
it('calculates hybrid pay from approved sessions and preserves closed snapshots',async()=>{
 const t=await save('teachers',{full_name:'Hybrid',phone:'TEST3',started_on:past});
 const subject=await save('subjects',{code:'HYBRID',name:'Hybrid'});const classSubject=await save('class_subjects',{class_id:cls,subject_id:subject});
 const a=await op('assignment_create',{teacher_id:t,class_subject_id:classSubject,start_date:past,per_session:100000,per_hour:50000,fixed_month:300000,reason:'Hybrid'});
 const s=await op('session_create',{assignment_id:a.id,room_id:room,starts_at:past+'T12:00:00+07:00',ends_at:past+'T14:00:00+07:00'});
 await op('session_status',{id:s.id,version:1,status:'confirmed',reason:'Taught'});await op('session_approve',{id:s.id,version:2,status:'approved',reason:'Late approval'});
 // Prior month already closed: approved hours land in the next open month.
 const preview=await op('payroll_preview',{month});const row=preview.find((r:any)=>r.teacher_id===t);expect(Number(row.teaching)).toBe(200000);expect(Number(row.fixed)).toBe(300000);expect(Number(row.amount)).toBe(500000);
 const closed=await op('list',{resource:'payroll_lines'});expect(closed.some((r:any)=>r.teacher_id===t)).toBe(false);
});
it('ends assignments without modifying saved salary components',async()=>{
 const end=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+3,1)).toISOString().slice(0,10);
 await op('assignment_end',{id:assignments[0],end_date:end,reason:'Next term'});
 const row=(await op('list',{resource:'assignments'})).find((x:any)=>x.id===assignments[0]);expect(row.end_date).toBe(end);expect(Number(row.percent)).toBe(30);
 await expect(op('assignment_end',{id:assignments[0],end_date:month,reason:'Conflicts invoice'})).rejects.toThrow('ASSIGNMENT_IN_USE');
});
