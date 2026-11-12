import { z } from "zod";

const bool = z.enum(["true", "false"]).default("false").transform((v) => v === "true");

const Env = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().default(8080),
    PUBLIC_URL: z.url(),
    DATABASE_URL: z.string().min(1),
    COGNITO_USER_POOL_ID: z.string().default(""),
    COGNITO_CLIENT_ID: z.string().default(""),
    AUTH_DEV_BYPASS: bool,
    KMS_KEY_ID: z.string().default(""),
    DEV_ENCRYPTION_KEY: z.string().default(""),
    RETELL_API_KEY: z.string().min(1),
    RETELL_OUTBOUND_AGENT_ID: z.string().default(""),
    RETELL_BOOKING_AGENT_ID: z.string().default(""),
    RETELL_INBOUND_AGENT_ID: z.string().default(""),
    TWILIO_ACCOUNT_SID: z.string().default(""),
    TWILIO_AUTH_TOKEN: z.string().default(""),
    TWILIO_VERIFY_SERVICE_SID: z.string().default(""),
    TWILIO_SIP_TRUNK_SID: z.string().default(""),
    TWILIO_TERMINATION_URI: z.string().default(""),
    TWILIO_SIP_USERNAME: z.string().default(""),
    TWILIO_SIP_PASSWORD: z.string().default(""),
    DEFAULT_FROM_NUMBER: z.string().default(""),
    MAX_CALL_MINUTES: z.coerce.number().default(120),
    MAX_CONCURRENT_CALLS_PER_USER: z.coerce.number().default(2),
  })
  .superRefine((e, ctx) => {
    if (e.NODE_ENV === "production") {
      if (e.AUTH_DEV_BYPASS) ctx.addIssue({ code: "custom", message: "AUTH_DEV_BYPASS must be false in production" });
      if (!e.KMS_KEY_ID) ctx.addIssue({ code: "custom", message: "KMS_KEY_ID is required in production" });
      if (!e.COGNITO_USER_POOL_ID || !e.COGNITO_CLIENT_ID) ctx.addIssue({ code: "custom", message: "Cognito config is required in production" });
    } else if (!e.KMS_KEY_ID && !e.DEV_ENCRYPTION_KEY) {
      ctx.addIssue({ code: "custom", message: "Set DEV_ENCRYPTION_KEY (openssl rand -base64 32) or KMS_KEY_ID" });
    }
  });

// On AWS the stack passes the RDS endpoint as DB_* vars and the password from Parameter Store; build DATABASE_URL from them.
function databaseUrl(): string | undefined {
  const e = process.env;
  if (e.DATABASE_URL) return e.DATABASE_URL;
  if (!e.DB_HOST || !e.DB_PASSWORD) return undefined;
  return `postgres://${encodeURIComponent(e.DB_USER ?? "ringo")}:${encodeURIComponent(e.DB_PASSWORD)}@${e.DB_HOST}:${e.DB_PORT ?? 5432}/${e.DB_NAME ?? "ringo"}`;
}

export const env = Env.parse({ ...process.env, DATABASE_URL: databaseUrl() });
export type AppEnv = typeof env;
