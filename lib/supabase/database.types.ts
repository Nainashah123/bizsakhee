/**
 * Generated Supabase types.
 *
 * Regenerate with:  pnpm db:types
 * (requires `supabase start` / a linked project)
 *
 * This placeholder keeps the app type-safe-by-default before the first
 * generation run; it is overwritten wholesale by the generator.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
