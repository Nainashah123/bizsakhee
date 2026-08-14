import {
  SetupRequired,
  type SetupStep,
} from "@/components/setup/setup-required";
import type {
  EncryptionConfigState,
  MetaConfigState,
  MetaEnvVar,
} from "@/features/integrations/queries";

/**
 * What is actually missing before a Meta channel can be connected here.
 *
 * Every step carries a `done` flag, so a half-configured deployment shows what
 * is already in place instead of restarting the seller from zero. The variable
 * names are spelled out rather than described, because the person reading this
 * has to type them into a `.env.local` or a Vercel project.
 */

const ENV_HELP: Record<MetaEnvVar, string> = {
  META_APP_ID:
    "App ID from developers.facebook.com > your app > Settings > Basic",
  META_APP_SECRET:
    "App secret from the same page. Server-only - never NEXT_PUBLIC_",
  META_VERIFY_TOKEN:
    "A string you invent, entered identically in the Meta webhook setup",
  META_REDIRECT_URI:
    "Must match the OAuth redirect URI configured on the Meta app exactly",
};

export function channelSetupSteps({
  meta,
  encryption,
}: {
  meta: MetaConfigState;
  encryption: EncryptionConfigState;
}): SetupStep[] {
  const envSteps: SetupStep[] = (Object.keys(ENV_HELP) as MetaEnvVar[]).map(
    (name) => ({
      label: `Set ${name}`,
      detail: ENV_HELP[name],
      done: meta.present.includes(name),
    }),
  );

  return [
    {
      label: "Create a Meta app with WhatsApp and Instagram products",
      detail:
        "developers.facebook.com/apps - a Business-type app, then add WhatsApp and Instagram",
      // Nothing on this deployment can observe whether the app exists, so this
      // is never marked done for us. It is the seller's own checkbox.
      done: false,
    },
    ...envSteps,
    {
      label: "Set INTEGRATION_ENCRYPTION_KEY",
      detail:
        encryption.reason ??
        "32 random bytes, base64 encoded. Access tokens are encrypted with it before they reach the database.",
      done: encryption.configured,
    },
    {
      label: "Restart the app so the new variables are read",
      detail: "pnpm dev - or redeploy on Vercel",
      done: false,
    },
    {
      label: "Submit the Meta app for review",
      detail:
        "Meta reviews whatsapp_business_messaging and instagram_manage_messages by hand. This takes days, it is not automatic, and until it passes only test numbers can be messaged.",
      done: false,
    },
  ];
}

export function ChannelSetupChecklist({
  meta,
  encryption,
}: {
  meta: MetaConfigState;
  encryption: EncryptionConfigState;
}) {
  const missingCount = meta.missing.length + (encryption.configured ? 0 : 1);

  return (
    <SetupRequired
      title="Setup required: connect a Meta app"
      summary={`WhatsApp Business and Instagram messaging both run through one Meta app, and this deployment does not have a complete one yet - ${missingCount} ${missingCount === 1 ? "value is" : "values are"} still missing. Nothing is broken with your workspace, and the rest of BizSakhi keeps working.`}
      steps={channelSetupSteps({ meta, encryption })}
      docsPath="docs/deployment.md"
    />
  );
}
