// Company Daily Work relay; JWT and Google Sheets access are independently
// verified. No task/report data is stored in Supabase.
const ORIGINS=new Set(["https://harrisho1234-spec.github.io","http://localhost:3000","http://localhost:5173"]);
const ACTIONS=new Set(["company_list","company_save_task","company_decide_request","company_submit_am","company_submit_pm","company_review","company_allow_late_pm"]);
function reply(data:unknown,status=200,origin=""){
 return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...(ORIGINS.has(origin)?{"Access-Control-Allow-Origin":origin,"Vary":"Origin"}:{})}});
}
Deno.serve(async req=>{
 const origin=req.headers.get("origin")||"";
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":ORIGINS.has(origin)?origin:"null","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS","Access-Control-Max-Age":"1800","Vary":"Origin"}});
 if(req.method!=="POST")return reply({ok:false,error:"POST only"},405,origin);
 if(origin&&!ORIGINS.has(origin))return reply({ok:false,error:"Unrecognized site"},403,origin);
 const auth=req.headers.get("authorization")||"",token=auth.replace(/^Bearer\s+/i,"");
 if(!/^Bearer\s+\S+$/i.test(auth)||token.length<20||token.length>6000)return reply({ok:false,error:"Sign in to Daily Work"},401,origin);
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_ANON_KEY");
 if(!url||!key)return reply({ok:false,error:"Authentication unavailable"},503,origin);
 try{
  const raw=await req.text();
  if(raw.length>45000)return reply({ok:false,error:"Request too large"},413,origin);
  let body:any;
  try{body=JSON.parse(raw)}catch(_){return reply({ok:false,error:"Invalid request JSON"},400,origin)}
  if(!body||typeof body!=="object"||Array.isArray(body)||!ACTIONS.has(String(body.action||""))||
    (body.payload!=null&&(typeof body.payload!=="object"||Array.isArray(body.payload))))
    return reply({ok:false,error:"Invalid Daily Work action"},400,origin);
  const headers={apikey:key,Authorization:"Bearer "+token};
  const [identity,config]=await Promise.all([
   fetch(url+"/auth/v1/user",{headers}),
   fetch(url+"/rest/v1/rpc/get_company_daily_connection",{method:"POST",headers:{...headers,"Content-Type":"application/json"},body:"{}"})
  ]);
  if(!identity.ok)return reply({ok:false,error:"Session expired"},401,origin);
  if(!config.ok)return reply({ok:false,error:"Daily Work role not authorized"},403,origin);
  const cfg=await config.json(),script=String(cfg.script_url||"");
  if(!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(script))
   return reply({ok:false,error:"Google Sheets connection not configured",needs_setup:true},503,origin);
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),28000);
  try{
   const res=await fetch(script,{method:"POST",redirect:"follow",signal:ctrl.signal,
    headers:{"Content-Type":"text/plain;charset=utf-8"},
    body:JSON.stringify({token,action:body.action,payload:body.payload||{}})});
   const bodyText=await res.text();
   if(!res.ok||bodyText.trim().startsWith("<"))
    return reply({ok:false,error:"Google Apps Script must be redeployed with CompanyDaily.gs."},502,origin);
   let parsed:any;try{parsed=JSON.parse(bodyText)}catch(_){return reply({ok:false,error:"Invalid Google Apps Script response"},502,origin)}
   if(!parsed||typeof parsed.ok!=="boolean")return reply({ok:false,error:"Malformed Google Apps Script response"},502,origin);
   return reply(parsed,parsed.ok?200:400,origin);
  }finally{clearTimeout(timer)}
 }catch(err){return reply({ok:false,error:err instanceof Error&&err.name==="AbortError"?"Google Sheet connection timed out":"Daily Work connection failed: "+String(err)},502,origin)}
});