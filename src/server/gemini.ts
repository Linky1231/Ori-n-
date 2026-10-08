import { GoogleGenAI } from '@google/genai';
import { searchLocation } from './location';

function getApiKey(): string {
  return process.env.GEMINI_API_KEY || '';
}

export function getGeminiClient(): GoogleGenAI {
  const apiKey = getApiKey();
  return new GoogleGenAI({ apiKey });
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: any;
}

export interface ChatAttachment {
  url: string;
  type: string;
  name: string;
}

function flattenText(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p: any) => {
        if (typeof p === 'string') return p;
        if (p?.type === 'text') return p.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return String(content ?? '');
}

async function extractMediaParts(content: any): Promise<any[]> {
  const parts: any[] = [];
  if (typeof content === 'string') {
    parts.push({ text: content });
    return parts;
  }
  if (!Array.isArray(content)) {
    parts.push({ text: String(content ?? '') });
    return parts;
  }

  for (const item of content) {
    if (typeof item === 'string') {
      parts.push({ text: item });
    } else if (item?.type === 'text') {
      parts.push({ text: item.text });
    } else if (item?.type === 'image_url' && item?.image_url?.url) {
      const url = String(item.image_url.url);
      if (url.startsWith('data:')) {
        const matches = url.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
        if (matches) {
          parts.push({
            inlineData: {
              mimeType: matches[1],
              data: matches[2],
            },
          });
          continue;
        }
      }
      try {
        const res = await fetch(url);
        if (res.ok) {
          const ct = res.headers.get('content-type') || 'image/jpeg';
          const buf = Buffer.from(await res.arrayBuffer());
          parts.push({
            inlineData: {
              mimeType: ct,
              data: buf.toString('base64'),
            },
          });
        }
      } catch (e) {
        console.warn('Failed to fetch image for Gemini:', e);
      }
    }
  }

  return parts;
}

export async function searchWeb(queryText: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2200);
    const res = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(queryText), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return '';
    const html = await res.text();
    const results: { url: string; snippet: string }[] = [];
    const regex = /<a class=\"result__snippet\" href=\"([^\"]+)\">([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = regex.exec(html)) !== null && results.length < 4) {
      let rawUrl = m[1];
      let cleanUrl = rawUrl;
      const matchUddg = rawUrl.match(/uddg=([^&]+)/);
      if (matchUddg) {
        try {
          cleanUrl = decodeURIComponent(matchUddg[1]);
        } catch {
          // ignore decode error
        }
      }
      const snippet = m[2]
        .replace(/<[^>]+>/g, '')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&#x27;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
      if (snippet) {
        results.push({ url: cleanUrl, snippet });
      }
    }

    if (results.length === 0) return '';
    return results
      .map((r, i) => `[Fuente ${i + 1}]: ${r.snippet}\nEnlace: ${r.url}`)
      .join('\n\n');
  } catch (err) {
    console.warn('Web search timeout or error:', err);
    return '';
  }
}

