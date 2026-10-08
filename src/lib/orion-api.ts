import { db } from "@/lib/firebase";
import { getDeviceId } from "@/lib/device";
import { aiStream, aiText, aiImage, AI_MODEL } from "@/lib/ai";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  query,
  where,
  orderBy,
} from "firebase/firestore";

export type ChatMsg = { role: "user" | "assistant" | "system"; content: any };

// ---- Conocimiento (memoria) ----
const IDENTITY = `IDENTIDAD (regla absoluta e inviolable):
- TÚ eres Orión Estellar, una asistente (femenina) creada por Linky. Hablas SIEMPRE en primera persona como Orión.
- La persona con la que hablas es EL USUARIO. El usuario NO es Orión y nunca debe ser llamado Orión.
- Nunca te dirijas al usuario como "Orión", nunca le atribuyas tu identidad, tu personalidad ni tus datos.
- Los mensajes con rol "user" son del usuario; los mensajes con rol "assistant" son tuyos (Orión).
- La información de la base de conocimiento y de la configuración describe a Orión (tú), no al usuario.
- Los datos de "MEMORIA DEL USUARIO" describen al usuario, no a ti.
Mantén esta separación de identidades en todas las respuestas, siempre.`;

let cachedKnowledge: ChatMsg[] | null = null;
let lastKnowledgeFetch = 0;
const KNOWLEDGE_CACHE_TTL = 45000; // 45s cache to avoid multi-query latency on every chat turn

export function invalidateKnowledgeCache() {
  cachedKnowledge = null;
  lastKnowledgeFetch = 0;
}

async function buildKnowledgeMessages(): Promise<ChatMsg[]> {
  const now = Date.now();
  if (cachedKnowledge && now - lastKnowledgeFetch < KNOWLEDGE_CACHE_TTL) {
    return cachedKnowledge;
  }

  const out: ChatMsg[] = [{ role: "system", content: IDENTITY }];
  try {
    const did = getDeviceId();
    const [cfgSnap, kbSnap, memSnap, scriptsSnap] = await Promise.all([
      getDoc(doc(db, "orion_config", "main")).catch(() => null),
      getDocs(collection(db, "orion_knowledge")).catch(() => null),
      getDocs(query(collection(db, "user_memory"), where("deviceId", "==", did))).catch(() => null),
      getDocs(collection(db, "orion_builda_scripts")).catch(() => null),
    ]);

    if (cfgSnap && cfgSnap.exists()) {
      const c: any = cfgSnap.data();
      out.push({
        role: "system",
        content:
          "INSTRUCCIONES DE ORIÓN (aplícalas siempre, describen cómo eres TÚ):\n" +
          `PERSONALIDAD:\n${c.personality || "(sin definir)"}\n\n` +
          `COMPORTAMIENTO:\n${c.behavior || "(sin definir)"}\n\n` +
          `CONTEXTO:\n${c.context || "(sin definir)"}`,
      });
    }

    if (kbSnap && !kbSnap.empty) {
      const entries = kbSnap.docs.map((d) => d.data() as { title: string; content: string });
      out.push({
        role: "system",
        content:
          "BASE DE CONOCIMIENTO DE ORIÓN (usa SIEMPRE esta información como verdad y respóndela cuando sea relevante; son " +
          entries.length +
          " entradas completas):\n\n" +
          entries.map((e, i) => `#${i + 1} ${e.title}\n${e.content}`).join("\n\n---\n\n"),
      });
    }

    if (scriptsSnap && !scriptsSnap.empty) {
      const scr = scriptsSnap.docs
        .map((d) => d.data() as { title: string; description?: string; code: string })
        .filter((s) => s?.code);
      if (scr.length) {
        out.push({
          role: "system",
          content:
            "SCRIPTS DE BUILDA GUARDADOS EN MEMORIA (" +
            scr.length +
            " scripts). Cuando el usuario pida un script de Builda, USA SIEMPRE estos scripts como base y entrégalos completos, adaptándolos si hace falta. No inventes una sintaxis distinta:\n\n" +
            scr
              .map(
                (s, i) =>
                  `### Script ${i + 1}: ${s.title}\n${s.description ? `Descripción: ${s.description}\n` : ""}\`\`\`\n${s.code}\n\`\`\``,
              )
              .join("\n\n"),
        });
      }
    }

    if (memSnap && !memSnap.empty) {
      const facts = memSnap.docs.map((d) => String(d.data().content)).filter(Boolean);
      if (facts.length) {
        out.push({
          role: "system",
          content: "MEMORIA DEL USUARIO (hechos sobre el USUARIO, no sobre ti):\n" + facts.map((f) => `- ${f}`).join("\n"),
        });
      }
    }

    cachedKnowledge = out;
    lastKnowledgeFetch = now;
  } catch (e) {
    console.warn("Knowledge load error:", e);
  }
  return out;
}

