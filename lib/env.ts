import { z } from "zod";

const EnvSchema = z.object({
  ENDPOINT: z.string().min(1),
  PROJECT_ID: z.string().min(1),
  API_KEY: z.string().min(1),
  DATABASE_ID: z.string().min(1),
  PATIENT_COLLECTION_ID: z.string().min(1),
  APPOINTMENT_COLLECTION_ID: z.string().min(1),
  BUCKET_ID: z.string().min(1),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

/**
 * Lazily parsed, validated server env. Not evaluated at import time so that
 * `next build` works without env vars; throws a clear message on first use.
 * Server-only: contains API_KEY, never import from client components.
 */
export const getEnv = (): Env => {
  if (cached) return cached;

  const raw = {
    ENDPOINT: process.env.NEXT_PUBLIC_ENDPOINT,
    PROJECT_ID: process.env.PROJECT_ID,
    API_KEY: process.env.API_KEY,
    DATABASE_ID: process.env.DATABASE_ID,
    PATIENT_COLLECTION_ID: process.env.PATIENT_COLLECTION_ID,
    APPOINTMENT_COLLECTION_ID: process.env.APPOINTMENT_COLLECTION_ID,
    BUCKET_ID: process.env.NEXT_PUBLIC_BUCKET_ID,
  };

  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    // Report the actual env var names (ENDPOINT/BUCKET_ID are NEXT_PUBLIC_*).
    const envName: Record<string, string> = {
      ENDPOINT: "NEXT_PUBLIC_ENDPOINT",
      BUCKET_ID: "NEXT_PUBLIC_BUCKET_ID",
    };
    const missing = result.error.issues.map((issue) => {
      const key = String(issue.path[0]);
      return envName[key] ?? key;
    });
    throw new Error(
      `Missing or empty environment variables: ${Array.from(new Set(missing)).join(", ")}`
    );
  }

  cached = result.data;
  return cached;
};