export function detectImageIntent(text: string): { isImage: boolean; prompt: string } {
  const t = text.trim();
  if (!t) return { isImage: false, prompt: '' };
  const clean = t.replace(/[?!.]+$/, '').trim();

  // Pattern 1: Requests like "puedes / me puedes / podrías... generar / crear / hacer / dibujar..."
  const p1 = /(?:(?:me\s+)?(?:puedes|podr[ií]as|quisiera|quiero|te\s+pido\s+que)\s+)?(?:genera(?:r|me)?|crea(?:r|me)?|haz(?:me)?|hacer|dibuja(?:r|me)?|diseña(?:r|me)?|ilustra(?:r|me)?|renderiza(?:r)?|mu[eé]strame|dame|pinta(?:r|me)?)\s+(?:una?\s+|el\s+|la\s+)?(?:imagen|foto|fotograf[ií]a|dibujo|ilustraci[oó]n|cuadro|diseño|render|arte|wallpaper|fondo\s+de\s+pantalla|avatar|icono|logo)\s*(?:de|sobre|para|con|del)?\s*(.+)/i;
  const m1 = clean.match(p1);
  if (m1 && m1[1]) {
    let p = m1[1].trim().replace(/[,\s]+(?:por\s+favor|gracias|please|thx)\.?$/i, '').trim();
    return { isImage: true, prompt: p || clean };
  }

  // Pattern 2: "quiero una imagen de...", "necesito una imagen de...", "quisiera una foto de..."
  const p2 = /(?:quiero|necesito|deseo|quisiera)\s+(?:una?\s+|el\s+|la\s+)?(?:imagen|foto|fotograf[ií]a|dibujo|ilustraci[oó]n|cuadro|render)\s*(?:de|sobre|del|para)?\s*(.+)/i;
  const m2 = clean.match(p2);
  if (m2 && m2[1]) {
    let p = m2[1].trim().replace(/[,\s]+(?:por\s+favor|gracias|please|thx)\.?$/i, '').trim();
    return { isImage: true, prompt: p || clean };
  }

  // Pattern 3: "dibuja...", "dibújame...", "ilustra...", "renderiza...", "pinta..."
  const p3 = /^(?:(?:me\s+)?(?:puedes\s+|podr[ií]as\s+)?)?(?:dibuja(?:r|me)?|dib[uú]jame|ilustra(?:r|me)?|il[uú]strame|renderiza(?:r)?|pinta(?:r|me)?|p[ií]ntame)\s+(?:a\s+|un\s+|una\s+|el\s+|la\s+)?(.+)/i;
  const m3 = clean.match(p3);
  if (m3 && m3[1]) {
    let p = m3[1].trim().replace(/[,\s]+(?:por\s+favor|gracias|please|thx)\.?$/i, '').trim();
    return { isImage: true, prompt: p || clean };
  }

  // Pattern 4: "imagen de...", "foto de..."
  const p4 = /^(?:imagen|foto|dibujo|ilustraci[oó]n)\s+(?:de|sobre|del)\s+(.+)/i;
  const m4 = clean.match(p4);
  if (m4 && m4[1]) {
    let p = m4[1].trim().replace(/[,\s]+(?:por\s+favor|gracias|please|thx)\.?$/i, '').trim();
    return { isImage: true, prompt: p || clean };
  }

  // Pattern 5: English prompts
  const p5 = /(?:(?:can\s+you\s+)?(?:create|generate|make|draw|render|show\s+me))\s+(?:an?\s+)?(?:image|picture|photo|drawing|illustration|art)\s+(?:of|about|with)?\s*(.+)/i;
  const m5 = clean.match(p5);
  if (m5 && m5[1]) {
    let p = m5[1].trim().replace(/[,\s]+(?:please|thanks|thank\s+you)\.?$/i, '').trim();
    return { isImage: true, prompt: p || clean };
  }

  const p6 = /^(?:draw|paint)\s+(?:a|an|the)?\s*(.+)/i;
  const m6 = clean.match(p6);
  if (m6 && m6[1]) {
    let p = m6[1].trim().replace(/[,\s]+(?:please|thanks|thank\s+you)\.?$/i, '').trim();
    return { isImage: true, prompt: p || clean };
  }

  return { isImage: false, prompt: '' };
}

export function detectSearchIntent(text: string): { isSearch: boolean; query: string } {
  const t = text.trim();
  if (!t) return { isSearch: false, query: '' };
  const clean = t.replace(/[?!.]+$/, '').trim();

  // Pattern 1: Requests explicitly mentioning internet / web / google
  const p1 = /(?:(?:busca(?:r|me)?|investiga(?:r|me)?|averigua(?:r|me)?|consulta(?:r)?)\s+)?(?:en\s+(?:internet|la\s+web|google|la\s+red|en\s+l[ií]nea))\s*(?:\b(?:sobre|de|acerca\s+de)\b\s*)?(.+)/i;
  const m1 = clean.match(p1);
  if (m1 && m1[1]) {
    let q = m1[1].trim().replace(/[,\s]+(?:por\s+favor|gracias|please)\.?$/i, '').trim();
    return { isSearch: true, query: q || clean };
  }

  // Pattern 2: "qué noticias hay de / sobre...", "últimas noticias de..."
  const p2 = /(?:(?:qu[eé]\s+)?(?:noticias|novedades|actualidad)\s+(?:hay\s+)?(?:de|sobre|en\s+torno\s+a)\s+)(.+)/i;
  const m2 = clean.match(p2);
  if (m2 && m2[1]) {
    let q = m2[1].trim().replace(/[,\s]+(?:por\s+favor|gracias|please)\.?$/i, '').trim();
    return { isSearch: true, query: q || clean };
  }

  // Pattern 3: Explicit mentions of "en internet", "en la web", "en google"
  const p3 = /\b(?:en\s+(?:internet|la\s+web|google|la\s+red))\b/i;
  if (p3.test(clean)) {
    const cleanedQuery = clean
      .replace(/(?:(?:puedes\s+|podr[ií]as\s+)?(?:busca(?:r|me)?|investiga(?:r|me)?|averigua(?:r|me)?|qu[eé]\s+dice|qu[eé]\s+hay))\s+/gi, '')
      .replace(/en\s+(?:internet|la\s+web|google|la\s+red)/gi, '')
      .replace(/[,\s]+(?:por\s+favor|gracias|please)\.?$/i, '')
      .trim();
    return { isSearch: true, query: cleanedQuery || clean };
  }

  // Pattern 4: English prompts explicitly mentioning web/search
  const p4 = /(?:search|look\s+up|google)\s+(?:the\s+web|internet|online|news)\s*(?:for|about)?\s*(.+)/i;
  const m4 = clean.match(p4);
  if (m4 && m4[1]) {
    let q = m4[1].trim().replace(/[,\s]+(?:please|thanks)\.?$/i, '').trim();
    return { isSearch: true, query: q || clean };
  }

  return { isSearch: false, query: '' };
}

