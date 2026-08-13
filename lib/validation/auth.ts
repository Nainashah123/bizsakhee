import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Email is required")
  .max(254, "Email is too long")
  .pipe(z.email("Enter a valid email address"))
  .transform((value) => value.toLowerCase());

/**
 * Length is the requirement that actually matters; composition rules push
 * people towards predictable substitutions. Supabase enforces its own minimum
 * too, so this is the stricter of the two.
 */
export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(72, "Password must be 72 characters or fewer");

export const signUpSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Tell us your name")
    .max(80, "Name is too long"),
  email: emailSchema,
  password: passwordSchema,
  redirectTo: z.string().optional(),
});

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password"),
  redirectTo: z.string().optional(),
});

export const magicLinkSchema = z.object({
  email: emailSchema,
  redirectTo: z.string().optional(),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type MagicLinkInput = z.infer<typeof magicLinkSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
