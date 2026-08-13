/**
 * Database types.
 *
 * These are hand-maintained to match `supabase/migrations/*.sql` because the
 * generator (`pnpm db:types`) needs a running Postgres, which is not available
 * in this environment yet. Once a Supabase project or local Docker instance
 * exists, run `pnpm db:types` and this file is replaced wholesale by the
 * generated output.
 *
 * Until then two rules apply:
 *   1. Change a migration, change this file in the same commit.
 *   2. Do not use PostgREST embedded selects (`select("a, other_table(b)")`) -
 *      resolving those needs generated `Relationships` metadata. Query the
 *      second table separately instead.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/** Insert shape: `Required` keys are mandatory, everything else optional. */
type TableDef<Row, Required extends keyof Row> = {
  Row: Row;
  Insert: Pick<Row, Required> & Partial<Omit<Row, Required>>;
  Update: Partial<Row>;
  Relationships: [];
};

export type WorkspaceRoleEnum = "owner" | "admin" | "member";
export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";
export type ContactStatusEnum = "active" | "archived";
export type ChannelKind =
  | "whatsapp"
  | "instagram"
  | "phone"
  | "email"
  | "other";
export type TaskStatusEnum = "open" | "completed" | "cancelled";
export type TaskPriority = "low" | "normal" | "high";
export type ProductStatus = "draft" | "published" | "archived";
export type StockStatus = "in_stock" | "made_to_order" | "out_of_stock";
export type OrderStatus =
  | "draft"
  | "confirmed"
  | "in_progress"
  | "ready"
  | "fulfilled"
  | "cancelled";
export type PaymentStatusEnum =
  | "unpaid"
  | "partially_paid"
  | "paid"
  | "refunded";
export type PaymentMethod =
  | "cash"
  | "upi"
  | "bank_transfer"
  | "card"
  | "cod"
  | "other";
export type ConversationChannel = "whatsapp" | "instagram" | "manual";
export type ConversationStatus = "open" | "snoozed" | "closed";
export type MessageDirection = "inbound" | "outbound";
export type MessageStatus =
  | "pending"
  | "sent"
  | "delivered"
  | "read"
  | "failed";
export type AiTool = "smart_reply" | "content_generator";
export type ContentDraftStatus = "draft" | "approved" | "discarded";
export type IntegrationProvider = "whatsapp" | "instagram";
export type IntegrationStatus =
  | "not_configured"
  | "pending"
  | "connected"
  | "error"
  | "disconnected";
export type PlanKey = "free" | "starter" | "growth" | "pro";
export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "unpaid"
  | "paused";
export type WebhookSource = "stripe" | "meta";
export type WebhookProcessStatus = "received" | "processed" | "failed";

type Timestamps = { created_at: string; updated_at: string };

export type ProfileRow = {
  id: string;
  full_name: string | null;
  avatar_path: string | null;
  phone: string | null;
  preferred_language: string;
  onboarded_at: string | null;
} & Timestamps;

export type WorkspaceRow = {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  currency: string;
  country: string;
  timezone: string;
  is_catalogue_public: boolean;
} & Timestamps;

export type WorkspaceMemberRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  role: WorkspaceRoleEnum;
} & Timestamps;

export type BusinessProfileRow = {
  workspace_id: string;
  business_name: string;
  category: string;
  description: string | null;
  city: string | null;
  country: string;
  primary_channel: ChannelKind;
  whatsapp_number: string | null;
  instagram_handle: string | null;
  logo_path: string | null;
} & Timestamps;

export type WorkspaceInvitationRow = {
  id: string;
  workspace_id: string;
  email: string;
  role: WorkspaceRoleEnum;
  status: InvitationStatus;
  token_hash: string;
  invited_by: string | null;
  expires_at: string;
  accepted_at: string | null;
} & Timestamps;

export type ContactRow = {
  id: string;
  workspace_id: string;
  full_name: string;
  phone_normalized: string | null;
  phone_display: string | null;
  email: string | null;
  email_normalized: string | null;
  city: string | null;
  lead_source: string | null;
  status: ContactStatusEnum;
  assigned_to: string | null;
  next_follow_up_at: string | null;
  last_contacted_at: string | null;
  notes_summary: string | null;
  created_by: string | null;
} & Timestamps;

export type ContactChannelRow = {
  id: string;
  workspace_id: string;
  contact_id: string;
  kind: ChannelKind;
  handle: string;
  is_primary: boolean;
} & Timestamps;

