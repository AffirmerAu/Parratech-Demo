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

let fetchImpl = globalThis.fetch;

async function fetchWithFallback(...args) {
  if (!fetchImpl) {
    const mod = await import('node-fetch');
    fetchImpl = mod.default;
  }
  return fetchImpl(...args);
}

if (!OPENAI_API_KEY) {
  console.warn('Warning: OPENAI_API_KEY is not set. The /session endpoint will return an error.');
}

app.use(express.json());
const distPath = path.resolve(__dirname, 'dist');
app.use(express.static(distPath));

app.get('/session', async (req, res) => {
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Missing OPENAI_API_KEY on the server.' });
  }

  const lang = typeof req.query.lang === 'string' && req.query.lang ? req.query.lang : 'en';
  const siteParam = typeof req.query.site === 'string' && req.query.site ? req.query.site : 'Parratech – Kings Park Site';

  const instructions = [
    `You are the Induction Trainer. Speak ${lang}.`,
    'For each step, read the provided line exactly. After each line, pause briefly.',
    'When you want the next video to play, emit the tag [SHOW:NEXT] on its own line.',
    'To replay, emit [REPLAY]. Do not invent content.',
    `Site: ${siteParam}.`,
  ].join(' ');

  try {
    const response = await fetchWithFallback('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-realtime-mini',
        instructions,
        voice: 'verse',
        modalities: ['audio', 'text'],
        input_audio_format: 'wav',
        output_audio_format: 'wav',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to create realtime session:', response.status, errorText);
      return res.status(500).json({ error: 'Failed to create realtime session', details: errorText });
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Realtime session error:', error);
    res.status(500).json({ error: 'Failed to contact OpenAI Realtime API' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
