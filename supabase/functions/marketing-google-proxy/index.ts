// Marketing relay: validates a live login, server-side department authorization,
// then forwards only approved actions to a private Google Sheets Apps Script.
// No Marketing task, report, asset or note is stored in Supabase.
const ORIGINS = new Set(["https://harrisho1234-spec.github.io","http://localhost:3000","http://localhost:5173"]);
const ACTIONS = new Set(["ping","list","history","save_task","update_task","review_task","publish_task","daily_save"]);
function reply(data:unknown,status=200,origin=""){
 return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...(ORIGINS.has(origin)?{"Access-Control-Allow-Origin":origin,"Vary":"Origin"}:{})}});
}
Deno.serve(async(request:Request)=>{
 const origin=request.headers.get("origin")||"";
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{
  "Access-Control-Allow-Origin":ORIGINS.has(origin)?origin:"null",
  "Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info",
  "Access-Control-Allow-Methods":"POST,OPTIONS","Access-Control-Max-Age":"1800","Vary":"Origin"
 }});
 if(request.method!=="POST")return reply({ok:false,error:"POST only"},405,origin);
 if(origin&&!ORIGINS.has(origin))return reply({ok:false,error:"Unrecognized app origin"},403,origin);
 const auth=request.headers.get("authorization")||"";
 const token=auth.replace(/^Bearer\s+/i,"");
 if(!/^Bearer\s+\S+$/i.test(auth)||token.length<20||token.length>6000)return reply({ok:false,error:"Sign in to Marketing Management"},401,origin);
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_ANON_KEY");
 if(!url||!key)return reply({ok:false,error:"Marketing authentication not configured"},503,origin);
 try{
  const raw=await request.text();
  if(raw.length>54000)return reply({ok:false,error:"Request too large"},413,origin);
  const parsed=JSON.parse(raw);
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)||!ACTIONS.has(String(parsed.action||""))||
    (parsed.payload!=null&&(typeof parsed.payload!=="object"||Array.isArray(parsed.payload))))
    return reply({ok:false,error:"Invalid Marketing request"},400,origin);
  const headers={apikey:key,Authorization:"Bearer "+token};
  const [userRes,configRes]=await Promise.all([
   fetch(url+"/auth/v1/user",{headers}),
   fetch(url+"/rest/v1/rpc/get_marketing_google_connection",{method:"POST",headers:{...headers,"Content-Type":"application/json"},body:"{}"})
  ]);
  if(!userRes.ok)return reply({ok:false,error:"Your login expired. Sign in again."},401,origin);
  if(!configRes.ok)return reply({ok:false,error:"Marketing department access is denied."},403,origin);
  const cfg=await configRes.json(),script=String(cfg.script_url||"");
  if(!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(script))
   return reply({ok:false,error:"Super Admin has not connected the Marketing Google Sheet yet.",needs_setup:true},503,origin);
  const ctrl=new AbortController(),timeout=setTimeout(()=>ctrl.abort(),28000);
  try{
   const res=await fetch(script,{method:"POST",redirect:"follow",signal:ctrl.signal,
     headers:{"Content-Type":"text/plain;charset=utf-8"},
     body:JSON.stringify({token,action:parsed.action,payload:parsed.payload||{}})});
   const body=await res.text();
   if(!res.ok||body.trim().startsWith("<"))return reply({ok:false,error:"Google Apps Script deployment is not returning the Marketing API."},502,origin);
   let value:any;
   try{value=JSON.parse(body);}catch(_){return reply({ok:false,error:"Invalid Marketing Sheets response."},502,origin);}
   if(!value||typeof value.ok!=="boolean")return reply({ok:false,error:"Malformed Marketing Sheets response."},502,origin);
   return reply(value,value.ok?200:400,origin);
  }finally{clearTimeout(timeout);}
 }catch(err){return reply({ok:false,error:err instanceof Error&&err.name==="AbortError"?"Marketing Google Sheet timed out.":("Marketing connection failed: "+String(err))},502,origin);}
});
