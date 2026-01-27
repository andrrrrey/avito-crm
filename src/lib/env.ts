// src/lib/env.ts
import { z } from "zod";

const boolFromEnv = z.preprocess((v) => {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(s)) return true;
    if (["0", "false", "no", "n", "off", ""].includes(s)) return false;
  }
  return v;
}, z.boolean());

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  DATABASE_URL: z.string().min(1),

  // защита API
  CRM_TOKEN: z.string().min(1).default("dev123"),
  DEV_TOKEN: z.string().min(1).default("dev123"),
  SESSION_COOKIE_NAME: z.string().min(1).default("crm_session"),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  // cron/sync токен (чтобы дергать /api/avito/sync?token=...)
  CRM_CRON_TOKEN: z.string().min(1).default("dev123"),

  // защита входящих вебхуков Avito (подставляешь в URL вебхука как ?key=...)
  CRM_WEBHOOK_KEY: z.string().min(1).default("dev123"),

  // mock режим (ВАЖНО: правильный парсинг!)
  MOCK_MODE: boolFromEnv.default(true),

  // куда по умолчанию складываем новые чаты (пока бот не подключен — MANAGER)
  AVITO_DEFAULT_STATUS: z.enum(["BOT", "MANAGER"]).default("BOT"),

  // Avito
  AVITO_CLIENT_ID: z.string().min(1).optional(),
  AVITO_CLIENT_SECRET: z.string().min(1).optional(),
  AVITO_ACCOUNT_ID: z.coerce.number().int().positive().optional(),
  AVITO_REDIRECT_URI: z.string().url().optional(),

  // (на будущее, чтобы bot.ts не был “вечно skipped”)
  N8N_BOT_WEBHOOK_URL: z.string().optional(),
  CRM_BOT_TOKEN: z.string().optional(),

  PUBLIC_BASE_URL: z.string().optional(),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error(parsed.error.flatten().fieldErrors);
  throw parsed.error;
}

export const env = parsed.data;

// Если НЕ mock — требуем Avito креды
if (!env.MOCK_MODE) {
  const missing: string[] = [];
  if (!env.AVITO_CLIENT_ID) missing.push("AVITO_CLIENT_ID");
  if (!env.AVITO_CLIENT_SECRET) missing.push("AVITO_CLIENT_SECRET");
  if (!env.AVITO_ACCOUNT_ID) missing.push("AVITO_ACCOUNT_ID");
  if (missing.length) {
    throw new Error(`Missing Avito env vars (MOCK_MODE=false): ${missing.join(", ")}`);
  }
}
export function assertAvitoEnv() {
  const missing: string[] = [];

  if (!env.AVITO_CLIENT_ID) missing.push("AVITO_CLIENT_ID");
  if (!env.AVITO_CLIENT_SECRET) missing.push("AVITO_CLIENT_SECRET");
  if (!env.AVITO_ACCOUNT_ID) missing.push("AVITO_ACCOUNT_ID");

  if (missing.length) {
    throw new Error(`Missing Avito env vars: ${missing.join(", ")}`);
  }
}
