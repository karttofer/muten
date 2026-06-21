import{readFileSync as i,existsSync as p}from"node:fs";import{join as s,relative as c}from"node:path";import{parse as g}from"#engine/lang/parse.js";function w(o){const t=r=>c(o,r),e=s(o,"src","app.muten");if(!p(e))throw new Error(`No app.muten at ${t(e)}
   Every app needs a root. Create src/app.muten with:
     routes {
       / -> home
     }`);let a;try{a=g(i(e,"utf8"))}catch(r){throw new Error(`${t(e)}: ${r instanceof Error?r.message:String(r)}`)}const u=s(o,"src","pages"),n=(a.routes||[]).map(r=>({route:r.url.replace(/^\//,""),page:r.page,screenPath:s(u,r.page,r.page+".muten")}));if(!n.length)throw new Error(`${t(e)} has no routes. Add:  routes { /url -> page }`);for(const r of n)if(!p(r.screenPath))throw new Error(`route /${r.route} -> ${r.page}: page not found at ${t(r.screenPath)}`);return n}export{w as readRoutes};