export type TagRow = {
  id: string;
  workspace_id: string;
  name: string;
  color: string;
  created_at: string;
};

export type ContactTagRow = {
  workspace_id: string;
  contact_id: string;
  tag_id: string;
  created_at: string;
};

export type PipelineRow = {
  id: string;
  workspace_id: string;
  name: string;
  is_default: boolean;
} & Timestamps;

export type PipelineStageRow = {
  id: string;
  workspace_id: string;
  pipeline_id: string;
  name: string;
  position: number;
  is_won: boolean;
  is_lost: boolean;
} & Timestamps;

export type OpportunityRow = {
  id: string;
  workspace_id: string;
  pipeline_id: string;
  stage_id: string;
  contact_id: string | null;
  title: string;
  value_minor: number;
  currency: string;
  expected_close_on: string | null;
  assigned_to: string | null;
  position: number;
  closed_at: string | null;
  created_by: string | null;
} & Timestamps;

export type TaskRow = {
  id: string;
  workspace_id: string;
  title: string;
  description: string | null;
  status: TaskStatusEnum;
  priority: TaskPriority;
  due_at: string | null;
  contact_id: string | null;
  order_id: string | null;
  opportunity_id: string | null;
  assigned_to: string | null;
  completed_at: string | null;
  reminder_sent_at: string | null;
  created_by: string | null;
} & Timestamps;

export type NoteRow = {
  id: string;
  workspace_id: string;
  contact_id: string | null;
  opportunity_id: string | null;
  body: string;
  created_by: string | null;
} & Timestamps;

export type ProductRow = {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  description: string | null;
  sku: string | null;
  price_minor: number;
  sale_price_minor: number | null;
  currency: string;
  stock_status: StockStatus;
  stock_quantity: number | null;
  status: ProductStatus;
  position: number;
  created_by: string | null;
} & Timestamps;

export type ProductVariantRow = {
  id: string;
  workspace_id: string;
  product_id: string;
  name: string;
  sku: string | null;
  price_minor: number | null;
  stock_quantity: number | null;
  position: number;
} & Timestamps;

export type ProductImageRow = {
  id: string;
  workspace_id: string;
  product_id: string;
  storage_path: string;
  alt_text: string | null;
  width: number | null;
  height: number | null;
  byte_size: number | null;
  mime_type: string;
  position: number;
  created_at: string;
};

export type OrderRow = {
  id: string;
  workspace_id: string;
  order_number: number;
  contact_id: string | null;
  status: OrderStatus;
  payment_status: PaymentStatusEnum;
  currency: string;
  subtotal_minor: number;
  discount_minor: number;
  tax_minor: number;
  shipping_minor: number;
  total_minor: number;
  amount_paid_minor: number;
  tax_basis_points: number;
  notes: string | null;
  due_on: string | null;
  invoice_token_hash: string | null;
  fulfilled_at: string | null;
  cancelled_at: string | null;
  created_by: string | null;
} & Timestamps;

export type OrderItemRow = {
  id: string;
  workspace_id: string;
  order_id: string;
  product_id: string | null;
  variant_id: string | null;
  description: string;
  quantity: number;
  unit_price_minor: number;
  line_total_minor: number;
  position: number;
} & Timestamps;

export type PaymentRow = {
  id: string;
  workspace_id: string;
  order_id: string;
  amount_minor: number;
  currency: string;
  method: PaymentMethod;
  reference: string | null;
  paid_at: string;
  recorded_by: string | null;
} & Timestamps;

export type ConversationRow = {
  id: string;
  workspace_id: string;
  contact_id: string | null;
  channel: ConversationChannel;
  external_thread_id: string | null;
  status: ConversationStatus;
  subject: string | null;
  last_message_at: string | null;
  customer_window_expires_at: string | null;
  unread_count: number;
  assigned_to: string | null;
} & Timestamps;

export type ConversationParticipantRow = {
  id: string;
  workspace_id: string;
  conversation_id: string;
  contact_id: string | null;
  user_id: string | null;
  display_name: string | null;
  created_at: string;
};

export type MessageRow = {
  id: string;
  workspace_id: string;
  conversation_id: string;
  direction: MessageDirection;
  status: MessageStatus;
  body: string | null;
  external_message_id: string | null;
  template_name: string | null;
  sent_by: string | null;
  ai_generation_id: string | null;
  error_code: string | null;
  sent_at: string;
  delivered_at: string | null;
  read_at: string | null;
} & Timestamps;

