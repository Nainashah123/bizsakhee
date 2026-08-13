import { describe, expect, it } from "vitest";

import {
  atLeast,
  can,
  CAPABILITIES,
  isRole,
  ROLE_CAPABILITIES,
  WORKSPACE_ROLES,
} from "@/lib/permissions";

describe("role capabilities", () => {
  it("gives owners every capability", () => {
    for (const capability of CAPABILITIES) {
      expect(can("owner", capability)).toBe(true);
    }
  });

  it("keeps billing and destructive settings away from admins", () => {
    expect(can("admin", "billing.manage")).toBe(false);
    expect(can("admin", "workspace.delete")).toBe(false);
    expect(can("admin", "admins.manage")).toBe(false);
  });

  it("lets admins run the day-to-day workspace", () => {
    expect(can("admin", "members.manage")).toBe(true);
    expect(can("admin", "products.write")).toBe(true);
    expect(can("admin", "integrations.manage")).toBe(true);
    expect(can("admin", "ai.use")).toBe(true);
  });

  it("limits members to operational work", () => {
    expect(can("member", "contacts.write")).toBe(true);
    expect(can("member", "orders.write")).toBe(true);
    expect(can("member", "tasks.write")).toBe(true);
    expect(can("member", "conversations.write")).toBe(true);

    expect(can("member", "billing.manage")).toBe(false);
    expect(can("member", "workspace.settings")).toBe(false);
    expect(can("member", "workspace.delete")).toBe(false);
    expect(can("member", "members.manage")).toBe(false);
    expect(can("member", "integrations.manage")).toBe(false);
  });

  it("never grants a lower role more than a higher one", () => {
    for (const capability of CAPABILITIES) {
      if (can("member", capability))
        expect(can("admin", capability)).toBe(true);
      if (can("admin", capability)) expect(can("owner", capability)).toBe(true);
    }
  });

  it("defines a capability list for every role", () => {
    for (const role of WORKSPACE_ROLES) {
      expect(ROLE_CAPABILITIES[role].length).toBeGreaterThan(0);
    }
  });
});

describe("atLeast", () => {
  it("ranks owner above admin above member", () => {
    expect(atLeast("owner", "admin")).toBe(true);
    expect(atLeast("admin", "admin")).toBe(true);
    expect(atLeast("member", "admin")).toBe(false);
    expect(atLeast("admin", "owner")).toBe(false);
  });
});

describe("isRole", () => {
  it("rejects values that are not workspace roles", () => {
    expect(isRole("owner")).toBe(true);
    expect(isRole("superuser")).toBe(false);
    expect(isRole("")).toBe(false);
  });
});
