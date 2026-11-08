import {DatabaseSync} from 'node:sqlite'
import {readdir} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
const root=process.cwd(), directory=root+'/.wrangler/state/v3/d1/miniflare-D1DatabaseObject'
const files=(await readdir(directory)).filter(f=>f.endsWith('.sqlite')&&f!=='metadata.sqlite')
if(files.length!==1)throw Error('Expected one setup database')
const sqlite=new DatabaseSync(directory+'/'+files[0],{readOnly:true})
const db={prepare(sql){let values=[];return {bind(...args){values=args;return this},all(){return {results:sqlite.prepare(sql).all(...values)}}}}}
const {nativeMigrationPreflight}=await import(pathToFileURL(root+'/node_modules/@runeditrun/rer/cli/portability-migrations.mjs'))
try {console.log(JSON.stringify({check:'nativeMigrationPreflight',...await nativeMigrationPreflight({root,db,platformMigrations:{prefix:'core-'}})}))} finally{sqlite.close()}
