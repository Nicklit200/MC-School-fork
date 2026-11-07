import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const server=await createServer({root,configFile:false,plugins:[react()],resolve:{preserveSymlinks:true},optimizeDeps:{entries:['e2e/interactive-templates.html']},server:{host:'127.0.0.1',port:4185,strictPort:true}});
await server.listen();server.printUrls();
