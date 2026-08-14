/**
 * Meta webhook payload -> normalised events.
 *
 * The payloads below are shaped exactly as Meta documents them, including the
 * fields we ignore, because the point of this module is surviving a real
 * delivery rather than a tidy one.
 *
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest";

import {
  metaEventKey,
  metaEventType,
  normalizeMetaWebhook,
} from "@/lib/integrations/meta/normalize";

const PHONE_NUMBER_ID = "106540352242922";
const WABA_ID = "102290129340398";
const IG_ACCOUNT_ID = "17841400000000000";
const CUSTOMER_WA_ID = "919812345678";
const CUSTOMER_IGSID = "6789012345678901";

/** 2025-08-13T16:00:00Z, in the units each product uses. */
const SECONDS = 1_755_100_800;
const MILLISECONDS = SECONDS * 1000;
const ISO = "2025-08-13T16:00:00.000Z";

/** Fixed clock, so a payload without a timestamp is still deterministic. */
const RECEIVED_AT = new Date("2026-01-01T00:00:00.000Z");
const options = { receivedAt: RECEIVED_AT };

function whatsappTextPayload() {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: WABA_ID,
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "919876543210",
                phone_number_id: PHONE_NUMBER_ID,
              },
              contacts: [{ profile: { name: "Meera" }, wa_id: CUSTOMER_WA_ID }],
              messages: [
                {
                  from: CUSTOMER_WA_ID,
                  id: "wamid.HBgMOTE5ODEyMzQ1Njc4FQIAEhggM0E1RjA",
                  timestamp: String(SECONDS),
                  text: { body: "Do you have this in red?" },
                  type: "text",
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe("normalizeMetaWebhook - WhatsApp", () => {
  it("normalises a text message", () => {
    const result = normalizeMetaWebhook(whatsappTextPayload(), options);

    expect(result.skipped).toBe(0);
    expect(result.events).toEqual([
      {
        kind: "message",
        channel: "whatsapp",
        accountId: PHONE_NUMBER_ID,
        providerMessageId: "wamid.HBgMOTE5ODEyMzQ1Njc4FQIAEhggM0E1RjA",
        senderId: CUSTOMER_WA_ID,
        senderName: "Meera",
        threadId: CUSTOMER_WA_ID,
        timestamp: ISO,
        messageType: "text",
        text: "Do you have this in red?",
      },
    ]);
  });

  it("routes by phone_number_id, not by the WABA id in the entry", () => {
    // Getting this wrong would route a message to the wrong tenant.
    const [event] = normalizeMetaWebhook(whatsappTextPayload(), options).events;
    expect(event.accountId).toBe(PHONE_NUMBER_ID);
    expect(event.accountId).not.toBe(WABA_ID);
  });

  it("drops a message that carries no phone_number_id", () => {
    const payload = whatsappTextPayload();
    delete (payload.entry[0].changes[0].value as { metadata?: unknown })
      .metadata;

    const result = normalizeMetaWebhook(payload, options);
    expect(result.events).toHaveLength(0);
    expect(result.skipped).toBe(1);
  });

  it("reads the caption of a media message and labels the type", () => {
    const payload = whatsappTextPayload();
    payload.entry[0].changes[0].value.messages = [
      {
        from: CUSTOMER_WA_ID,
        id: "wamid.IMAGE",
        timestamp: String(SECONDS),
        type: "image",
        image: { caption: "This one please", mime_type: "image/jpeg" },
      },
    ] as never;

    const [event] = normalizeMetaWebhook(payload, options).events;
    expect(event).toMatchObject({
      messageType: "image",
      text: "This one please",
    });
  });

  it("keeps a media message with no caption, with a null body", () => {
    const payload = whatsappTextPayload();
    payload.entry[0].changes[0].value.messages = [
      {
        from: CUSTOMER_WA_ID,
        id: "wamid.AUDIO",
        timestamp: String(SECONDS),
        type: "audio",
        audio: { id: "media-id", mime_type: "audio/ogg" },
      },
    ] as never;

    const [event] = normalizeMetaWebhook(payload, options).events;
    expect(event).toMatchObject({ messageType: "audio", text: null });
  });

  it("classifies a delivery callback as a status, not a message", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: WABA_ID,
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "919876543210",
                  phone_number_id: PHONE_NUMBER_ID,
                },
                statuses: [
                  {
                    id: "wamid.OUTBOUND1",
                    status: "delivered",
                    timestamp: String(SECONDS),
                    recipient_id: CUSTOMER_WA_ID,
                    conversation: { id: "conv-1", origin: { type: "service" } },
                    pricing: { billable: true, category: "service" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const result = normalizeMetaWebhook(payload, options);

    expect(result.events).toEqual([
      {
        kind: "status",
        channel: "whatsapp",
        accountId: PHONE_NUMBER_ID,
        providerMessageId: "wamid.OUTBOUND1",
        status: "delivered",
        timestamp: ISO,
        recipientId: CUSTOMER_WA_ID,
        errorCode: null,
      },
    ]);
    // Explicitly: nothing here may be mistaken for an inbound message.
    expect(result.events.every((event) => event.kind === "status")).toBe(true);
  });

  it("carries the error code of a failed status", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: WABA_ID,
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: PHONE_NUMBER_ID },
                statuses: [
                  {
                    id: "wamid.OUTBOUND2",
                    status: "failed",
                    timestamp: String(SECONDS),
                    recipient_id: CUSTOMER_WA_ID,
                    errors: [
                      {
                        code: 131047,
                        title:
                          "Message failed to send because more than 24 hours have passed",
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const [event] = normalizeMetaWebhook(payload, options).events;
    expect(event).toMatchObject({
      kind: "status",
      status: "failed",
      errorCode: "131047",
    });
  });

  it("skips statuses and fields it does not handle", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: WABA_ID,
          changes: [
            {
              field: "message_template_status_update",
              value: { event: "APPROVED", message_template_name: "welcome" },
            },
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: PHONE_NUMBER_ID },
                statuses: [
                  { id: "wamid.X", status: "deleted", timestamp: "1755100800" },
                ],
              },
            },
          ],
        },
      ],
    };

    const result = normalizeMetaWebhook(payload, options);
    expect(result.events).toHaveLength(0);
    expect(result.skipped).toBe(2);
  });
});

