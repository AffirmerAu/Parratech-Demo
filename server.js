import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CONFIGURED_REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || null;
const REALTIME_VOICE = process.env.OPENAI_REALTIME_VOICE || 'alloy';
const REALTIME_MODEL =
  (CONFIGURED_REALTIME_MODEL && typeof CONFIGURED_REALTIME_MODEL === 'string'
    ? CONFIGURED_REALTIME_MODEL.trim()
    : '') || 'gpt-realtime-mini';

let cachedFetch = typeof fetch === 'function' ? fetch : null;

async function ensureFetch() {
  if (typeof cachedFetch === 'function') {
    return cachedFetch;
  }

  try {
    const undici = await import('undici');
    if (typeof undici.fetch === 'function') {
      cachedFetch = undici.fetch;
      return cachedFetch;
    }
  } catch (error) {
    console.error('Unable to load undici fetch implementation', error);
  }

  throw new Error('Fetch API is not available in this runtime.');
}

if (!OPENAI_API_KEY) {
  console.warn('Warning: OPENAI_API_KEY is not set. The /session endpoint will return an error.');
}

app.use(express.json());
const distPath = path.resolve(__dirname, 'dist');
app.use(express.static(distPath));

function buildRealtimeSessionHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${OPENAI_API_KEY}`,
    'OpenAI-Beta': 'realtime=v1',
  };
}

async function createRealtimeSession(model, instructions) {
  const fetchApi = await ensureFetch();

  const response = await fetchApi('https://api.openai.com/v1/realtime/sessions', {
    method: 'POST',
    headers: buildRealtimeSessionHeaders(),
    body: JSON.stringify({
      model,
      instructions,
      voice: REALTIME_VOICE,
    }),
  });

  if (response.ok) {
    return { ok: true, data: await response.json() };
  }

  const errorText = await response.text();
  return {
    ok: false,
    status: response.status,
    detail: errorText,
  };
}

app.get('/session', async (req, res) => {
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Missing OPENAI_API_KEY on the server.' });
  }

  const lang = typeof req.query.lang === 'string' && req.query.lang ? req.query.lang : 'en';
  const siteParam = typeof req.query.site === 'string' && req.query.site ? req.query.site : 'Parratech – Kings Park Site';

  const instructions = `You are the Induction Trainer. Speak ${lang}. For each step, read the provided line exactly. After each line, pause briefly. When you want the next video to play, emit the tag [SHOW:NEXT] on its own line. To replay, emit [REPLAY]. Do not invent content. Site: ${siteParam}.`;

  try {
    const result = await createRealtimeSession(REALTIME_MODEL, instructions);
    if (result.ok) {
      const payload = result.data && typeof result.data === 'object' ? { ...result.data } : result.data;
      if (payload && typeof payload === 'object' && !payload.model) {
        payload.model = REALTIME_MODEL;
      }
      res.json(payload);
      return;
    }

    const detailParts = [
      `status ${typeof result.status === 'number' ? result.status : 'unknown'}`,
      result.detail,
    ].filter(Boolean);

    const attemptSummary = detailParts.join(' - ');

    console.error('Failed to create realtime session with gpt-realtime-mini:', attemptSummary);
    res.status(500).json({
      error: 'Failed to create realtime session',
      details: attemptSummary || 'Unknown error while creating realtime session.',
    });
  } catch (error) {
    console.error('Realtime session error:', error);
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: 'Failed to contact OpenAI Realtime API', details: message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