export type MessageAttachmentRow = {
  id: string;
  workspace_id: string;
  message_id: string;
  storage_path: string;
  mime_type: string;
  byte_size: number | null;
  file_name: string | null;
  created_at: string;
};

export type MessageTemplateRow = {
  id: string;
  workspace_id: string;
  name: string;
  channel: ConversationChannel;
  body: string;
  provider_template_name: string | null;
  language: string;
  is_active: boolean;
  created_by: string | null;
} & Timestamps;

export type AiGenerationRow = {
  id: string;
  workspace_id: string;
  user_id: string | null;
  tool: AiTool;
  provider: string;
  model: string;
  input_summary: Json;
  output: Json | null;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  succeeded: boolean;
  error_code: string | null;
  created_at: string;
};

export type ContentDraftRow = {
  id: string;
  workspace_id: string;
  product_id: string | null;
  ai_generation_id: string | null;
  platform: string;
  objective: string | null;
  language: string;
  tone: string | null;
  hook: string | null;
  caption: string;
  call_to_action: string | null;
  hashtags: string[];
  whatsapp_message: string | null;
  status: ContentDraftStatus;
  is_ai_generated: boolean;
  approved_by: string | null;
  approved_at: string | null;
  created_by: string | null;
} & Timestamps;

export type IntegrationRow = {
  id: string;
  workspace_id: string;
  provider: IntegrationProvider;
  status: IntegrationStatus;
  external_account_id: string | null;
  display_name: string | null;
  phone_number_id: string | null;
  waba_id: string | null;
  instagram_user_id: string | null;
  scopes: string[];
  access_token_ciphertext: string | null;
  refresh_token_ciphertext: string | null;
  token_expires_at: string | null;
  last_error: string | null;
  connected_at: string | null;
  connected_by: string | null;
} & Timestamps;

export type IntegrationEventRow = {
  id: string;
  workspace_id: string | null;
  integration_id: string | null;
  provider: IntegrationProvider;
  event_type: string;
  summary: Json;
  succeeded: boolean;
  error_message: string | null;
  created_at: string;
};

export type WebhookEventRow = {
  id: string;
  source: WebhookSource;
  external_event_id: string;
  event_type: string;
  status: WebhookProcessStatus;
  workspace_id: string | null;
  error_message: string | null;
  received_at: string;
  processed_at: string | null;
};

export type SubscriptionRow = {
  id: string;
  workspace_id: string;
  plan: PlanKey;
  status: SubscriptionStatus;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  interval: "month" | "year" | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  trial_ends_at: string | null;
  payment_failed_at: string | null;
} & Timestamps;

export type UsageCounterRow = {
  id: string;
  workspace_id: string;
  metric: string;
  period: string;
  used: number;
} & Timestamps;

export type NotificationRow = {
  id: string;
  workspace_id: string;
  user_id: string | null;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  read_at: string | null;
  created_at: string;
};

export type AuditLogRow = {
  id: string;
  workspace_id: string | null;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Json;
  created_at: string;
};

export type OrderCounterRow = {
  workspace_id: string;
  last_number: number;
};