export function detectLocationIntent(text: string): { isLocation: boolean; query: string } {
  const clean = text.trim();
  if (!clean) return { isLocation: false, query: '' };

  // Explicit patterns for location, points of interest, or geography
  // "punto en específico...", "lugar específico...", "sitio específico..."
  const pSpecific = /(?:punto|lugar|sitio)\s+(?:en\s+)?espec[ií]fico(?:\s*:\s*|\s+(?:de|del|sobre)?\s*)(.+)/i;
  const mSpecific = clean.match(pSpecific);
  if (mSpecific && mSpecific[1]) return { isLocation: true, query: mSpecific[1].trim().replace(/[.?¡!]+$/, '') };

  // "busca en google maps...", "en google maps..."
  const p1 = /(?:busca(?:r)?\s+(?:en\s+)?(?:google\s+)?maps\s*(?:a|el|la|los|las|de|sobre)?\s*)(.+)/i;
  const m1 = clean.match(p1);
  if (m1 && m1[1]) return { isLocation: true, query: m1[1].trim().replace(/[.?¡!]+$/, '') };

  // "dónde queda / está / se ubica...", "ubicación de...", "coordenadas de...", "coordenadas gps de..."
  const p2 = /(?:d[oó]nde\s+(?:queda|est[aá]|se\s+ubica|se\s+encuentra)|ubicaci[oó]n\s+de|coordenadas\s+(?:gps\s+)?de|localizaci[oó]n\s+(?:geogr[aá]fica\s+)?de)\s*(.+)/i;
  const m2 = clean.match(p2);
  if (m2 && m2[1]) return { isLocation: true, query: m2[1].trim().replace(/[.?¡!]+$/, '') };

  // "cómo llegar a..."
  const p3 = /(?:c[oó]mo\s+llegar\s+a)\s*(.+)/i;
  const m3 = clean.match(p3);
  if (m3 && m3[1]) return { isLocation: true, query: m3[1].trim().replace(/[.?¡!]+$/, '') };

  // "muéstrame la ubicación / el mapa de...", "dame la ubicación de..."
  const p4 = /(?:(?:mu[eé]strame|dame|ens[eé]ñame|ver)\s+(?:la\s+ubicaci[oó]n|el\s+mapa\s+geogr[aá]fico|las\s+coordenadas)\s*(?:de|del)?\s*)(.+)/i;
  const m4 = clean.match(p4);
  if (m4 && m4[1]) return { isLocation: true, query: m4[1].trim().replace(/[.?¡!]+$/, '') };

  // Explicit Google Maps requests
  if (/\b(?:google\s+maps)\b/i.test(clean)) {
    const q = clean
      .replace(/\b(?:en\s+)?google\s+maps\b/gi, '')
      .replace(/(?:busca(?:r|me)?|ver|mu[eé]strame|dame|informaci[oó]n\s+de|pon\s+el\s+mapa\s+de)\s+/gi, '')
      .trim();
    if (q.length > 2) return { isLocation: true, query: q };
  }

  return { isLocation: false, query: '' };
}

