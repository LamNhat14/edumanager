import ts from "typescript";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
await mkdir("docs/deploy", { recursive: true });
for (const name of ["edumanager", "bootstrap-admin"]) {
  const files=['edumanager/auth.ts','edumanager/rpc.ts',`${name}/handler.ts`,`${name}/index.ts`];
  const chunks=[];
  for(const file of files){
    let source=await readFile('supabase/functions/'+file,'utf8');
    const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
    const imports=ast.statements.filter(s=>ts.isImportDeclaration(s)&&s.moduleSpecifier.text.startsWith('.'));
    for(const statement of imports.reverse()) source=source.slice(0,statement.getStart(ast))+source.slice(statement.end);
    chunks.push('// Source: '+file+'\n'+source);
  }
  await writeFile(`docs/deploy/${name}.ts`,'// Generated TypeScript for Supabase Dashboard; edit source modules then regenerate.\n'+chunks.join('\n'));
}
const migrations = (await readdir("supabase/migrations"))
  .filter((x) => x.endsWith(".sql"))
  .sort();
await writeFile(
  "docs/deploy/FRESH-PROJECT-ONLY.sql",
  "-- ONLY for a new empty EduManager project. Never run twice.\n" +
    (
      await Promise.all(
        migrations.map((x) => readFile("supabase/migrations/" + x, "utf8")),
      )
    ).join("\n"),
);
console.log("Dashboard deployment files generated. No secrets included.");