export type Database = {
  public: {
    Tables: {
      profiles: TableDef<ProfileRow, "id">;
      workspaces: TableDef<WorkspaceRow, "name" | "slug" | "owner_id">;
      workspace_members: TableDef<
        WorkspaceMemberRow,
        "workspace_id" | "user_id"
      >;
      business_profiles: TableDef<
        BusinessProfileRow,
        "workspace_id" | "business_name" | "category"
      >;
      workspace_invitations: TableDef<
        WorkspaceInvitationRow,
        "workspace_id" | "email" | "token_hash"
      >;
      contacts: TableDef<ContactRow, "workspace_id" | "full_name">;
      contact_channels: TableDef<
        ContactChannelRow,
        "workspace_id" | "contact_id" | "kind" | "handle"
      >;
      tags: TableDef<TagRow, "workspace_id" | "name">;
      contact_tags: TableDef<
        ContactTagRow,
        "workspace_id" | "contact_id" | "tag_id"
      >;
      pipelines: TableDef<PipelineRow, "workspace_id" | "name">;
      pipeline_stages: TableDef<
        PipelineStageRow,
        "workspace_id" | "pipeline_id" | "name" | "position"
      >;
      opportunities: TableDef<
        OpportunityRow,
        "workspace_id" | "pipeline_id" | "stage_id" | "title"
      >;
      tasks: TableDef<TaskRow, "workspace_id" | "title">;
      notes: TableDef<NoteRow, "workspace_id" | "body">;
      products: TableDef<ProductRow, "workspace_id" | "name" | "slug">;
      product_variants: TableDef<
        ProductVariantRow,
        "workspace_id" | "product_id" | "name"
      >;
      product_images: TableDef<
        ProductImageRow,
        "workspace_id" | "product_id" | "storage_path" | "mime_type"
      >;
      // order_number is issued by a database trigger, so it stays optional on
      // insert - which TableDef already gives us for every non-required key.
      orders: TableDef<OrderRow, "workspace_id">;
      order_items: TableDef<
        OrderItemRow,
        | "workspace_id"
        | "order_id"
        | "description"
        | "quantity"
        | "unit_price_minor"
        | "line_total_minor"
      >;
      payments: TableDef<
        PaymentRow,
        "workspace_id" | "order_id" | "amount_minor"
      >;
      conversations: TableDef<ConversationRow, "workspace_id" | "channel">;
      conversation_participants: TableDef<
        ConversationParticipantRow,
        "workspace_id" | "conversation_id"
      >;
      messages: TableDef<
        MessageRow,
        "workspace_id" | "conversation_id" | "direction"
      >;
      message_attachments: TableDef<
        MessageAttachmentRow,
        "workspace_id" | "message_id" | "storage_path" | "mime_type"
      >;
      message_templates: TableDef<
        MessageTemplateRow,
        "workspace_id" | "name" | "body"
      >;
      ai_generations: TableDef<
        AiGenerationRow,
        "workspace_id" | "tool" | "provider" | "model"
      >;
      content_drafts: TableDef<
        ContentDraftRow,
        "workspace_id" | "platform" | "caption"
      >;
      integrations: TableDef<IntegrationRow, "workspace_id" | "provider">;
      integration_events: TableDef<
        IntegrationEventRow,
        "provider" | "event_type"
      >;
      webhook_events: TableDef<
        WebhookEventRow,
        "source" | "external_event_id" | "event_type"
      >;
      subscriptions: TableDef<SubscriptionRow, "workspace_id">;
      usage_counters: TableDef<
        UsageCounterRow,
        "workspace_id" | "metric" | "period"
      >;
      notifications: TableDef<NotificationRow, "workspace_id" | "kind" | "title">;
      audit_logs: TableDef<AuditLogRow, "action" | "entity_type">;
      order_counters: TableDef<OrderCounterRow, "workspace_id">;
    };
    Views: Record<never, never>;
    Functions: {
      allocate_workspace_slug: {
        Args: { desired: string };
        Returns: string;
      };
      consume_usage: {
        Args: {
          target_workspace: string;
          target_metric: string;
          target_period: string;
          max_allowed: number;
          amount?: number;
        };
        Returns: number | null;
      };
      is_workspace_member: { Args: { target_workspace: string }; Returns: boolean };
      is_workspace_admin: { Args: { target_workspace: string }; Returns: boolean };
      is_workspace_owner: { Args: { target_workspace: string }; Returns: boolean };
      next_order_number: { Args: { target_workspace: string }; Returns: number };
      recalculate_order_payment: { Args: { target_order: string }; Returns: void };
    };
    Enums: {
      workspace_role: WorkspaceRoleEnum;
      invitation_status: InvitationStatus;
      contact_status: ContactStatusEnum;
      channel_kind: ChannelKind;
      task_status: TaskStatusEnum;
      task_priority: TaskPriority;
      product_status: ProductStatus;
      stock_status: StockStatus;
      order_status: OrderStatus;
      payment_status: PaymentStatusEnum;
      payment_method: PaymentMethod;
      conversation_channel: ConversationChannel;
      conversation_status: ConversationStatus;
      message_direction: MessageDirection;
      message_status: MessageStatus;
      ai_tool: AiTool;
      content_draft_status: ContentDraftStatus;
      integration_provider: IntegrationProvider;
      integration_status: IntegrationStatus;
      plan_key: PlanKey;
      subscription_status: SubscriptionStatus;
      webhook_source: WebhookSource;
      webhook_process_status: WebhookProcessStatus;
    };
    CompositeTypes: Record<never, never>;
  };
};
