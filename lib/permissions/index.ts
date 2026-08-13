/**
 * Role capabilities.
 *
 * One central definition, consulted server-side before every protected
 * operation. The UI may hide a control, but hiding is never the check.
 */

export const WORKSPACE_ROLES = ["owner", "admin", "member"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const CAPABILITIES = [
  "workspace.delete",
  "workspace.settings",
  "billing.manage",
  "admins.manage",
  "members.manage",
  "integrations.manage",
  "products.write",
  "catalogue.publish",
  "contacts.write",
  "orders.write",
  "tasks.write",
  "conversations.write",
  "ai.use",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const MEMBER_CAPABILITIES: readonly Capability[] = [
  "contacts.write",
  "orders.write",
  "tasks.write",
  "conversations.write",
];

const ADMIN_CAPABILITIES: readonly Capability[] = [
  ...MEMBER_CAPABILITIES,
  "workspace.settings",
  "members.manage",
  "integrations.manage",
  "products.write",
  "catalogue.publish",
  "ai.use",
];

const OWNER_CAPABILITIES: readonly Capability[] = [
  ...ADMIN_CAPABILITIES,
  "workspace.delete",
  "billing.manage",
  "admins.manage",
];

export const ROLE_CAPABILITIES: Record<WorkspaceRole, readonly Capability[]> = {
  owner: OWNER_CAPABILITIES,
  admin: ADMIN_CAPABILITIES,
  member: MEMBER_CAPABILITIES,
};

export function can(role: WorkspaceRole, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}

export function isRole(value: string): value is WorkspaceRole {
  return (WORKSPACE_ROLES as readonly string[]).includes(value);
}

const ROLE_RANK: Record<WorkspaceRole, number> = {
  member: 1,
  admin: 2,
  owner: 3,
};

/** True when `role` is at least as privileged as `minimum`. */
export function atLeast(role: WorkspaceRole, minimum: WorkspaceRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};