// ---- Texto ----
export async function streamChat(
  messages: ChatMsg[],
  onDelta: (s: string) => void,
  signal?: AbortSignal,
  onAttachment?: (att: { url: string; type: string; name: string }) => void
) {
  const ctx = await buildKnowledgeMessages();
  return aiStream([...ctx, ...messages], onDelta, signal, { onAttachment });
}

export async function streamSearch(queryText: string, messages: ChatMsg[], onDelta: (s: string) => void, signal?: AbortSignal) {
  const ctx = await buildKnowledgeMessages();
  const msgs: ChatMsg[] = [
    ...ctx,
    {
      role: "system",
      content:
        "Tienes acceso a búsqueda web en vivo. Consulta internet y responde con información actual y verificable sobre la consulta del usuario. Cita las fuentes con su enlace al final. Si un dato no aparece en los resultados, dilo con claridad.",
    },
    ...messages,
    { role: "user", content: `Busca en internet información actualizada sobre: ${queryText}` },
  ];
  return aiStream(msgs, onDelta, signal, { mode: "search" });
}

export async function streamDebugVisual(imageUrl: string, notes: string, onDelta: (s: string) => void, signal?: AbortSignal) {
  const prompt = `Eres Orión Estellar. Analiza esta captura de pantalla de un videojuego y detecta errores, fallos o problemas de interfaz o diseño. Explica causas probables y cómo solucionarlos.\nNotas del usuario: ${notes || "(sin notas)"}`;
  const msgs: ChatMsg[] = [
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: imageUrl } },
      ],
    },
  ];
  return aiStream(msgs, onDelta, signal);
}

// ---- Imágenes ----
export async function generateImage(prompt: string): Promise<string> {
  return aiImage(prompt);
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("No se pudo leer la imagen"));
    reader.readAsDataURL(file);
  });
}

export async function uploadAttachment(file: File, _bucket = "chat-attachments"): Promise<string> {
  // Store client-side as data URL for instant, reliable attachment preview across all environments
  return fileToDataUrl(file);
}

function parseJsonLoose(raw: string): any {
  const s = raw.indexOf("{");
  const e = raw.lastIndexOf("}");
  if (s === -1 || e <= s) return {};
  try {
    return JSON.parse(raw.slice(s, e + 1));
  } catch {
    return {};
  }
}

async function askJson(prompt: string): Promise<any> {
  const text = await aiText([{ role: "user", content: prompt }], {
    max_tokens: 600,
    model: "gemini-3.1-flash-lite",
  });
  return parseJsonLoose(text);
}

// Memoria: extrae hechos con la IA y los guarda en Firestore
export async function extractAndStoreMemory(text: string) {
  if (!text || text.length < 8) return;
  try {
    const out = await askJson(
      `Extrae hechos duraderos sobre el usuario del siguiente texto. Devuelve SOLO JSON con esta forma: {"facts":[{"content":"...","kind":"fact"}]}. Si no hay hechos, devuelve {"facts":[]}.\n\nTexto:\n${text}`,
    );
    const facts = out?.facts;
    if (!Array.isArray(facts) || facts.length === 0) return;
    const did = getDeviceId();
    for (const f of facts) {
      if (f?.content) {
        await addDoc(collection(db, "user_memory"), {
          deviceId: did,
          content: String(f.content),
          kind: f.kind || "fact",
          createdAt: new Date().toISOString(),
        });
      }
    }
  } catch (e) {
    console.warn("memory extract failed", e);
  }
}

