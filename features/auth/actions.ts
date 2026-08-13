"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { absoluteUrl } from "@/lib/env";
import { logger } from "@/lib/logger";
import { safeRedirect } from "@/lib/auth/redirect";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import type { Result } from "@/lib/result";
import { createClient } from "@/lib/supabase/server";
import { parseFormData } from "@/lib/validation/form";
import {
  forgotPasswordSchema,
  magicLinkSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from "@/lib/validation/auth";

export type AuthState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  message?: string;
};

const GENERIC_CREDENTIALS_ERROR =
  "That email and password combination did not work.";

async function clientKey(scope: string, identifier: string): Promise<string> {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || "unknown";
  return `${scope}:${ip}:${identifier}`;
}

function toState(result: Result<unknown>): AuthState {
  if (result.ok) return {};
  return { error: result.error.message, fieldErrors: result.error.fieldErrors };
}

/**
 * Register with email and password. Supabase sends the verification email; we
 * never reveal whether an address was already registered.
 */
export async function signUpAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = parseFormData(signUpSchema, formData);
  if (!parsed.ok) return toState(parsed);

  const { email, password, fullName, redirectTo } = parsed.data;
  const destination = safeRedirect(redirectTo, "/onboarding");

  const limit = rateLimit(
    await clientKey("signup", email),
    RATE_LIMITS.auth.limit,
    RATE_LIMITS.auth.windowMs,
  );
  if (!limit.allowed) {
    return { error: "Too many attempts. Please try again in a few minutes." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: absoluteUrl(
        `/auth/callback?next=${encodeURIComponent(destination)}`,
      ),
    },
  });

  if (error) {
    logger.warn("sign_up_failed", { code: error.code });
    return { error: "We could not create that account. Please try again." };
  }

  // A confirmed session means email confirmation is switched off in Supabase.
  if (data.session) redirect(destination);

  return {
    message:
      "Check your inbox - we sent a link to confirm your email address. It expires in one hour.",
  };
}

export async function signInAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = parseFormData(signInSchema, formData);
  if (!parsed.ok) return toState(parsed);

  const { email, password, redirectTo } = parsed.data;

  const limit = rateLimit(
    await clientKey("signin", email),
    RATE_LIMITS.auth.limit,
    RATE_LIMITS.auth.windowMs,
  );
  if (!limit.allowed) {
    return { error: "Too many attempts. Please try again in a few minutes." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    logger.info("sign_in_failed", { code: error.code });
    // Identical message for wrong password and unknown account.
    return { error: GENERIC_CREDENTIALS_ERROR };
  }

  revalidatePath("/", "layout");
  redirect(safeRedirect(redirectTo));
}

export async function magicLinkAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = parseFormData(magicLinkSchema, formData);
  if (!parsed.ok) return toState(parsed);

  const { email, redirectTo } = parsed.data;
  const destination = safeRedirect(redirectTo);

  const limit = rateLimit(
    await clientKey("magic", email),
    RATE_LIMITS.auth.limit,
    RATE_LIMITS.auth.windowMs,
  );
  if (!limit.allowed) {
    return { error: "Too many attempts. Please try again in a few minutes." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: absoluteUrl(
        `/auth/callback?next=${encodeURIComponent(destination)}`,
      ),
    },
  });

  if (error) {
    logger.warn("magic_link_failed", { code: error.code });
  }

  // Same response either way: an attacker must not learn which emails exist.
  return {
    message: "If that email has an account, a sign-in link is on its way.",
  };
}

export async function forgotPasswordAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = parseFormData(forgotPasswordSchema, formData);
  if (!parsed.ok) return toState(parsed);

  const { email } = parsed.data;

  const limit = rateLimit(
    await clientKey("forgot", email),
    RATE_LIMITS.auth.limit,
    RATE_LIMITS.auth.windowMs,
  );
  if (!limit.allowed) {
    return { error: "Too many attempts. Please try again in a few minutes." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: absoluteUrl("/auth/callback?next=/reset-password"),
  });

  if (error) {
    logger.warn("password_reset_request_failed", { code: error.code });
  }

  return {
    message: "If that email has an account, a reset link is on its way.",
  };
}

/** Runs after the reset link has established a recovery session. */
export async function resetPasswordAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = parseFormData(resetPasswordSchema, formData);
  if (!parsed.ok) return toState(parsed);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      error: "This reset link has expired. Request a new one and try again.",
    };
  }

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });

  if (error) {
    logger.warn("password_reset_failed", { code: error.code });
    return { error: "We could not update that password. Please try again." };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signOutAction(): Promise<never> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) logger.warn("sign_out_failed", { code: error.code });
  revalidatePath("/", "layout");
  redirect("/login");
}
