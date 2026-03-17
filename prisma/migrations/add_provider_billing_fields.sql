-- Migration: Add separate markup/exchange rate fields per provider
-- Run this migration to update the BillingConfig table

ALTER TABLE "BillingConfig"
  ADD COLUMN IF NOT EXISTS "openaiMarkupMultiplier"   DECIMAL(6,3)  NOT NULL DEFAULT 2.5,
  ADD COLUMN IF NOT EXISTS "openaiUsdToRub"           DECIMAL(8,4)  NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS "deepseekMarkupMultiplier" DECIMAL(6,3)  NOT NULL DEFAULT 2.5,
  ADD COLUMN IF NOT EXISTS "deepseekUsdToRub"         DECIMAL(8,4)  NOT NULL DEFAULT 90;

-- Drop old unified fields (only after verifying new fields work)
-- ALTER TABLE "BillingConfig" DROP COLUMN IF EXISTS "markupMultiplier";
-- ALTER TABLE "BillingConfig" DROP COLUMN IF EXISTS "usdToRub";
