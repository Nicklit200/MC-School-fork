import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root = path.dirname(fileURLToPath(import.meta.url));
const core = readFileSync(path.join(root,'study-sessions.js'),'utf8').replace(/^export /gm,'');
const output = path.join(root,'dist');
mkdirSync(output,{recursive:true});
for (const name of ['personal-life-api','my-skills-mcp']) {
  const source = readFileSync(path.join(root,name + '.ts'),'utf8');
  const pattern = /^import\s*\{\s*createStudySessionStore\s*,\s*loadStudySessionCatalog\s*\}\s*from\s*['"]\.\/study-sessions\.js['"];?\r?\n/m;
  if (!pattern.test(source)) throw Error('Shared store import not found in ' + name);
  const bundled = source.replace(pattern,() => core + '\n');
  if (/from ['"]\.\//.test(bundled)) throw Error('Railway Functions must be self-contained');
  writeFileSync(path.join(output,name + '.tsx'),bundled);
  console.log('Built ' + name + ' (' + Buffer.byteLength(bundled) + ' bytes)');
}
