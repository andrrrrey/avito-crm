// src/lib/billing.ts
import { prisma } from "@/lib/prisma";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChargeResult {
  /** true — деньги списаны (или биллинг не настроен), false — недостаточно баланса */
  charged: boolean;
  chargedRub: number;
  costRub: number;
  profitRub: number;
  reason?: "no_config" | "no_user" | "insufficient_balance";
}

/**
 * Рассчитать и списать стоимость одного AI-ответа с баланса пользователя.
 *
 * Логика:
 * - Если BillingConfig (id=1) не существует → billing не настроен, пропускаем (charged=true, всё по нулям).
 * - Если userId не передан → нет привязки к пользователю, пропускаем.
 * - Если баланса не хватает → charged=false, reason="insufficient_balance".
 * - Иначе атомарно списываем баланс и записываем лог.
 */
export async function chargeAiMessage(params: {
  userId: string;
  chatId: string;
  model: string;
  usage: TokenUsage;
}): Promise<ChargeResult> {
  const config = await prisma.billingConfig.findUnique({ where: { id: 1 } });

  // Billing не настроен → пропускаем, AI работает бесплатно
  if (!config) {
    return { charged: true, chargedRub: 0, costRub: 0, profitRub: 0, reason: "no_config" };
  }

  const isGpt = isGptModel(params.model);
  const inputPriceUsd  = isGpt ? Number(config.gpt52InputPrice)     : Number(config.deepseekInputPrice);
  const outputPriceUsd = isGpt ? Number(config.gpt52OutputPrice)    : Number(config.deepseekOutputPrice);
  const usdToRub       = isGpt ? Number(config.openaiUsdToRub)      : Number(config.deepseekUsdToRub);
  const markup         = isGpt ? Number(config.openaiMarkupMultiplier) : Number(config.deepseekMarkupMultiplier);

  const costUsd    = (params.usage.inputTokens  * inputPriceUsd  / 1_000_000)
                   + (params.usage.outputTokens * outputPriceUsd / 1_000_000);
  const costRub    = costUsd * usdToRub;
  const chargedRub = costRub * markup;
  const profitRub  = chargedRub - costRub;

  try {
    await prisma.$transaction(async (tx) => {
      // Получаем или создаём запись баланса (при первом обращении баланс = 0)
      const balance = await tx.userBalance.upsert({
        where:  { userId: params.userId },
        create: { userId: params.userId, balance: 0 },
        update: {},
      });

      const current = Number(balance.balance);
      if (current < chargedRub) {
        throw new Error("INSUFFICIENT_BALANCE");
      }

      const newBalance = current - chargedRub;

      await tx.userBalance.update({
        where: { userId: params.userId },
        data:  { balance: newBalance },
      });

      const billing = await tx.aiMessageBilling.create({
        data: {
          userId:           params.userId,
          chatId:           params.chatId,
          model:            params.model,
          inputTokens:      params.usage.inputTokens,
          outputTokens:     params.usage.outputTokens,
          inputPriceUsd,
          outputPriceUsd,
          usdToRub,
          markupMultiplier: markup,
          costUsd,
          costRub,
          chargedRub,
          profitRub,
        },
      });

      await tx.balanceTransaction.create({
        data: {
          userId:       params.userId,
          type:         "CHARGE",
          amount:       -chargedRub,
          balanceAfter: newBalance,
          description:  `AI-ответ (${params.model})`,
          aiMessageId:  billing.id,
        },
      });
    });

    console.log(
      `[Billing] Charged user=${params.userId} model=${params.model} ` +
      `tokens=${params.usage.inputTokens}in+${params.usage.outputTokens}out ` +
      `cost=${costRub.toFixed(4)}₽ charged=${chargedRub.toFixed(4)}₽ profit=${profitRub.toFixed(4)}₽`
    );

    return { charged: true, chargedRub, costRub, profitRub };
  } catch (e: unknown) {
    if (e instanceof Error && e.message === "INSUFFICIENT_BALANCE") {
      console.warn(
        `[Billing] Insufficient balance for user=${params.userId} ` +
        `need=${chargedRub.toFixed(4)}₽`
      );
      return { charged: false, chargedRub: 0, costRub, profitRub: 0, reason: "insufficient_balance" };
    }
    throw e;
  }
}

/**
 * Быстрая проверка: есть ли у пользователя баланс для минимального AI-запроса.
 * Используется как pre-check перед вызовом AI, чтобы не тратить токены зря.
 *
 * Если billing не настроен (нет BillingConfig) → всегда true.
 */
export async function hasEnoughBalance(userId: string): Promise<boolean> {
  const config = await prisma.billingConfig.findUnique({ where: { id: 1 } });
  if (!config) return true; // billing отключён

  const balance = await prisma.userBalance.findUnique({ where: { userId } });
  if (!balance) return false; // баланс ещё не создан = 0

  // Минимальная оценка стоимости: берём самую дешёвую модель (DeepSeek)
  // 1000 input + 100 output токенов с наценкой
  const minCostRub =
    (1000 * Number(config.deepseekInputPrice) / 1_000_000 +
      100 * Number(config.deepseekOutputPrice) / 1_000_000) *
    Number(config.deepseekUsdToRub) *
    Number(config.deepseekMarkupMultiplier);

  return Number(balance.balance) >= minCostRub;
}

/** Определить, является ли модель GPT (OpenAI) по имени */
function isGptModel(model: string): boolean {
  const lower = model.toLowerCase();
  return lower.includes("gpt") || lower.includes("o1") || lower.includes("o3") || lower.includes("o4");
}
