import { env } from "@/lib/env";

export type BotInboundEvent = {
  event: "customer_message";
  chat: {
    id: string;
    avitoChatId: string;
    status: "BOT" | "MANAGER";
    customerName: string | null;
    itemTitle: string | null;
    price: number | null;
    adUrl: string | null;
    chatUrl: string | null;
  };
  message: {
    id: string;
    text: string;
    createdAt: string;
  };
  historyTail: Array<{
    author: "CUSTOMER" | "BOT" | "MANAGER";
    text: string;
    createdAt: string;
  }>;
};

export type BotReplyAction =
  | { type: "reply"; text: string; sendToCustomer?: boolean }
  | { type: "escalate"; reason?: string }
  | { type: "noop" };

export type BotReplyPayload = {
  avitoChatId: string;
  actions: BotReplyAction[];
};

export async function sendEventToBot(event: BotInboundEvent) {
  if (!env.N8N_BOT_WEBHOOK_URL) return { ok: false, skipped: true };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (env.CRM_BOT_TOKEN) headers["x-crm-bot-token"] = env.CRM_BOT_TOKEN;

  try {
    const resp = await fetch(env.N8N_BOT_WEBHOOK_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(event),
    });

    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      return { ok: false, status: resp.status, body: t };
    }

    const txt = await resp.text().catch(() => "");
    if (!txt) return { ok: true, syncReply: null as any };

    try {
      const json = JSON.parse(txt);
      return { ok: true, syncReply: json };
    } catch {
      return { ok: true, syncReply: null as any };
    }
  } catch (e: any) {
    return { ok: false, error: "network_error", message: String(e?.message ?? e) };
  }
}