export async function handleGeminiChat(
  messages: ChatMessage[],
  mode?: string,
  onDelta?: (chunk: string) => void,
  onAttachment?: (att: ChatAttachment) => void,
  preferredModel?: string
): Promise<string> {
  const ai = getGeminiClient();

  const systemParts = messages
    .filter((m) => m.role === 'system')
    .map((m) => flattenText(m.content))
    .filter(Boolean);

  const conversation = messages.filter((m) => m.role !== 'system');
  const lastUserMsg = [...conversation].reverse().find((m) => m.role === 'user');
  const lastUserText = lastUserMsg ? flattenText(lastUserMsg.content) : '';

  // 1. Detect if user requested image generation
  const imageIntent = detectImageIntent(lastUserText);
  if (imageIntent.isImage) {
    try {
      if (onDelta) onDelta('✨ Generando la imagen con Orión...\n\n');
      const imageUrl = await handleGeminiImage(imageIntent.prompt);
      if (onAttachment) {
        onAttachment({
          url: imageUrl,
          type: 'image/png',
          name: `${imageIntent.prompt.slice(0, 24).replace(/\s+/g, '_')}.png`,
        });
      }
      systemParts.push(
        `AVISO DE SISTEMA: Ya has generado exitosamente la imagen para la solicitud: "${imageIntent.prompt}" y se ha adjuntado al mensaje del usuario. Comunícale al usuario con entusiasmo que has creado la imagen, dale detalles artísticos/conceptuales de la misma y ofrece variaciones si las necesita.`
      );
    } catch (e: any) {
      console.warn('Auto-image generation error:', e);
      systemParts.push(
        `AVISO DE SISTEMA: El usuario solicitó una imagen de "${imageIntent.prompt}", pero hubo un error al generarla (${e?.message || 'timeout'}). Explícaselo amablemente e indícale que puede volver a pedirla.`
      );
    }
  }

  // 2. Detect if user requested web search or search mode
  const searchIntent = detectSearchIntent(lastUserText);
  if (mode === 'search' || searchIntent.isSearch) {
    const q = searchIntent.query || lastUserText;
    const searchResults = await searchWeb(q);
    if (searchResults) {
      systemParts.push(
        `RESULTADOS RECIENTES DE BÚSQUEDA WEB EN VIVO PARA "${q}":\n\n${searchResults}\n\nUsa estos datos actualizados para responder la consulta del usuario, integrándolos de forma natural y citando las fuentes al final.`
      );
    }
  }

  // 3. Detect if user requested Google Maps or location data
  const locationIntent = detectLocationIntent(lastUserText);
  if (locationIntent.isLocation) {
    try {
      const locResults = await searchLocation(locationIntent.query);
      if (locResults.length > 0) {
        const best = locResults[0];
        systemParts.push(
          `DATOS REALES Y VERIFICADOS DE GOOGLE MAPS PARA "${best.name}":\n` +
          `- Nombre: ${best.name}\n` +
          `- Tipo de lugar: ${best.type} (${best.category})\n` +
          `- Dirección completa: ${best.display_name}\n` +
          `- Coordenadas GPS exactas: Latitud ${best.lat}, Longitud ${best.lng}\n` +
          (best.description ? `- Descripción: ${best.description}\n` : '') +
          `- Ciudad/Región/País: ${[best.address.city, best.address.state, best.address.country].filter(Boolean).join(', ')}\n` +
          `- Enlace en Google Maps: ${best.maps_url}\n` +
          `- Cómo llegar en Google Maps: ${best.directions_url}\n\n` +
          `INSTRUCCIÓN DE ORIÓN: Informa al usuario con datos reales, dirección y coordenadas GPS exactas. Explica que estos datos provienen de Google Maps Data y que Orión ha colocado directamente en el mensaje el recuadro con la imagen del lugar y el panel interactivo con Google Maps Data.`
        );
        if (onAttachment) {
          onAttachment({
            url: best.maps_url,
            type: 'location/json',
            name: JSON.stringify(best),
          });
        }
      }
    } catch (e) {
      console.warn('Location search error in chat:', e);
    }
  }

  const systemInstruction = systemParts.join('\n\n');

  const geminiContents: any[] = [];
  for (const m of conversation) {
    const role = m.role === 'assistant' ? 'model' : 'user';
    const parts = await extractMediaParts(m.content);
    if (parts.length > 0) {
      geminiContents.push({ role, parts });
    }
  }

  if (geminiContents.length === 0) {
    geminiContents.push({ role: 'user', parts: [{ text: 'Hola Orión' }] });
  }

  const config: any = {
    temperature: 0.7,
  };

  if (systemInstruction) {
    config.systemInstruction = systemInstruction;
  }

  // Prioritize gemini-3.8-flash as the main model requested by user,
  // with instantaneous fallback to gemini-3.1-flash-lite if 3.8-flash hits quota/rate limits
  const candidateModels = [
    preferredModel || 'gemini-3.8-flash',
    'gemini-3.8-flash',
    'gemini-3.1-flash-lite',
    'gemini-flash-latest',
  ].filter((m, i, arr) => arr.indexOf(m) === i);

  let lastError: any = null;
  for (const model of candidateModels) {
    try {
      const responseStream = await ai.models.generateContentStream({
        model,
        contents: geminiContents,
        config,
      });

      let fullText = '';
      for await (const chunk of responseStream) {
        const text = chunk.text;
        if (text) {
          fullText += text;
          if (onDelta) {
            onDelta(text);
          }
        }
      }

      if (fullText) {
        return fullText;
      }
    } catch (err: any) {
      console.warn(`Model ${model} failed, trying next candidate:`, err?.message || err);
      lastError = err;
    }
  }

  throw lastError || new Error('No se pudo generar respuesta de Gemini.');
}