export async function classifyNote(title: string, content: string) {
  try {
    return await askJson(
      `Clasifica esta nota de desarrollo de videojuegos. Devuelve SOLO JSON: {"category":"gameplay|lore|ui|multiplayer|economia|audio|bugs|arte|programacion|otros","tags":["..."],"summary":"..."}.\n\nTítulo: ${title}\nContenido: ${content}`,
    );
  } catch {
    return {};
  }
}

export async function analyzeProject(notes: any[]): Promise<string> {
  const resumen = notes
    .map((n: any) => `- ${n?.title || "(sin título)"}: ${String(n?.content || "").slice(0, 400)}`)
    .join("\n")
    .slice(0, 8000);
  return aiText(
    [
      {
        role: "user",
        content: `Analiza este conjunto de notas de un proyecto de videojuego y entrega un análisis claro con puntos fuertes, riesgos y próximos pasos recomendados:\n\n${resumen}`,
      },
    ],
    { max_tokens: 1500 },
  );
}

export type DiagnosticsResult = {
  timestamp: string;
  env: Record<string, boolean>;
  results: Record<string, { ok: boolean; ms: number; sample: string; error: string | null }>;
};

export async function runDiagnostics(): Promise<DiagnosticsResult> {
  const t0 = performance.now();
  let ok = false;
  let sample = "";
  let error: string | null = null;
  try {
    sample = (await aiText([{ role: "user", content: "Responde solo: ok" }], { max_tokens: 20 })).slice(0, 120);
    ok = Boolean(sample);
  } catch (e) {
    error = String(e);
  }

  return {
    timestamp: new Date().toISOString(),
    env: { geminiAi: true, firebase: true },
    results: { [AI_MODEL]: { ok, ms: Math.round(performance.now() - t0), sample, error } },
  };
}

export function cleanFallbackTitle(raw: string): string {
  if (!raw) return "Nueva conversación";
  let t = raw.trim();

  // Strip greetings and opening filler phrases
  t = t.replace(/^(?:hola(?:[\s,]+ori[oó]n)?|buenas(?:[\s,]+tardes|[\s,]+noches|[\s,]+d[ií]as)?|oye(?:[\s,]+ori[oó]n)?|saludos|hey|hi)\b[,\s.:;-]*/i, "");
  t = t.replace(/^(?:por\s+favor|podr[ií]as|puedes|me\s+gustar[ií]a|quisiera|quiero|necesito|ay[uú]dame\s+a|dime|expl[ií]came|cu[eé]ntame|sabes|c[oó]mo\s+hago\s+para)\s+/i, "");
  t = t.replace(/^[¿?¡!"'«»“”\s]+|[¿?¡!"'«»“”\s]+$/g, "");

  if (!t) return "Conversación con Orión";

  const words = t.split(/\s+/).filter(Boolean);
  let short = words.slice(0, 5).join(" ");
  if (short.length > 36) {
    short = short.slice(0, 36).replace(/\s+\S*$/, "");
  }

  return short.charAt(0).toUpperCase() + short.slice(1);
}

export async function createChatTitle(firstMessage: string): Promise<string> {
  const text = (firstMessage || "").trim();
  if (!text) return "Nueva conversación";

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch("/api/ai/title", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data?.title && typeof data.title === "string" && data.title.trim().length > 0) {
        return data.title.trim();
      }
    }
  } catch (e) {
    console.warn("createChatTitle API error, using fallback:", e);
  }

  return cleanFallbackTitle(text);
}
