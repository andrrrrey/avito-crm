import { requireAuth } from "@/lib/auth";
import { makeEvent, subscribe, subscribeChat, type CRMRealtimeEvent } from "@/lib/realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formatSse(event: CRMRealtimeEvent) {
  // id нужен, чтобы браузер мог возобновлять поток
  return `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export async function GET(req: Request) {
  const guard = await requireAuth(req);
  if (guard) return guard;

  const url = new URL(req.url);
  const chatId = (url.searchParams.get("chatId") || "").trim() || null;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const send = (e: CRMRealtimeEvent) => {
        if (closed) return;

        // Глобальная подписка (без chatId) нужна в основном для обновления списков чатов.
        // message_created лучше отдавать только в подписку конкретного чата, иначе UI получает дубль.
        // new_incoming ВСЕГДА идёт в глобальную подписку (для звука/тоста).
        if (!chatId && e.type === "message_created") return;

        // На всякий случай: если вдруг прилетит событие с другим chatId.
        if (chatId && e.chatId && e.chatId !== chatId && e.type !== "ping" && e.type !== "hello") return;

        controller.enqueue(encoder.encode(formatSse(e)));
      };

      // "hello" сразу, чтобы UI понял, что realtime поднят
      send(makeEvent({ type: "hello" }));

      const unsub = chatId ? subscribeChat(chatId, send) : subscribe(send);

      // keep-alive, чтобы прокси/браузер не закрывал соединение
      const pingTimer = setInterval(() => {
        send(makeEvent({ type: "ping" }));
      }, 25_000);

      const onAbort = () => {
        if (closed) return;
        closed = true;
        clearInterval(pingTimer);
        unsub();
        try {
          controller.close();
        } catch {
          // ignore
        }
      };

      req.signal.addEventListener("abort", onAbort);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // nginx/proxy buffering off
      "X-Accel-Buffering": "no",
    },
  });
}
