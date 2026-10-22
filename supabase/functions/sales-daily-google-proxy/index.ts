// Authenticated proxy only. Reports and tasks are stored in Google Sheets,
// NEVER in a Supabase database table or Supabase Storage bucket.
const ORIGINS=new Set(["https://harrisho1234-spec.github.io","http://localhost:3000","http://localhost:5173"]);
const permitted=new Set(["ping","read","save_am","submit_am","save_pm","submit_pm","review","carry_forward","weekly","request_edit","decide_edit","delete_report"]);
const asJson=(value,status=200,origin="")=>new Response(JSON.stringify(value),{status,headers:{
 "Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",
 ...(ORIGINS.has(origin)?{"Access-Control-Allow-Origin":origin,"Vary":"Origin"}:{})
}});
Deno.serve(async(req)=>{
 const origin=req.headers.get("origin")||"";
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:{
  "Access-Control-Allow-Origin":ORIGINS.has(origin)?origin:"null",
  "Access-Control-Allow-Methods":"POST,OPTIONS",
  "Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info",
  "Access-Control-Max-Age":"1800","Vary":"Origin"}});
 if(req.method!=="POST")return asJson({error:"POST only"},405,origin);
 if(origin&&!ORIGINS.has(origin))return asJson({error:"Unrecognized site origin"},403,origin);
 const auth=req.headers.get("authorization")||"";
 const jwt=auth.replace(/^Bearer\s+/i,"");
 if(!/^Bearer\s+\S+$/i.test(auth)||!jwt||jwt.length>6000)return asJson({error:"Sign in to use Daily Reports"},401,origin);
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY");
 if(!url||!anon)return asJson({error:"Daily Reports authentication is not configured"},503,origin);
 try{
  const raw=await req.text();
  if(raw.length>45000)return asJson({error:"Daily report request is too large"},413,origin);
  let body;
  try{body=JSON.parse(raw)}catch(_){return asJson({error:"Invalid JSON request"},400,origin)}
  if(!body||typeof body!=="object"||Array.isArray(body)||
     (body.payload!=null&&(typeof body.payload!=="object"||Array.isArray(body.payload))))
   return asJson({error:"Invalid Daily Reports request"},400,origin);
  const action=String(body.action||"");
  if(!permitted.has(action))return asJson({error:"Unknown Daily Reports action"},400,origin);
  const h={apikey:anon,Authorization:"Bearer "+jwt};
  const [identity,config]=await Promise.all([
   fetch(url+"/auth/v1/user",{headers:h}),
   fetch(url+"/rest/v1/rpc/get_sales_daily_connection",{method:"POST",headers:{...h,"Content-Type":"application/json"},body:"{}"})
  ]);
  if(!identity.ok)return asJson({error:"Your login has expired. Please sign in again."},401,origin);
  if(!config.ok)return asJson({error:"Daily Reports access is not enabled for this account"},403,origin);
  const cfg=await config.json(),script=String(cfg.script_url||"");
  if(!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(script))
   return asJson({error:"Google Sheets connection has not been activated by Super Admin.",needs_setup:true},503,origin);
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),28000);
  try{
   const response=await fetch(script,{
    method:"POST",redirect:"follow",signal:ctrl.signal,
    headers:{"Content-Type":"text/plain;charset=utf-8"},
    body:JSON.stringify({token:jwt,action,payload:body.payload||{}})
   });
   const out=await response.text();
   if(!response.ok||out.trim().startsWith("<"))
    return asJson({error:"Google Apps Script is not returning a valid API response. Check deployment access and /exec URL."},502,origin);
   let result;
   try{result=JSON.parse(out)}catch(_){return asJson({error:"Invalid Google Apps Script response. Check deployment."},502,origin)}
   if(!result||typeof result.ok!=="boolean")return asJson({error:"Invalid Google Apps Script response. Check deployment."},502,origin);
   return asJson(result,result.ok===false?400:200,origin);
  }finally{clearTimeout(timer)}
 }catch(err){return asJson({error:err?.name==="AbortError"?"Google Sheets timed out. Please retry.":"Could not connect to Google Sheets: "+String(err?.message||err)},502,origin)}
});