describe("normalizeMetaWebhook - Instagram", () => {
  it("normalises a direct message", () => {
    const payload = {
      object: "instagram",
      entry: [
        {
          id: IG_ACCOUNT_ID,
          time: MILLISECONDS,
          messaging: [
            {
              sender: { id: CUSTOMER_IGSID },
              recipient: { id: IG_ACCOUNT_ID },
              timestamp: MILLISECONDS,
              message: {
                mid: "aWdfZAG1faXRlbToxOklHTWVzc2FnZUlE",
                text: "Is the blue saree still available?",
              },
            },
          ],
        },
      ],
    };

    const result = normalizeMetaWebhook(payload, options);

    expect(result.events).toEqual([
      {
        kind: "message",
        channel: "instagram",
        accountId: IG_ACCOUNT_ID,
        providerMessageId: "aWdfZAG1faXRlbToxOklHTWVzc2FnZUlE",
        senderId: CUSTOMER_IGSID,
        senderName: null,
        threadId: CUSTOMER_IGSID,
        // Instagram sends milliseconds where WhatsApp sends seconds.
        timestamp: ISO,
        messageType: "text",
        text: "Is the blue saree still available?",
      },
    ]);
  });

  it("skips an echo of our own outbound message", () => {
    const payload = {
      object: "instagram",
      entry: [
        {
          id: IG_ACCOUNT_ID,
          messaging: [
            {
              sender: { id: IG_ACCOUNT_ID },
              recipient: { id: CUSTOMER_IGSID },
              timestamp: MILLISECONDS,
              message: {
                mid: "aWdfZAG1faXRlbToxOkVDSE8",
                text: "Yes, it is!",
                is_echo: true,
              },
            },
          ],
        },
      ],
    };

    const result = normalizeMetaWebhook(payload, options);
    expect(result.events).toHaveLength(0);
    expect(result.skipped).toBe(1);
  });

  it("classifies read and delivery callbacks as statuses", () => {
    const payload = {
      object: "instagram",
      entry: [
        {
          id: IG_ACCOUNT_ID,
          messaging: [
            {
              sender: { id: CUSTOMER_IGSID },
              recipient: { id: IG_ACCOUNT_ID },
              timestamp: MILLISECONDS,
              delivery: { mids: ["mid.one", "mid.two"] },
            },
            {
              sender: { id: CUSTOMER_IGSID },
              recipient: { id: IG_ACCOUNT_ID },
              timestamp: MILLISECONDS,
              read: { mid: "mid.one" },
            },
          ],
        },
      ],
    };

    const result = normalizeMetaWebhook(payload, options);

    expect(result.events.map((event) => event.kind)).toEqual([
      "status",
      "status",
      "status",
    ]);
    expect(
      result.events.map((event) =>
        event.kind === "status"
          ? `${event.providerMessageId}:${event.status}`
          : "message",
      ),
    ).toEqual(["mid.one:delivered", "mid.two:delivered", "mid.one:read"]);
  });

  it("skips reactions and postbacks", () => {
    const payload = {
      object: "instagram",
      entry: [
        {
          id: IG_ACCOUNT_ID,
          messaging: [
            {
              sender: { id: CUSTOMER_IGSID },
              recipient: { id: IG_ACCOUNT_ID },
              timestamp: MILLISECONDS,
              reaction: { mid: "mid.one", action: "react", emoji: "❤" },
            },
          ],
        },
      ],
    };

    const result = normalizeMetaWebhook(payload, options);
    expect(result.events).toHaveLength(0);
    expect(result.skipped).toBe(1);
  });
});

