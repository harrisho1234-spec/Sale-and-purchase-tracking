import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.57.4";

const SOURCE_NAME = "Price Structure V3";
const EXPECTED_SPREADSHEET_ID = "1maKk_lPYMYval44vnorm3_awwrIh5IYPKLovn_gWYtg";
const ALLOWED_GOOGLE_EMAILS = new Set(["harris.ho1234@gmail.com"]);
const MAX_PRODUCTS_PER_REQUEST = 250;

function text(v: unknown): string { return v == null ? "" : String(v).trim(); }
function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number.parseFloat(text(v).replace(/[$€£¥,%\s,]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function imageUrl(v: unknown): string | null {
  const raw = text(v); if (!raw) return null;
  const m = raw.match(/\/d\/([a-zA-Z0-9_-]+)/) || raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m?.[1] ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w600` : raw;
}
function chunks<T>(a: T[], n = 150): T[][] { const out:T[][]=[]; for(let i=0;i<a.length;i+=n) out.push(a.slice(i,i+n)); return out; }
function resp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
function errText(e:any){ if(e instanceof Error)return e.message; try{return JSON.stringify(e)}catch{return String(e)} }

async function verifyGoogleCaller(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return { ok:false as const, status:401, error:"Missing Google access token" };

  const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${m[1]}` }
  });
  if (!r.ok) return { ok:false as const, status:401, error:"Invalid or expired Google access token" };

  const info = await r.json();
  const email = text(info?.email).toLowerCase();
  const verified = info?.email_verified === true || String(info?.email_verified).toLowerCase() === "true";
  if (!verified || !email || !ALLOWED_GOOGLE_EMAILS.has(email)) {
    return { ok:false as const, status:403, error:"Google account is not authorized for product sync" };
  }
  return { ok:true as const, email };
}

