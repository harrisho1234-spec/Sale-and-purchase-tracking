import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const systemRoles = ["sales","accountant","stock_controller","project","project_manager","marketing","marketing_manager","product_assistant","product_manager","stock_manager","manager","admin","super_admin"];

function roleSlug(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 36) || "role";
}

async function resolveOrCreateRole(admin: any, roleInput: string, baseRoleInput: string, callerId: string, callerIsSuper = true) {
  const { data: roleRows, error: rolesError } = await admin
    .from("app_access_role_templates")
    .select("role_key,display_name,base_role,permissions,restrict_assigned_customers,active")
    .eq("active", true);

  if (rolesError) throw new Error(rolesError.message);
  const roles = roleRows || [];
  const wanted = String(roleInput || "").trim();
  if (!wanted) throw new Error("Role is required");

  let role = roles.find((r: any) =>
    String(r.role_key || "").toLowerCase() === wanted.toLowerCase() ||
    String(r.display_name || "").toLowerCase() === wanted.toLowerCase()
  );
  if (role) return role;
  if (!callerIsSuper) throw new Error('New role templates require Super Admin');

  if (wanted.length < 2 || wanted.length > 60) throw new Error("Custom role name must be 2–60 characters");

  let baseRole = String(baseRoleInput || "sales").trim();
  if (!systemRoles.includes(baseRole) || baseRole === "super_admin") baseRole = "sales";
  const base = roles.find((r: any) => r.role_key === baseRole);
  if (!base) throw new Error("Base role template not found");

  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const roleKey = "custom_" + roleSlug(wanted) + "_" + suffix;

  const { data: created, error: createRoleError } = await admin
    .from("app_access_role_templates")
    .insert({
      role_key: roleKey,
      display_name: wanted,
      base_role: baseRole,
      permissions: base.permissions || {},
      restrict_assigned_customers: !!base.restrict_assigned_customers,
      active: true,
      updated_by: callerId,
      updated_at: new Date().toISOString(),
    })
    .select("role_key,display_name,base_role,permissions,restrict_assigned_customers,active")
    .single();

  if (createRoleError || !created) throw new Error(createRoleError?.message || "Could not create custom role");
  await admin.from("app_access_audit").insert({
    target_type: "role",
    target_key: roleKey,
    before_state: null,
    after_state: created,
    changed_by: callerId,
  });
  return created;
}


Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: callerData, error: callerError } = await admin.auth.getUser(token);
    if (callerError || !callerData.user) return json({ error: "Invalid session" }, 401);

    const { data: callerProfile, error: callerProfileError } = await admin
      .from("app_users")
      .select("role, active, access_role_key")
      .eq("user_id", callerData.user.id)
      .maybeSingle();

    const callerIsSuper=callerProfile?.role==="super_admin";
    const callerIsAdmin=callerProfile?.role==="admin";
    if(callerProfileError||!callerProfile||!callerProfile.active||(!callerIsSuper&&!callerIsAdmin))
      return json({error:"User & Access permission required"},403);
    const {data:template}=await admin.from("app_access_role_templates")
      .select("permissions").eq("role_key",callerProfile.access_role_key||callerProfile.role).eq("active",true).maybeSingle();
    const {data:override}=await admin.from("app_user_access_overrides")
      .select("permissions").eq("user_id",callerData.user.id).maybeSingle();
    const permission=override?.permissions&&Object.prototype.hasOwnProperty.call(override.permissions,"users.manage")
      ?override.permissions["users.manage"]:template?.permissions?.["users.manage"];
    if(!callerIsSuper&&permission!==true)return json({error:"User & Access permission required"},403);
    const {data:adminTemplate}=callerIsAdmin
      ?await admin.from("app_access_role_templates").select("permissions").eq("role_key","admin").single()
      :{data:null};
    const protectedKeys=new Set(["users.manage","activity_logs.view","products.delete","products.tax_manage"]);

    const body = await req.json();
    const action = String(body.action || "").trim();
    const userId = String(body.user_id || "").trim();
    if (!userId) return json({ error: "User ID is required" }, 400);

    const { data: targetResult, error: targetError } = await admin.auth.admin.getUserById(userId);
    if (targetError || !targetResult.user) return json({ error: targetError?.message || "User not found" }, 404);
    const target = targetResult.user;
    const {data:targetProfile,error:targetProfileError}=await admin.from("app_users")
      .select("role").eq("user_id",userId).maybeSingle();
    if(callerIsAdmin && (targetProfileError || !targetProfile ||
       ["admin","super_admin"].includes(targetProfile.role) || userId===callerData.user.id)) {
      return json({error:"Admin cannot manage Admin, Super Admin, self, or unassigned accounts"},403);
    }

    if (action === "reset_password") {
      if (userId === callerData.user.id) {
        return json({ error: "Use Change My Password for your own account" }, 400);
      }
      const password = String(body.password || "");
      if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);

      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) return json({ error: error.message }, 400);
      return json({ success: true, action: "password_reset" });
    }

    if (action === "update_user") {
      const name = String(body.name || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const roleInput = String(body.role || "").trim();
      const baseRoleInput = String(body.base_role || "sales").trim();
      const active = body.active !== false;

      if (!name) return json({ error: "Name is required" }, 400);
      if (!email || !email.includes("@")) return json({ error: "Valid email is required" }, 400);

      const roleTemplate = await resolveOrCreateRole(admin, roleInput, baseRoleInput, callerData.user.id, callerIsSuper);
      if(callerIsAdmin &&
        (["admin","super_admin"].includes(roleTemplate.base_role) ||
         Object.entries(roleTemplate.permissions||{}).some(([key,value])=>
           value===true && (protectedKeys.has(key)||adminTemplate?.permissions?.[key]!==true))))
        return json({error:"Admin cannot assign privileged roles or permissions"},403);
      if (userId === callerData.user.id && (roleTemplate.role_key !== "super_admin" || active !== true)) {
        return json({ error: "You cannot demote or deactivate your own Super Admin account" }, 400);
      }

      const authPatch: Record<string, unknown> = {
        user_metadata: { ...(target.user_metadata || {}), display_name: name },
      };
      if (String(target.email || "").toLowerCase() !== email) {
        authPatch.email = email;
        authPatch.email_confirm = true;
      }

      const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(userId, authPatch);
      if (updateError || !updated.user) return json({ error: updateError?.message || "Could not update login" }, 400);

      const { error: profileError } = await admin
        .from("app_users")
        .update({ display_name: name, email, role: roleTemplate.base_role, access_role_key: roleTemplate.role_key, active, updated_at: new Date().toISOString() })
        .eq("user_id", userId);

      if (profileError) return json({ error: profileError.message }, 500);

      return json({
        success: true,
        action: "user_updated",
        user: { id: userId, email, display_name: name, role: roleTemplate.role_key, role_name: roleTemplate.display_name, system_role: roleTemplate.base_role, active },
      });
    }

    return json({ error: "Invalid action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});