describe("normalizeMetaWebhook - batches and garbage", () => {
  it("returns every event in a batched delivery", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: WABA_ID,
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: PHONE_NUMBER_ID },
                contacts: [
                  { profile: { name: "Meera" }, wa_id: "919812345678" },
                ],
                messages: [
                  {
                    from: "919812345678",
                    id: "wamid.A",
                    timestamp: String(SECONDS),
                    type: "text",
                    text: { body: "First" },
                  },
                  {
                    from: "919812345678",
                    id: "wamid.B",
                    timestamp: String(SECONDS + 60),
                    type: "text",
                    text: { body: "Second" },
                  },
                ],
              },
            },
          ],
        },
        {
          id: WABA_ID,
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: PHONE_NUMBER_ID },
                messages: [
                  {
                    from: "919700000000",
                    id: "wamid.C",
                    timestamp: String(SECONDS + 120),
                    type: "text",
                    text: { body: "Third, different customer" },
                  },
                ],
                statuses: [
                  {
                    id: "wamid.OUT",
                    status: "read",
                    timestamp: String(SECONDS + 130),
                    recipient_id: "919812345678",
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const result = normalizeMetaWebhook(payload, options);

    expect(result.events).toHaveLength(4);
    expect(result.events.map((event) => event.providerMessageId)).toEqual([
      "wamid.A",
      "wamid.B",
      "wamid.C",
      "wamid.OUT",
    ]);
    // Two customers, so two threads.
    const threads = result.events
      .filter((event) => event.kind === "message")
      .map((event) => (event.kind === "message" ? event.threadId : ""));
    expect(new Set(threads).size).toBe(2);
  });

  it("keeps the good events when one item in a batch is malformed", () => {
    const payload = whatsappTextPayload();
    payload.entry[0].changes[0].value.messages = [
      { from: CUSTOMER_WA_ID, timestamp: String(SECONDS), type: "text" }, // no id
      payload.entry[0].changes[0].value.messages[0],
    ] as never;

    const result = normalizeMetaWebhook(payload, options);
    expect(result.events).toHaveLength(1);
    expect(result.skipped).toBe(1);
  });

  it("returns an empty result for anything unrecognisable, without throwing", () => {
    const garbage: unknown[] = [
      null,
      undefined,
      "",
      "not json at all",
      42,
      [],
      {},
      { entry: null },
      { entry: "nope" },
      { entry: [] },
      { object: "page", entry: [{ id: "1" }] },
      { entry: [{ changes: "nope" }] },
      { entry: [{ changes: [{ field: "messages", value: null }] }] },
      { entry: [{ messaging: [{ sender: {} }] }] },
      { entry: [{ id: 12345, changes: [] }] },
    ];

    for (const payload of garbage) {
      expect(() => normalizeMetaWebhook(payload, options)).not.toThrow();
      expect(normalizeMetaWebhook(payload, options).events).toHaveLength(0);
    }
  });

  it("falls back to the received time when a timestamp is absent or absurd", () => {
    for (const timestamp of [undefined, "not-a-number", "0", -5]) {
      const payload = whatsappTextPayload();
      const [message] = payload.entry[0].changes[0].value.messages;
      (message as { timestamp?: unknown }).timestamp = timestamp;

      const [event] = normalizeMetaWebhook(payload, options).events;
      expect(event.timestamp).toBe(RECEIVED_AT.toISOString());
    }
  });
});

describe("metaEventKey", () => {
  it("is stable for the same message and unique per status", () => {
    const { events } = normalizeMetaWebhook(whatsappTextPayload(), options);
    const again = normalizeMetaWebhook(whatsappTextPayload(), options).events;

    expect(metaEventKey(events[0])).toBe(metaEventKey(again[0]));
    expect(metaEventKey(events[0])).toContain("whatsapp:msg:");
  });

  it("separates sent, delivered and read for one message id", () => {
    // Keying a status only on the message id would swallow every callback
    // after the first.
    const keys = (["sent", "delivered", "read"] as const).map((status) =>
      metaEventKey({
        kind: "status",
        channel: "whatsapp",
        accountId: PHONE_NUMBER_ID,
        providerMessageId: "wamid.SAME",
        status,
        timestamp: ISO,
        recipientId: null,
        errorCode: null,
      }),
    );

    expect(new Set(keys).size).toBe(3);
  });

  it("separates the two channels", () => {
    const whatsapp = metaEventKey({
      kind: "status",
      channel: "whatsapp",
      accountId: "a",
      providerMessageId: "same-id",
      status: "read",
      timestamp: ISO,
      recipientId: null,
      errorCode: null,
    });
    const instagram = metaEventKey({
      kind: "status",
      channel: "instagram",
      accountId: "a",
      providerMessageId: "same-id",
      status: "read",
      timestamp: ISO,
      recipientId: null,
      errorCode: null,
    });

    expect(whatsapp).not.toBe(instagram);
  });
});

describe("metaEventType", () => {
  it("describes the event without identifying anyone", () => {
    const { events } = normalizeMetaWebhook(whatsappTextPayload(), options);
    const type = metaEventType(events[0]);

    expect(type).toBe("whatsapp.message.text");
    expect(type).not.toContain(CUSTOMER_WA_ID);
  });
});
