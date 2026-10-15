import {build} from 'esbuild';
await build({entryPoints:['src/main.ts'],bundle:true,external:['obsidian','electron','@electron/remote'],format:'cjs',platform:'browser',target:'es2020',outfile:'main.js',logLevel:'info'});
