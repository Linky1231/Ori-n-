import type { IncomingMessage, ServerResponse } from 'http';
import { handleGeminiChat, handleGeminiImage, generateChatTitle, fallbackCleanTitle } from './gemini';
import { searchLocation, reverseGeocode } from './location';

async function parseJsonBody(req: IncomingMessage & { body?: any; rawBody?: string }): Promise<any> {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }
  if (req.rawBody) {
    try {
      return JSON.parse(req.rawBody);
    } catch {
      return {};
    }
  }
  if ((req as any).readableEnded) {
    return {};
  }
  return new Promise((resolve, reject) => {
    let body = '';
    const timer = setTimeout(() => {
      resolve(body ? JSON.parse(body) : {});
    }, 1500);

    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      clearTimeout(timer);
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  next?: () => void
): Promise<boolean> {
  const url = req.url || '';

  if (url === '/api/ai/chat' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const messages = body.messages || [];
      const mode = body.mode;
      const model = body.model;

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
      });

      await handleGeminiChat(
        messages,
        mode,
        (delta) => {
          const payload = JSON.stringify({ choices: [{ delta: { content: delta } }] });
          res.write(`data: ${payload}\n\n`);
        },
        (attachment) => {
          const payload = JSON.stringify({ attachment });
          res.write(`data: ${payload}\n\n`);
        },
        model
      );

      res.write('data: [DONE]\n\n');
      res.end();
    } catch (error: any) {
      console.error('Chat endpoint error:', error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error?.message || 'Error processing request' }));
      } else {
        res.write(`data: ${JSON.stringify({ error: error?.message })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      }
    }
    return true;
  }

  if (url === '/api/ai/image' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const prompt = body.prompt;
      const size = body.size;

      if (!prompt) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Falta la descripción de la imagen' }));
        return true;
      }

      const imageUrl = await handleGeminiImage(prompt, size);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ url: imageUrl }));
    } catch (error: any) {
      console.error('Image endpoint error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error?.message || 'Error generating image' }));
    }
    return true;
  }

  if (url === '/api/ai/title' && req.method === 'POST') {
    let rawText = '';
    try {
      const body = await parseJsonBody(req);
      rawText = body.text || '';
      const title = await generateChatTitle(rawText);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ title }));
    } catch (error: any) {
      console.error('Title generation endpoint error:', error);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ title: fallbackCleanTitle(rawText) }));
    }
    return true;
  }

  if (url.startsWith('/api/maps/search') && req.method === 'GET') {
    try {
      const parsedUrl = new URL(url, 'http://localhost:3000');
      const q = parsedUrl.searchParams.get('q') || '';
      const results = await searchLocation(q);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ results }));
    } catch (error: any) {
      console.error('Maps search error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error?.message || 'Error searching location', results: [] }));
    }
    return true;
  }

  if (url.startsWith('/api/maps/reverse') && req.method === 'GET') {
    try {
      const parsedUrl = new URL(url, 'http://localhost:3000');
      const lat = parseFloat(parsedUrl.searchParams.get('lat') || '');
      const lng = parseFloat(parsedUrl.searchParams.get('lng') || '');
      if (isNaN(lat) || isNaN(lng)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Coordenadas inválidas' }));
        return true;
      }
      const result = await reverseGeocode(lat, lng);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result }));
    } catch (error: any) {
      console.error('Maps reverse geocode error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error?.message || 'Error in reverse geocoding' }));
    }
    return true;
  }

  if (next) next();
  return false;
}
