import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
await mkdir('work',{recursive:true});
await build({entryPoints:['scripts/local-server.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'work/local-server.mjs'});
await import('../work/local-server.mjs');
