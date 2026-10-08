import { getDeviceId } from "@/lib/device";

export const AI_MODEL = "gemini-3.8-flash";
export const AI_IMAGE_MODEL = "imagen-3 / flux";

export type AiMessage = { role: "user" | "assistant" | "system"; content: any };

export interface AiAttachment {
  url: string;
  type: string;
  name: string;
}

export async function aiStream(
  messages: AiMessage[],
  onDelta: (s: string) => void,
  signal?: AbortSignal,
  opts: {
    model?: string;
    max_tokens?: number;
    plugins?: any[];
    mode?: string;
    onAttachment?: (att: AiAttachment) => void;
  } = {},
) {
  const res = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      sessionId: getDeviceId(),
      ...(opts.mode ? { mode: opts.mode } : {}),
      ...(opts.model ? { model: opts.model } : {}),
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    const errorJson = await res.json().catch(() => null);
    throw new Error(errorJson?.error || `Error del servicio de IA (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (signal?.aborted) return;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload);
        if (json?.attachment && opts.onAttachment) {
          opts.onAttachment(json.attachment);
        }
        const delta = json?.choices?.[0]?.delta?.content;
        if (delta) onDelta(String(delta));
      } catch {
        // partial chunk ignore
      }
    }
  }
}

export async function aiText(
  messages: AiMessage[],
  opts: { model?: string; max_tokens?: number } = {},
): Promise<string> {
  let out = "";
  await aiStream(messages, (d) => (out += d), undefined, opts);
  return out;
}

export async function aiImage(prompt: string): Promise<string> {
  const res = await fetch("/api/ai/image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  const json: any = await res.json().catch(() => null);
  const url = json?.url;
  if (!res.ok || !url) throw new Error(json?.error || "El generador no devolvió ninguna imagen. Intenta de nuevo.");
  return String(url);
}
