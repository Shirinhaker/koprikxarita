import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { canPublishBuilding, validateBuildingInput } from "../domain/buildings.mjs";
import { BuildingConflictError, BuildingNotFoundError, BuildingPublishError } from "./json-building-errors.mjs";

const CELL = 0.02;
const LIMIT = 6000;
const readArray = async (file, create = true) => {
  try { const v = JSON.parse((await readFile(file, "utf8")) || "[]"); return Array.isArray(v) ? v : []; }
  catch (e) { if (e.code !== "ENOENT") throw e; if (create) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, "[]\n"); } return []; }
};
const write = async (file, value) => { await mkdir(path.dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}.${Date.now()}.tmp`; await writeFile(tmp, `${JSON.stringify(value)}\n`); await rename(tmp, file); };
const center = (g) => { const r = g.coordinates[0]; const p = r.length > 1 ? r.slice(0, -1) : r; const s = p.reduce((a,[x,y])=>[a[0]+x,a[1]+y],[0,0]); return [s[0]/p.length,s[1]/p.length]; };
const cell = (g) => { const [x,y] = center(g); return `${Math.floor((x+180)/CELL)}_${Math.floor((y+90)/CELL)}`; };
const shardKey = (id) => /^ms_(-?\d+_-?\d+)_/.exec(String(id))?.[1] ?? null;
const fingerprint = (g) => createHash("sha1").update(JSON.stringify(g.coordinates[0].map(([x,y])=>[+x.toFixed(6),+y.toFixed(6)]))).digest("hex").slice(0,20);
const bounds = (g) => g.coordinates[0].reduce((b,[x,y])=>({west:Math.min(b.west,x),south:Math.min(b.south,y),east:Math.max(b.east,x),north:Math.max(b.north,y)}),{west:Infinity,south:Infinity,east:-Infinity,north:-Infinity});
const hit = (a,b) => a.west<=b.east && a.east>=b.west && a.south<=b.north && a.north>=b.south;
const box = (v) => { if(!Array.isArray(v)||v.length!==4) return null; const [west,south,east,north]=v.map(Number); return [west,south,east,north].every(Number.isFinite)&&west<=east&&south<=north?{west,south,east,north}:null; };
const viewport = (q) => { const t=String(q??""); if(!t.startsWith("__viewport__:")) return null; const [b,l]=t.slice(13).split(";"); const bb=b.split(",").map(Number); if(!box(bb)) return null; return {bbox:bb,limit:Math.max(1,Math.min(Number(l)||LIMIT,12000))}; };

export class JsonBuildingRepository {
  constructor({ buildingsFile, logFile, shardsDir = path.join(path.dirname(buildingsFile), "building-shards") }) { this.buildingsFile=buildingsFile; this.logFile=logFile; this.shardsDir=shardsDir; this.metaFile=path.join(shardsDir,"meta.json"); this.queue=Promise.resolve(); }
  shardFile(k){ return path.join(this.shardsDir,`cell-${k}.json`); }
  async #serial(fn){ const n=this.queue.then(fn,fn); this.queue=n.catch(()=>{}); return n; }
  async #keys(){ try{return (await readdir(this.shardsDir)).filter(n=>/^cell-.*\.json$/.test(n)).map(n=>n.slice(5,-5));}catch(e){if(e.code==="ENOENT")return[];throw e;} }
  #keysFor(b){ const B=box(b); if(!B)return[]; const a=[Math.floor((B.west+180)/CELL),Math.floor((B.south+90)/CELL)], z=[Math.floor((B.east+180)/CELL),Math.floor((B.north+90)/CELL)], out=[]; for(let x=a[0];x<=z[0]&&out.length<1200;x++)for(let y=a[1];y<=z[1]&&out.length<1200;y++)out.push(`${x}_${y}`); return out; }
  async list(status="published", options={}){
    const B=box(options.bbox), limit=Math.max(1,Math.min(Number(options.limit)||LIMIT,20000));
    const primary=(await readArray(this.buildingsFile)).filter(b=>(status==="all"||b.status===status)&&(!B||hit(bounds(b.geometry),B)));
    const manager=status==="all"&&!B&&options.includeShards===undefined;
    const out=manager?primary.filter(b=>b.source!=="microsoft").slice(0,limit):primary.slice(0,limit);
    if(manager||options.includeShards===false)return out;
    const keys=B?this.#keysFor(options.bbox):await this.#keys();
    for(const k of keys){ if(out.length>=limit)break; for(const b of await readArray(this.shardFile(k),false)){ if((status==="all"||b.status===status)&&(!B||hit(bounds(b.geometry),B)))out.push(b); if(out.length>=limit)break; } }
    return out.sort((a,b)=>String(b.updatedAt??"").localeCompare(String(a.updatedAt??"")));
  }
  async countBySource(source){ const p=(await readArray(this.buildingsFile)).filter(b=>b.source===source&&b.status!=="archived").length; if(source!=="microsoft")return p; try{const m=JSON.parse(await readFile(this.metaFile,"utf8"));return p+Number(m.microsoftCount||0);}catch(e){if(e.code==="ENOENT")return p;throw e;} }
  async getById(id){ const k=shardKey(id), a=await readArray(k?this.shardFile(k):this.buildingsFile,false); return a.find(b=>b.id===id)??null; }
  async create(input,actor){ const v=validateBuildingInput(input); return this.#serial(async()=>{const a=await readArray(this.buildingsFile),now=new Date().toISOString(),{expectedUpdatedAt,...f}=v,b={id:randomUUID(),...f,status:"draft",createdBy:actor.id,createdByName:actor.fullName,createdAt:now,updatedAt:now};a.push(b);await write(this.buildingsFile,a);await this.#log("create",b.id,null,b,actor);return b;}); }
  async importMany(inputs,actor,defaults={}){
    const vals=inputs.map(i=>validateBuildingInput({...defaults,...i})); if(defaults.source!=="microsoft"){const buildings=[];for(const v of vals)buildings.push(await this.create(v,actor));return{count:buildings.length,skipped:0,buildings};}
    return this.#serial(async()=>{await readArray(this.buildingsFile);const groups=new Map(),now=new Date().toISOString(),created=[];let skipped=0;for(const v of vals){const k=cell(v.geometry);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(v);}for(const[k,vs]of groups){const a=await readArray(this.shardFile(k),false),seen=new Set(a.map(b=>b.sourceKey).filter(Boolean));for(const v of vs){const key=fingerprint(v.geometry);if(seen.has(key)){skipped++;continue;}const{expectedUpdatedAt,...f}=v,b={id:`ms_${k}_${randomUUID()}`,...f,sourceKey:key,status:"draft",createdBy:actor.id,createdByName:actor.fullName,createdAt:now,updatedAt:now};a.push(b);created.push(b);seen.add(key);}await write(this.shardFile(k),a);}if(created.length){let m={microsoftCount:0};try{m=JSON.parse(await readFile(this.metaFile,"utf8"));}catch(e){if(e.code!=="ENOENT")throw e;}m.microsoftCount=Number(m.microsoftCount||0)+created.length;m.updatedAt=now;await write(this.metaFile,m);await this.#log("import_batch",null,null,{count:created.length,skipped},actor);}return{count:created.length,skipped,buildings:created};});
  }
  async update(id,input,actor){const v=validateBuildingInput(input);return this.#mutate(id,"update",actor,c=>{if(v.expectedUpdatedAt&&v.expectedUpdatedAt!==c.updatedAt)throw new BuildingConflictError();const{expectedUpdatedAt,...f}=v;return{...c,...f,status:c.status==="archived"?"archived":f.status,updatedAt:new Date().toISOString()};});}
  async setVerified(id,verified,actor){return this.#mutate(id,verified?"verify":"unverify",actor,c=>({...c,verified:!!verified,updatedAt:new Date().toISOString()}));}
  async publish(id,actor){return this.#mutate(id,"publish",actor,c=>{const x=canPublishBuilding(c);if(!x.ok)throw new BuildingPublishError(x.message);return{...c,status:"published",updatedAt:new Date().toISOString()};});}
  async archive(id,actor){return this.#mutate(id,"archive",actor,c=>({...c,status:"archived",updatedAt:new Date().toISOString()}));}
  async restore(id,actor){return this.#mutate(id,"restore",actor,c=>({...c,status:"draft",updatedAt:new Date().toISOString()}));}
  async search(query,status="published",options={}){const v=viewport(query);if(v)return this.list(status,{...options,...v});const n=String(query??"").trim().toLocaleLowerCase("uz"),a=await this.list(status,options);return n?a.filter(b=>[b.name,b.districtName,b.neighborhoodName].some(x=>String(x??"").toLocaleLowerCase("uz").includes(n))):a;}
  async #mutate(id,action,actor,fn){return this.#serial(async()=>{const k=shardKey(id),file=k?this.shardFile(k):this.buildingsFile,a=await readArray(file,false),i=a.findIndex(b=>b.id===id);if(i<0)throw new BuildingNotFoundError();const old=a[i],next=fn(old);a[i]=next;await write(file,a);await this.#log(action,id,old,next,actor);return next;});}
  async #log(action,buildingId,oldData,newData,actor){const a=await readArray(this.logFile);a.push({id:randomUUID(),buildingId,action,oldData,newData,changedBy:actor.id,changedByName:actor.fullName,changedAt:new Date().toISOString()});await write(this.logFile,a);}
}

export { BuildingConflictError, BuildingNotFoundError, BuildingPublishError } from "./json-building-errors.mjs";