function getSecretKey() {
  let secretKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  try {
    const modern = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    if (modern?.default) secretKey = modern.default;
  } catch {}
  return secretKey;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status:204 });
  if (req.method !== "POST") return resp({error:"Method not allowed"},405);

  const caller = await verifyGoogleCaller(req);
  if (!caller.ok) return resp({ok:false,error:caller.error},caller.status);

  let body:any;
  try { body = await req.json(); } catch { return resp({ok:false,error:"Invalid JSON body"},400); }
  if (text(body?.spreadsheet_id) !== EXPECTED_SPREADSHEET_ID) return resp({ok:false,error:"Unexpected spreadsheet source"},403);
  if (body?.mode === "ping") return resp({ok:true,source:SOURCE_NAME,caller:caller.email});

  const secretKey = getSecretKey();
  if (!secretKey) return resp({ok:false,error:"Server database credential is unavailable"},500);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, secretKey, {auth:{persistSession:false,autoRefreshToken:false}});


  if (body?.mode === "pull_stock_balance") {
    const [{data:locations,error:locErr},{data:rows,error:rowErr}] = await Promise.all([
      db.from("stock_locations")
        .select("id,code,name,sort_order")
        .eq("active",true)
        .order("sort_order",{ascending:true})
        .order("code",{ascending:true}),
      db.rpc("stock_sheet_balance_export")
    ]);
    if (locErr) return resp({ok:false,error:locErr.message},500);
    if (rowErr) return resp({ok:false,error:rowErr.message},500);
    return resp({
      ok:true,
      synced_at:new Date().toISOString(),
      locations:locations || [],
      rows:rows || [],
      count:(rows || []).length
    });
  }

  if (body?.mode === "pull_stock_movements") {
    const offset = Math.max(0, Math.round(num(body?.offset) || 0));
    const limit = Math.max(1, Math.min(1000, Math.round(num(body?.limit) || 500)));
    const {data:rows,error} = await db.rpc("stock_sheet_movement_export",{
      p_offset:offset,
      p_limit:limit
    });
    if (error) return resp({ok:false,error:error.message},500);
    return resp({
      ok:true,
      synced_at:new Date().toISOString(),
      rows:rows || [],
      count:(rows || []).length,
      offset,
      next_offset:offset + (rows || []).length,
      has_more:(rows || []).length === limit
    });
  }

  if (body?.mode === "pull_app_changes") {
    const limit = Math.max(1, Math.min(250, Number(body?.limit || 100)));
    const { data: outbox, error: outboxErr } = await db
      .from("product_sheet_outbox")
      .select("product_id,change_token,queued_at,reason")
      .order("queued_at", { ascending:true })
      .limit(limit);
    if (outboxErr) return resp({ok:false,error:outboxErr.message},500);
    if (!outbox?.length) return resp({ok:true,changes:[],count:0});

    const ids = outbox.map((x:any)=>x.product_id);
    const [{data:products,error:pErr},{data:costs,error:cErr}] = await Promise.all([
      db.from("product_catalog").select("id,code,item_name,brand,class,description,location,image_url,stock_qty,sales_price,currency,active,source_row_key").in("id",ids),
      db.from("product_costs").select("product_id,vendor_name,cost_currency,unit_cost,shipping_cost,landed_cost").in("product_id",ids)
    ]);
    if (pErr) return resp({ok:false,error:pErr.message},500);
    if (cErr) return resp({ok:false,error:cErr.message},500);

    const pMap = new Map((products||[]).map((p:any)=>[p.id,p]));
    const cMap = new Map((costs||[]).map((c:any)=>[c.product_id,c]));
    const changes = outbox.map((o:any)=>{
      const p:any = pMap.get(o.product_id);
      if (!p) return null;
      const c:any = cMap.get(o.product_id) || {};
      const sourceKey = text(p.source_row_key);
      const sourceCode = sourceKey.startsWith("app:")
        ? sourceKey.slice(4)
        : (sourceKey.startsWith("price:") ? sourceKey.slice(6) : null);
      return {
        product_id:o.product_id,
        change_token:o.change_token,
        queued_at:o.queued_at,
        reason:o.reason,
        source_code:sourceCode,
        code:p.code,
        item_name:p.item_name,
        brand:p.brand,
        class:p.class,
        description:p.description,
        location:p.location,
        image_url:p.image_url,
        stock_qty:num(p.stock_qty),
        sales_price:num(p.sales_price),
        currency:p.currency || "USD",
        active:p.active !== false,
        vendor_name:c.vendor_name || p.brand || null,
        cost_currency:c.cost_currency || "USD",
        unit_cost:num(c.unit_cost),
        shipping_cost:num(c.shipping_cost),
        landed_cost:num(c.landed_cost),
        sheet_cost:text(c.cost_currency || "USD").toUpperCase() === "USD"
          ? (num(c.landed_cost) > 0 ? num(c.landed_cost) : num(c.unit_cost))
          : 0
      };
    }).filter(Boolean);

    return resp({ok:true,changes,count:changes.length});
  }

  if (body?.mode === "ack_app_changes") {
    const acks = Array.isArray(body?.acks) ? body.acks.slice(0,250) : [];
    if (!acks.length) return resp({ok:false,error:"No acknowledgements supplied"},400);

    let acknowledged = 0;
    let superseded = 0;
    for (const ack of acks) {
      const productId = text(ack?.product_id);
      const token = text(ack?.change_token);
      if (!productId || !token) continue;

      const { data: deleted, error: delErr } = await db
        .from("product_sheet_outbox")
        .delete()
        .eq("product_id", productId)
        .eq("change_token", token)
        .select("product_id");
      if (delErr) return resp({ok:false,error:delErr.message},500);

      if (deleted?.length) {
        const { data: newer, error: newerErr } = await db
          .from("product_sheet_outbox")
          .select("product_id")
          .eq("product_id", productId)
          .maybeSingle();
        if (newerErr) return resp({ok:false,error:newerErr.message},500);

        if (!newer) {
          const { data: currentProduct, error: currentErr } = await db
            .from("product_catalog")
            .select("code")
            .eq("id", productId)
            .maybeSingle();
          if (currentErr) return resp({ok:false,error:currentErr.message},500);
          if (!currentProduct?.code) return resp({ok:false,error:"Product missing while acknowledging App Products sync"},500);

          const { error: updErr } = await db
            .from("product_catalog")
            .update({
              manual_override:false,
              source_system:"app_products_sheet",
              source_row_key:`app:${text(currentProduct.code).toLowerCase()}`,
              source_last_synced_at:new Date().toISOString()
            })
            .eq("id",productId);
          if (updErr) return resp({ok:false,error:updErr.message},500);
        }
        acknowledged++;
      } else {
        superseded++;
      }
    }
    return resp({ok:true,acknowledged,superseded});
  }


  if (body?.mode === "pull_customer_backup") {
    const [
      customersRes,
      crmRes,
      showroomRes,
      onlineRes,
      contactsRes,
      usersRes
    ] = await Promise.all([
      db.from("customers")
        .select("id,customer_code,name,phone,email,address,assigned_sales_id,active,notes,customer_since,created_at,updated_at")
        .order("created_at", { ascending:true }),
      db.from("customer_leads")
        .select("id,customer_code,customer_name,phone,normalized_phone,customer_category,business_code,stage,first_contact_date,last_contact_date,first_activity_type,last_activity_type,first_source,last_source,interest,next_follow_up_date,notes,latest_remark,assigned_sales_id,linked_customer_id,created_at,updated_at")
        .order("created_at", { ascending:true }),
      db.from("customer_activity")
        .select("id,activity_date,business_code,customer_name,phone,customer_type,source_channel,status,interest,remark,follow_up_date,assigned_sales_id,lead_id,linked_customer_id,created_by,created_at,updated_at")
        .eq("activity_type","showroom_visit")
        .order("created_at", { ascending:true }),
      db.from("customer_activity")
        .select("id,activity_date,business_code,customer_name,phone,customer_type,source_channel,status,interest,remark,follow_up_date,assigned_sales_id,lead_id,linked_customer_id,created_by,created_at,updated_at")
        .eq("activity_type","online")
        .order("created_at", { ascending:true }),
      db.from("customer_contacts")
        .select("id,customer_id,contact_type,label,contact_value,is_primary,created_at,updated_at")
        .order("created_at", { ascending:true }),
      db.from("app_users")
        .select("user_id,display_name,email")
    ]);

    for (const r of [customersRes,crmRes,showroomRes,onlineRes,contactsRes,usersRes]) {
      if (r.error) return resp({ok:false,error:r.error.message},500);
    }

    const userMap = new Map((usersRes.data || []).map((u:any)=>[
      u.user_id,
      text(u.display_name) || text(u.email) || null
    ]));
    const customers = (customersRes.data || []).map((r:any)=>({
      ...r,
      assigned_sales_name:r.assigned_sales_id ? (userMap.get(r.assigned_sales_id) || null) : null
    }));
    const customerMap = new Map(customers.map((r:any)=>[
      r.id,
      {customer_code:r.customer_code || null, customer_name:r.name || null}
    ]));
    const withOwner = (rows:any[]) => (rows || []).map((r:any)=>({
      ...r,
      assigned_sales_name:r.assigned_sales_id ? (userMap.get(r.assigned_sales_id) || null) : null
    }));
    const contacts = (contactsRes.data || []).map((r:any)=>({
      ...r,
      customer_code:customerMap.get(r.customer_id)?.customer_code || null,
      customer_name:customerMap.get(r.customer_id)?.customer_name || null
    }));

    return resp({
      ok:true,
      customers,
      crm:withOwner(crmRes.data || []),
      showroom:withOwner(showroomRes.data || []),
      online:withOwner(onlineRes.data || []),
      contacts
    });
  }


  if (body?.mode === "begin_customer_history_sync") {
    const activityType = text(body?.activity_type);
    if (!["showroom_visit","online"].includes(activityType)) {
      return resp({ok:false,error:"Invalid customer history activity type"},400);
    }
    return resp({
      ok:true,
      activity_type:activityType,
      batch_id:crypto.randomUUID(),
      caller:caller.email
    });
  }

  if (body?.mode === "push_customer_history_index") {
    const activityType = text(body?.activity_type);
    const batchId = text(body?.batch_id);
    const rows = Array.isArray(body?.rows) ? body.rows.slice(0,500) : [];
    if (!["showroom_visit","online"].includes(activityType)) {
      return resp({ok:false,error:"Invalid customer history activity type"},400);
    }
    if (!batchId || !rows.length) {
      return resp({ok:false,error:"Customer history batch_id and rows are required"},400);
    }

    const { data:users, error:userErr } = await db
      .from("app_users")
      .select("user_id,display_name,email")
      .eq("active",true);
    if (userErr) return resp({ok:false,error:userErr.message},500);

    const byEmail = new Map<string,string>();
    const userNames = (users || []).map((u:any)=>({
      id:u.user_id,
      name:text(u.display_name),
      norm:text(u.display_name).toLowerCase().replace(/[^a-z0-9]+/g," ").trim()
    }));
    for (const u of users || []) {
      const email = text(u.email).toLowerCase();
      if (email && !byEmail.has(email)) byEmail.set(email,u.user_id);
    }
    const resolveUserId = (emailRaw:any,nameRaw:any) => {
      const email=text(emailRaw).toLowerCase();
      if (email && byEmail.has(email)) return byEmail.get(email) || null;
      const n=text(nameRaw).toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
      if (!n) return null;
      const exact=userNames.find((u:any)=>u.norm===n);
      if (exact) return exact.id;
      const candidates=userNames.filter((u:any)=>{
        if (!u.norm) return false;
        if (u.norm.endsWith(" "+n) || u.norm.startsWith(n+" ")) return true;
        if (n.length>=4 && u.norm.includes(n)) return true;
        return u.norm.split(" ").includes(n);
      });
      return candidates.length===1 ? candidates[0].id : null;
    };

    const clean:any[] = [];
    for (const rawRow of rows) {
      const identityKey = text(rawRow?.identity_key);
      const periodMonth = text(rawRow?.period_month);
      const latestActivityDate = text(rawRow?.latest_activity_date);
      if (!identityKey || !periodMonth || !latestActivityDate) continue;

      const assignedSalesId = resolveUserId(rawRow?.assigned_sales_email,rawRow?.assigned_sales_name);
      const businessRaw = text(rawRow?.business_code).toUpperCase();
      const businessCode = ["RK","TK"].includes(businessRaw) ? businessRaw : "OTHER";

      clean.push({
        batch_id:batchId,
        activity_type:activityType,
        period_month:periodMonth,
        identity_key:identityKey,
        normalized_phone:text(rawRow?.normalized_phone) || null,
        customer_name:text(rawRow?.customer_name) || null,
        business_code:businessCode,
        customer_type:text(rawRow?.customer_type) || null,
        source_channel:text(rawRow?.source_channel) || null,
        latest_stage:text(rawRow?.latest_stage) || null,
        latest_activity_date:latestActivityDate,
        entry_count:Math.max(1,Math.round(num(rawRow?.entry_count) || 1)),
        latest_interest:text(rawRow?.latest_interest) || null,
        latest_follow_up_date:text(rawRow?.latest_follow_up_date) || null,
        assigned_sales_id:assignedSalesId,
        assigned_sales_name:text(rawRow?.assigned_sales_name) || null,
        assigned_sales_email:text(rawRow?.assigned_sales_email) || null,
        source_counts:(rawRow?.source_counts && typeof rawRow.source_counts === "object") ? rawRow.source_counts : {},
        interest_counts:(rawRow?.interest_counts && typeof rawRow.interest_counts === "object") ? rawRow.interest_counts : {},
        activity_events:Array.isArray(rawRow?.activity_events)
          ? rawRow.activity_events.slice(0,100).map((e:any)=>({
              date:text(e?.date),
              business_code:["RK","TK"].includes(text(e?.business_code).toUpperCase()) ? text(e?.business_code).toUpperCase() : businessCode,
              stage:text(e?.stage)||null,
              source:text(e?.source)||null,
              interest:text(e?.interest)||null,
              sales:text(e?.sales)||null
            })).filter((e:any)=>/^\d{4}-\d{2}-\d{2}$/.test(e.date))
          : [],
        source_sheet:text(rawRow?.source_sheet) || null
      });
    }

    if (!clean.length) return resp({ok:true,received:rows.length,upserted:0});

    const { error:upsertErr } = await db
      .from("customer_history_monthly_index")
      .upsert(clean,{onConflict:"batch_id,activity_type,period_month,identity_key,business_code"});
    if (upsertErr) return resp({ok:false,error:upsertErr.message},500);

    return resp({ok:true,received:rows.length,upserted:clean.length});
  }

  if (body?.mode === "finalize_customer_history_sync") {
    const activityType = text(body?.activity_type);
    const batchId = text(body?.batch_id);
    if (!["showroom_visit","online"].includes(activityType) || !batchId) {
      return resp({ok:false,error:"Invalid customer history finalize request"},400);
    }

    const { count:indexedCount, error:countErr } = await db
      .from("customer_history_monthly_index")
      .select("id",{count:"exact",head:true})
      .eq("activity_type",activityType)
      .eq("batch_id",batchId);
    if (countErr) return resp({ok:false,error:countErr.message},500);

    const sourceRowCount = Math.max(0,Math.round(num(body?.source_row_count)));
    const { error:stateErr } = await db
      .from("customer_history_sync_state")
      .upsert({
        activity_type:activityType,
        current_batch_id:batchId,
        last_synced_at:new Date().toISOString(),
        source_row_count:sourceRowCount,
        indexed_row_count:indexedCount || 0,
        source_spreadsheet_id:text(body?.source_spreadsheet_id) || null,
        synced_by:caller.email
      },{onConflict:"activity_type"});
    if (stateErr) return resp({ok:false,error:stateErr.message},500);

    const { error:deleteErr } = await db
      .from("customer_history_monthly_index")
      .delete()
      .eq("activity_type",activityType)
      .neq("batch_id",batchId);
    if (deleteErr) return resp({ok:false,error:deleteErr.message},500);

    return resp({
      ok:true,
      activity_type:activityType,
      batch_id:batchId,
      indexed_rows:indexedCount || 0,
      source_rows:sourceRowCount
    });
  }

  // Product push: update matching IDs, never insert-first on an existing code.
  // A single bad product must not prevent unrelated products syncing.
  const products = Array.isArray(body?.products) ? body.products : [];
  if (!products.length) return resp({ok:false,error:"No products supplied"},400);
  if (products.length > MAX_PRODUCTS_PER_REQUEST)
    return resp({ok:false,error:"Maximum " + MAX_PRODUCTS_PER_REQUEST + " products per request"},413);

  const {data:log,error:logErr} = await db.from("legacy_sync_log").insert({
    source_name:SOURCE_NAME+" secure push",status:"running",
    message:"Push by "+caller.email
  }).select("id").single();
  if(logErr) console.warn("Could not open product sync audit log:",logErr.code);
  let done=0,created=0,updated=0,skipped=0,conflicted=0,failed=0;
  const seen=products.length;
  const issues:any[]=[];
  try {
    const unique=new Map<string,any>();
    for (const raw of products) {
      const code=text(raw?.code);
      if (!code) {
        issues.push({code:"(blank)",status:"conflict",reason:"Product Code is blank"});
        conflicted++;
        continue;
      }
      unique.set(code.toLowerCase(),{
        code,
        item_name:text(raw?.item_name)||code,
        brand:text(raw?.brand)||null,
        class:text(raw?.class)||null,
        description:text(raw?.description)||null,
        location:text(raw?.location)||null,
        image_url:imageUrl(raw?.image_url),
        stock_qty:num(raw?.stock_qty),
        sales_price:num(raw?.sales_price),
        cost:num(raw?.cost),
        vendor:text(raw?.vendor||raw?.brand)||null
      });
    }
    for (const batch of chunks([...unique.values()],150)) {
      const {data:result,error:syncError}=await db.rpc(
        "sync_price_structure_products_safe",{p_products:batch}
      );
      if(syncError) throw syncError;
      if(!result || typeof result !== "object")
        throw new Error("Product sync database function returned no result.");
      created+=Number(result.created||0);
      updated+=Number(result.updated||0);
      skipped+=Number(result.skipped||0);
      conflicted+=Number(result.conflicted||0);
      failed+=Number(result.failed||0);
      done+=Number(result.upserted||0);
      issues.push(...(Array.isArray(result.issues)?result.issues:[]));
    }
    const resultStatus=(conflicted>0||failed>0)?"partial_success":"success";
    const description=done+" products synced ("+created+" created, "+updated+" updated); "+
      skipped+" protected, "+conflicted+" conflicts, "+failed+" failed; by "+caller.email;
    if(log?.id) await db.from("legacy_sync_log").update({
      sync_finished_at:new Date().toISOString(),rows_seen:seen,
      rows_upserted:done,status:resultStatus,message:description
    }).eq("id",log.id);
    return resp({
      ok:true,received:seen,upserted:done,created,updated,
      skipped_app_managed:skipped,conflicted,failed,
      issues:issues.slice(0,60),has_more_issues:issues.length>60
    });
  } catch(e) {
    const msg=errText(e);
    if(log?.id) await db.from("legacy_sync_log").update({
      sync_finished_at:new Date().toISOString(),rows_seen:seen,
      rows_upserted:done,status:"error",message:msg.slice(0,1000)
    }).eq("id",log.id);
    return resp({ok:false,received:seen,upserted:done,error:msg},500);
  }

});