export async function handleGeminiImage(prompt: string, size = '1024x1024'): Promise<string> {
  // First attempt: Gemini Imagen 3
  try {
    const ai = getGeminiClient();
    const res = await ai.models.generateImages({
      model: 'imagen-3.0-generate-002',
      prompt,
      config: {
        numberOfImages: 1,
        outputMimeType: 'image/jpeg',
      },
    });

    const b64 = res.generatedImages?.[0]?.image?.imageBytes;
    if (b64) {
      return `data:image/jpeg;base64,${b64}`;
    }
  } catch (err: any) {
    console.warn('Imagen 3 generation fallback:', err?.message || err);
  }

  // Fallback: Pollinations AI with Flux model
  const [w, h] = size.split('x').map((n) => parseInt(n, 10) || 1024);
  const seed = Math.floor(Math.random() * 1e9);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h}&nologo=true&model=flux&seed=${seed}`;

  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.startsWith('image/')) {
      const buf = Buffer.from(await res.arrayBuffer());
      return `data:${ct};base64,${buf.toString('base64')}`;
    }
  } catch (e) {
    console.warn('Pollinations fetch error:', e);
  }

  return url;
}

export function fallbackCleanTitle(raw: string): string {
  if (!raw) return 'Nueva conversación';
  let t = raw.trim();

  // Strip greetings and opening filler phrases
  t = t.replace(/^(?:hola(?:[\s,]+ori[oó]n)?|buenas(?:[\s,]+tardes|[\s,]+noches|[\s,]+d[ií]as)?|oye(?:[\s,]+ori[oó]n)?|saludos|hey|hi)\b[,\s.:;-]*/i, '');
  t = t.replace(/^(?:por\s+favor|podr[ií]as|puedes|me\s+gustar[ií]a|quisiera|quiero|necesito|ay[uú]dame\s+a|dime|expl[ií]came|cu[eé]ntame|sabes|c[oó]mo\s+hago\s+para)\s+/i, '');
  t = t.replace(/^(?:d[oó]nde\s+(?:queda|est[aá]|se\s+encuentra))\s+/i, 'Ubicación ');
  t = t.replace(/^[¿?¡!"'«»“”\s]+|[¿?¡!"'«»“”\s]+$/g, '');

  if (!t) return 'Conversación con Orión';

  const words = t.split(/\s+/).filter(Boolean);
  let short = words.slice(0, 5).join(' ');
  if (short.length > 36) {
    short = short.slice(0, 36).replace(/\s+\S*$/, '');
  }

  return short.charAt(0).toUpperCase() + short.slice(1);
}

export async function generateChatTitle(firstMessage: string): Promise<string> {
  const text = (firstMessage || '').trim();
  if (!text) return 'Nueva conversación';

  const prompt = `Eres Orión Estellar. Genera un título muy corto, conciso y coherente para una conversación que comienza con este mensaje o pregunta inicial del usuario.
Reglas estrictas:
- Máximo 3 a 5 palabras (entre 10 y 35 caracteres).
- Debe resumir el tema principal o la intención de la pregunta de forma coherente y clara.
- En el mismo idioma que el mensaje (generalmente español).
- NO uses comillas, NO pongas punto final, NO incluyas prefijos como "Título:" ni nada adicional. Solo el título limpio.

Mensaje inicial del usuario:
"${text.slice(0, 280)}"`;

  const candidateModels = ['gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-flash-latest'];
  for (const model of candidateModels) {
    try {
      const ai = getGeminiClient();
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          temperature: 0.2,
          maxOutputTokens: 25,
        },
      });

      let rawTitle = response.text?.trim() || '';
      rawTitle = rawTitle
        .replace(/^["'«»“](.*)["'«»”]$/, '$1')
        .replace(/^(?:t[ií]tulo|tema|asunto):\s*/i, '')
        .replace(/[.!?]+$/, '')
        .trim();

      if (rawTitle && rawTitle.length >= 3 && rawTitle.length <= 50) {
        return rawTitle;
      }
    } catch (e: any) {
      console.warn(`generateChatTitle with model ${model} failed:`, e?.message || e);
    }
  }

  return fallbackCleanTitle(text);
}
