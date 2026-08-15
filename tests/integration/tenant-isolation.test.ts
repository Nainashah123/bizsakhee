// @vitest-environment node
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Cross-workspace isolation, against a real database.
 *
 * This is the test the whole tenancy model rests on. Every other guarantee in
 * the product assumes that one seller cannot see or touch another seller's
 * customers, orders and products - and RLS policies are easy to write in a way
 * that looks right and is not.
 *
 * So this exercises the real thing: two real users, two real workspaces, each
 * acting through the publishable key exactly as a browser does, with RLS
 * enforced. Nothing is mocked. The service-role client appears only to create
 * the fixtures and to prove the rows genuinely exist when a tenant cannot see
 * them - otherwise "zero rows" would be indistinguishable from "the insert
 * silently failed".
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const canRun = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);

const PASSWORD = "IsolationTest!2026";

type Tenant = {
  email: string;
  userId: string;
  workspaceId: string;
  contactId: string;
  productId: string;
  /** Signed in with the publishable key, so RLS applies exactly as in a browser. */
  client: SupabaseClient;
};

let admin: SupabaseClient;
let alice: Tenant;
let bob: Tenant;

function uniqueEmail(prefix: string): string {
  const noise = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${noise}@bizsakhi-isolation.invalid`;
}

/** Creates a confirmed user, a workspace they own, and one contact + product. */
async function createTenant(prefix: string): Promise<Tenant> {
  const email = uniqueEmail(prefix);

  const { data: created, error: userError } = await admin.auth.admin.createUser(
    {
      email,
      password: PASSWORD,
      email_confirm: true,
    },
  );
  if (userError || !created.user) {
    throw new Error(`createUser failed: ${userError?.message}`);
  }
  const userId = created.user.id;

  const slug = `iso-${Math.random().toString(36).slice(2, 10)}`;
  const { data: workspace, error: workspaceError } = await admin
    .from("workspaces")
    .insert({ name: `${prefix} workspace`, slug, owner_id: userId })
    .select("id")
    .single();
  if (workspaceError || !workspace) {
    throw new Error(`workspace insert failed: ${workspaceError?.message}`);
  }

  const { error: memberError } = await admin
    .from("workspace_members")
    .insert({ workspace_id: workspace.id, user_id: userId, role: "owner" });
  if (memberError)
    throw new Error(`member insert failed: ${memberError.message}`);

  const { data: contact, error: contactError } = await admin
    .from("contacts")
    .insert({
      workspace_id: workspace.id,
      full_name: `${prefix} Secret Customer`,
      phone_normalized: `9199${Math.floor(10000000 + Math.random() * 89999999)}`,
    })
    .select("id")
    .single();
  if (contactError || !contact) {
    throw new Error(`contact insert failed: ${contactError?.message}`);
  }

  const { data: product, error: productError } = await admin
    .from("products")
    .insert({
      workspace_id: workspace.id,
      name: `${prefix} Secret Product`,
      slug: `secret-${Math.random().toString(36).slice(2, 10)}`,
      price_minor: 123400,
      // Published on purpose: only the workspace opting its catalogue in should
      // make it publicly visible, not the product's own status.
      status: "published",
    })
    .select("id")
    .single();
  if (productError || !product) {
    throw new Error(`product insert failed: ${productError?.message}`);
  }

  const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (signInError) throw new Error(`sign in failed: ${signInError.message}`);

  return {
    email,
    userId,
    workspaceId: workspace.id,
    contactId: contact.id,
    productId: product.id,
    client,
  };
}

beforeAll(async () => {
  if (!canRun) return;

  admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  [alice, bob] = await Promise.all([
    createTenant("alice"),
    createTenant("bob"),
  ]);
}, 60_000);

afterAll(async () => {
  if (!canRun || !admin) return;

  // Deleting the users cascades to workspaces and everything below them.
  for (const tenant of [alice, bob]) {
    if (tenant?.userId) {
      await admin.auth.admin.deleteUser(tenant.userId).catch(() => {});
    }
  }
}, 60_000);

describe.skipIf(!canRun)("cross-workspace isolation", () => {
  it("sets up two distinct tenants", () => {
    expect(alice.workspaceId).not.toBe(bob.workspaceId);
    expect(alice.userId).not.toBe(bob.userId);
  });

  it("the fixtures really exist, so an empty read means RLS and not a failed insert", async () => {
    const { data, error } = await admin
      .from("contacts")
      .select("id")
      .in("workspace_id", [alice.workspaceId, bob.workspaceId]);

    expect(error).toBeNull();
    expect(data).toHaveLength(2);
  });

  it("Alice cannot list Bob's contacts", async () => {
    const { data, error } = await alice.client
      .from("contacts")
      .select("id, full_name")
      .eq("workspace_id", bob.workspaceId);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("Alice cannot fetch Bob's contact even by its exact id", async () => {
    const { data } = await alice.client
      .from("contacts")
      .select("id, full_name")
      .eq("id", bob.contactId);

    // Knowing the primary key must not be enough - this is the IDOR case.
    expect(data).toEqual([]);
  });

  it("an unfiltered read returns only Alice's own rows", async () => {
    const { data, error } = await alice.client.from("contacts").select("id");

    expect(error).toBeNull();
    expect(data?.map((row) => row.id)).toEqual([alice.contactId]);
  });

  it("Alice cannot update Bob's contact", async () => {
    const { data } = await alice.client
      .from("contacts")
      .update({ full_name: "Owned by Alice" })
      .eq("id", bob.contactId)
      .select("id");

    // RLS filters the row out, so the update matches nothing.
    expect(data ?? []).toEqual([]);

    const { data: check } = await admin
      .from("contacts")
      .select("full_name")
      .eq("id", bob.contactId)
      .single();

    expect(check?.full_name).toContain("bob");
  });

  it("Alice cannot delete Bob's contact", async () => {
    await alice.client.from("contacts").delete().eq("id", bob.contactId);

    const { data } = await admin
      .from("contacts")
      .select("id")
      .eq("id", bob.contactId)
      .maybeSingle();

    expect(data?.id).toBe(bob.contactId);
  });

  it("Alice cannot insert a row into Bob's workspace", async () => {
    const { error } = await alice.client.from("contacts").insert({
      workspace_id: bob.workspaceId,
      full_name: "Planted by Alice",
    });

    expect(error).not.toBeNull();

    const { count } = await admin
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", bob.workspaceId);

    expect(count).toBe(1);
  });

  it("Alice cannot see Bob's products or workspace", async () => {
    const products = await alice.client
      .from("products")
      .select("id")
      .eq("id", bob.productId);
    expect(products.data).toEqual([]);

    const workspaces = await alice.client
      .from("workspaces")
      .select("id")
      .eq("id", bob.workspaceId);
    expect(workspaces.data).toEqual([]);

    const members = await alice.client
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", bob.workspaceId);
    expect(members.data).toEqual([]);
  });

  it("Alice cannot make herself a member of Bob's workspace", async () => {
    const { error } = await alice.client.from("workspace_members").insert({
      workspace_id: bob.workspaceId,
      user_id: alice.userId,
      role: "owner",
    });

    expect(error).not.toBeNull();
  });

  it("Alice cannot grant her own workspace a paid plan", async () => {
    // subscriptions has no client-writable policy: billing state comes from
    // Stripe webhooks running as the service role, never from a browser.
    const { data } = await alice.client
      .from("subscriptions")
      .update({ plan: "pro", status: "active" })
      .eq("workspace_id", alice.workspaceId)
      .select("plan");

    expect(data ?? []).toEqual([]);

    const { data: check } = await admin
      .from("subscriptions")
      .select("plan")
      .eq("workspace_id", alice.workspaceId)
      .single();

    expect(check?.plan).toBe("free");
  });

  it("an anonymous visitor sees no contacts at all", async () => {
    const anon = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data } = await anon.from("contacts").select("id");
    expect(data ?? []).toEqual([]);
  });

  it("a published product stays private until the workspace opts its catalogue in", async () => {
    const anon = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const before = await anon
      .from("products")
      .select("id")
      .eq("id", bob.productId);
    expect(before.data).toEqual([]);

    await admin
      .from("workspaces")
      .update({ is_catalogue_public: true })
      .eq("id", bob.workspaceId);

    const after = await anon
      .from("products")
      .select("id")
      .eq("id", bob.productId);
    expect(after.data?.map((row) => row.id)).toEqual([bob.productId]);

    // Even with the catalogue open, the customer list stays private.
    const contacts = await anon
      .from("contacts")
      .select("id")
      .eq("workspace_id", bob.workspaceId);
    expect(contacts.data ?? []).toEqual([]);
  });

  it("webhook_events and audit logs are unreachable from a browser", async () => {
    const webhooks = await alice.client.from("webhook_events").select("id");
    expect(webhooks.data ?? []).toEqual([]);

    const audits = await alice.client
      .from("audit_logs")
      .select("id")
      .eq("workspace_id", bob.workspaceId);
    expect(audits.data ?? []).toEqual([]);
  });
});
