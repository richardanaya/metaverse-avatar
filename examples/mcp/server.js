import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import { WebSocketServer } from 'ws';
import { z } from 'zod';

import { SceneBridge } from './bridge.js';
import { ANIMATION_REGISTRY } from '../common/registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..'); // repo root (served statically)

// Load secrets (XAI_API_KEY) from .env at the project root, if present.
try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  // no .env — tools that need a key will report it when invoked
}

const PORT = Number(process.env.PORT) || 4173;

const bridge = new SceneBridge();
const transports = {};

// In-memory ring of the last N screenshots: name -> { buffer, contentType }.
// A Map preserves insertion order, so the oldest key is evicted first.
const SCREENSHOT_LIMIT = 25;
const screenshots = new Map();

function storeScreenshot(dataUrl) {
  const m = /^data:(image\/\w+);base64,(.+)$/s.exec(dataUrl ?? '');
  if (!m) throw new Error('Browser did not return a valid image data URL');
  const [, contentType, base64] = m;
  const ext = contentType.split('/')[1] === 'jpeg' ? 'jpg' : contentType.split('/')[1];
  const name = `screenshot_${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`;
  screenshots.set(name, { buffer: Buffer.from(base64, 'base64'), contentType });
  while (screenshots.size > SCREENSHOT_LIMIT) {
    screenshots.delete(screenshots.keys().next().value);
  }
  return name;
}

// In-memory ring of the last N synthesized speech clips, same scheme as the
// screenshots cache: name -> { buffer, contentType }, oldest evicted first.
const AUDIO_LIMIT = 25;
const audioClips = new Map();

function storeAudio(buffer, contentType) {
  const ext = contentType.includes('wav') ? 'wav' : 'mp3';
  const name = `speech_${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`;
  audioClips.set(name, { buffer, contentType });
  while (audioClips.size > AUDIO_LIMIT) {
    audioClips.delete(audioClips.keys().next().value);
  }
  return name;
}

// Parallel cache of per-character viseme timing files (xAI audio_timestamps),
// served as JSON alongside the matching audio clip for lip-sync.
const visemeFiles = new Map();

function storeViseme(timestamps) {
  const name = `viseme_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  visemeFiles.set(name, Buffer.from(JSON.stringify(timestamps)));
  while (visemeFiles.size > AUDIO_LIMIT) {
    visemeFiles.delete(visemeFiles.keys().next().value);
  }
  return name;
}

const XAI_VOICES = ['ara', 'eve', 'leo', 'rex', 'sal'];

// Call the xAI text-to-speech API and return the audio bytes + MIME type.
async function synthesizeSpeech({ text, voice }) {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new Error('XAI_API_KEY is not set — add it to the project .env');

  const res = await fetch('https://api.x.ai/v1/tts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      voice_id: voice || 'eve',
      language: 'en',
      with_timestamps: true, // per-character timing drives viseme lip-sync
      output_format: { codec: 'mp3', sample_rate: 24000, bit_rate: 128000 },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`xAI TTS request failed (${res.status}): ${detail.slice(0, 300)}`);
  }

  // with_timestamps makes the response JSON with base64 `audio` + the timing.
  // Fall back to raw-bytes handling if a non-JSON body ever comes back.
  const ctype = res.headers.get('content-type') || '';
  if (ctype.includes('application/json')) {
    const json = await res.json();
    if (!json.audio) throw new Error('xAI TTS JSON response had no audio field');
    return {
      buffer: Buffer.from(json.audio, 'base64'),
      contentType: json.content_type || 'audio/mpeg',
      timestamps: json.audio_timestamps ?? null,
    };
  }
  return { buffer: Buffer.from(await res.arrayBuffer()), contentType: ctype || 'audio/mpeg', timestamps: null };
}

// Cache synthesized clips by text+voice so repeated requests (the Voice tab
// Test button, repeated lines) don't re-bill the TTS API.
const speechCache = new Map();

async function getSpeech(text, voice) {
  const cacheKey = `${voice || 'eve'}::${text}`;
  let result = speechCache.get(cacheKey);
  if (!result) {
    result = await synthesizeSpeech({ text, voice });
    speechCache.set(cacheKey, result);
    while (speechCache.size > 20) speechCache.delete(speechCache.keys().next().value);
  }
  return result;
}

// Synthesize (cached) and publish to the served ring caches. Returns the
// relative urls the browser fetches for the audio + viseme timing files.
async function prepareSpeech(text, voice) {
  const { buffer, contentType, timestamps } = await getSpeech(text, voice);
  const audioName = storeAudio(buffer, contentType);
  const visemeName = timestamps ? storeViseme(timestamps) : null;
  return {
    audioName,
    bytes: buffer.length,
    audioPath: `/audio/${audioName}`,
    visemePath: visemeName ? `/viseme/${visemeName}` : null,
  };
}

function textResult(data) {
  return {
    content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
  };
}

// Optional avatar selector shared by the avatar-touching tools: a 0-based
// index or an avatar id string. Omitted → the active avatar.
const avatarSelector = z.union([z.number().int().nonnegative(), z.string()])
  .optional()
  .describe('Target avatar: 0-based index (see list_avatars) or its id. Defaults to the active avatar.');

function createMcpServer() {
  const server = new McpServer(
    {
      name: 'three-ruth',
      version: '1.0.0',
    },
    {
      instructions:
        'Trigger pre-authored BVH and glTF animations on the Ruth avatar in the connected browser scene. '
        + 'A browser tab must be open on the MCP tab for tools to work. '
        + 'WORKFLOW: call list_animations to see the available clips (ids are prefixed with "glb:" for glTF animations). '
        + 'For speech, use generate_speech to pre-synthesize text → returns url + visemeUrl + duration_estimate. '
        + 'Then use set_avatar_state_sequence to fire one or more states sequentially — each state bundles '
        + 'animation, speech_url, blink, look_at, and an optional duration_ms. '
        + 'The server auto-advances through states, waiting for each state\'s duration before the next. '
        + 'You can also use the individual tools: trigger_animation, avatar_text_to_speech (one-shot speak+play), '
        + 'set_avatar_blink, set_avatar_look_at, capture_screenshot, and get_avatar_transform.',
    },
  );

  server.tool(
    'list_animations',
    'Enumerate bundled BVH and glTF animations registered in the Animate tab. Returns { count, animations: [{ id, label, source, file? | glbAnimName? }] }. The `id` is what you pass to trigger_animation.',
    {},
    async () => textResult({
      count: ANIMATION_REGISTRY.length,
      animations: ANIMATION_REGISTRY.map(({ id, label, source, file, glbAnimName }) => ({
        id, label, source, ...(file ? { file } : {}), ...(glbAnimName ? { glbAnimName } : {}),
      })),
    }),
  );

  server.tool(
    'trigger_animation',
    'Play a registered animation (BVH or glTF) on an avatar. For the active avatar this uses the same code path as the Animate tab\'s dropdown (the dropdown updates to match); pass `avatar` to target a different one.',
    {
      id: z.string().describe('Animation id from list_animations, e.g. "wave", "idle"'),
      avatar: avatarSelector,
    },
    async ({ id, avatar }) => textResult(await bridge.request('trigger_animation', { id, avatar })),
  );

  server.tool(
    'capture_screenshot',
    'Render the current camera view in the browser and return a URL to the saved PNG. Use it to SEE the avatar — capture during an animation to check the result. The last 25 screenshots are kept in memory.',
    {},
    async () => {
      const { dataUrl, width, height } = await bridge.request('capture_screenshot');
      const name = storeScreenshot(dataUrl);
      return textResult({
        url: `http://localhost:${PORT}/images/${name}`,
        name,
        width,
        height,
      });
    },
  );

  server.tool(
    'avatar_text_to_speech',
    'Make the avatar SPEAK text out loud with synchronized lip movement. Synthesizes the text with the xAI TTS API, caches the audio clip, and plays it in the connected browser scene while driving the jaw (same lip-sync path as the microphone). Requires a browser tab open on the MCP tab and XAI_API_KEY in the server .env. Returns the cached audio url and clip duration.',
    {
      text: z.string().min(1).max(15_000).describe('What the avatar should say (1–15000 characters)'),
      voice: z.enum(XAI_VOICES).optional().describe(`Voice id (default "eve"). One of: ${XAI_VOICES.join(', ')}`),
      avatar: avatarSelector,
    },
    async ({ text, voice, avatar }) => {
      const { audioName, bytes, audioPath, visemePath } = await prepareSpeech(text, voice);
      // Absolute urls so the relayed play_speech (and the tool result) work for
      // any client; the browser fetches both the audio + viseme timing files.
      const url = `http://localhost:${PORT}${audioPath}`;
      const visemeUrl = visemePath ? `http://localhost:${PORT}${visemePath}` : undefined;
      // Resolves once the browser has started playback; allow extra time for
      // the clip to fetch + decode before play begins.
      const played = await bridge.request('play_speech', { url, visemeUrl, avatar }, 30_000);
      return textResult({ url, visemeUrl, name: audioName, voice: voice || 'eve', bytes, ...played });
    },
  );

  server.tool(
    'set_avatar_blink',
    "Control the avatar's automatic eye blinking (the Look at tab's blink controls). All fields are optional — supplied ones update, the rest keep their current value. Toggle with `enabled`; shape the pattern with `interval`, `variation`, and `speed`; `blink_now` fires a single immediate blink. Returns the resulting blink state.",
    {
      enabled: z.boolean().optional().describe('Turn auto-blink on or off'),
      interval: z.number().min(0.2).max(30).optional().describe('Mean seconds between blinks (default 3.5)'),
      variation: z.number().min(0).max(1).optional().describe('Interval randomness 0..1 (0.5 = ±50%, default 0.5)'),
      speed: z.number().min(0.04).max(2).optional().describe('Seconds for one close→open blink (default 0.12)'),
      blink_now: z.boolean().optional().describe('Trigger a single blink immediately'),
      avatar: avatarSelector,
    },
    async (args) => textResult(await bridge.request('set_blink', args)),
  );

  server.tool(
    'set_avatar_look_at',
    "Aim the avatar's eye look-at target and/or toggle eye tracking (the Look at tab). Pass `enabled` to turn tracking on/off, and any of `x`/`y`/`z` (scene world coordinates, Y up) to move the target — omitted coordinates keep their current value. With tracking on, the eyes follow the target. Use get_avatar_transform for the head's world position as a reference. Returns the resulting { enabled, position }.",
    {
      enabled: z.boolean().optional().describe('Turn eye look-at tracking on or off'),
      x: z.number().optional().describe('Target X in scene world space'),
      y: z.number().optional().describe('Target Y in scene world space (up)'),
      z: z.number().optional().describe('Target Z in scene world space'),
      avatar: avatarSelector,
    },
    async (args) => textResult(await bridge.request('set_look_at', args)),
  );

  server.tool(
    'get_avatar_transform',
    'Live avatar world transform plus head / pelvis world positions. Cheap introspection for placement and debugging. Pass `avatar` to inspect a specific one.',
    { avatar: avatarSelector },
    async ({ avatar }) => textResult(await bridge.request('get_avatar_transform', { avatar })),
  );

  server.tool(
    'list_avatars',
    'List every avatar currently in the scene. Returns { count, active, avatars: [{ index, id, active, position }] }. Use an avatar\'s `index` (or `id`) as the `avatar` argument to other tools to target it.',
    {},
    async () => textResult(await bridge.request('list_avatars')),
  );

  server.tool(
    'select_avatar',
    'Make a given avatar the ACTIVE one — the avatar the editor panel and the eye look-at tool drive. Returns { active }.',
    { avatar: avatarSelector },
    async ({ avatar }) => textResult(await bridge.request('select_avatar', { avatar })),
  );

  server.tool(
    'add_avatar',
    'Spawn a new avatar into the scene and make it active. Optionally place it at scene coordinates `x` / `z` (Y is the ground). Avatars otherwise fan out along X so they don\'t overlap. Returns { index, count }.',
    {
      x: z.number().optional().describe('Scene X position (defaults to an auto fan-out slot)'),
      z: z.number().optional().describe('Scene Z position (default 0)'),
    },
    async ({ x, z }) => textResult(await bridge.request('add_avatar', { x, z })),
  );

  server.tool(
    'generate_speech',
    'Synthesize speech text into an audio clip and viseme timing file using the xAI TTS API. Returns URLs you can pass to set_avatar_state for instant, zero-lag playback alongside other state changes. Cached per text+voice, so repeated calls return instantly. Does NOT play audio — use set_avatar_state with the returned URLs to play.',
    {
      text: z.string().min(1).max(15_000).describe('What the avatar should say (1–15000 characters). Requires XAI_API_KEY.'),
      voice: z.enum(XAI_VOICES).optional().describe(`Voice id (default "eve"). One of: ${XAI_VOICES.join(', ')}`),
    },
    async ({ text, voice }) => {
      const { audioName, bytes, audioPath, visemePath } = await prepareSpeech(text, voice);
      const url = `http://localhost:${PORT}${audioPath}`;
      const visemeUrl = visemePath ? `http://localhost:${PORT}${visemePath}` : undefined;
      // Estimate duration from MP3 byte count at 128 kbps CBR (bytes × 8 ÷ 128000).
      const durationEstimate = Math.round((bytes / 16000) * 1000) / 1000;
      return textResult({ url, visemeUrl, name: audioName, voice: voice || 'eve', bytes, duration_estimate: durationEstimate });
    },
  );

  server.tool(
    'set_avatar_state_sequence',
    'Play a sequence of avatar states one after another. Each state can specify an animation, speech clip (pre-generated via generate_speech), blink config, and eye look-at target. An optional duration_ms controls how long each state holds before advancing to the next — defaults to the speech duration if speech_url is provided, otherwise 3000 ms. Up to 20 states per sequence. States fire all their changes atomically, then the server waits the prescribed duration before moving to the next.',
    {
      states: z.array(
        z.object({
          avatar: avatarSelector,
          animation: z.string().optional().describe('Animation id from list_animations to play'),
          speech_url: z.string().url().optional().describe('Audio URL from generate_speech'),
          speech_viseme_url: z.string().url().optional().describe('Viseme JSON URL from generate_speech for lip-sync'),
          blink_enabled: z.boolean().optional().describe('Turn auto-blink on or off'),
          blink_interval: z.number().min(0.2).max(30).optional().describe('Mean seconds between blinks (default 3.5)'),
          blink_variation: z.number().min(0).max(1).optional().describe('Interval randomness 0..1 (default 0.5)'),
          blink_speed: z.number().min(0.04).max(2).optional().describe('Seconds for one close→open blink (default 0.12)'),
          blink_now: z.boolean().optional().describe('Trigger a single blink immediately'),
          look_at_enabled: z.boolean().optional().describe('Turn eye look-at tracking on or off'),
          look_at_x: z.number().optional().describe('Target X in scene world space'),
          look_at_y: z.number().optional().describe('Target Y in scene world space (up)'),
          look_at_z: z.number().optional().describe('Target Z in scene world space'),
          duration_ms: z.number().min(100).max(120_000).optional().describe('Milliseconds to hold this state before the next. Defaults to speech duration (if speech_url is set), otherwise 3000.'),
        }),
      ).min(1).max(20).describe('Ordered list of states to play sequentially'),
    },
    async ({ states }) => {
      const results = [];

      for (let i = 0; i < states.length; i++) {
        const s = states[i];
        const stateResult = {};
        const promises = [];

        const target = s.avatar; // optional per-state avatar selector

        // Animation
        if (s.animation) {
          promises.push((async () => {
            stateResult.animation = await bridge.request('trigger_animation', { id: s.animation, avatar: target });
          })());
        }

        // Speech — play a pre-generated clip (no synthesis delay).
        if (s.speech_url) {
          promises.push((async () => {
            const played = await bridge.request('play_speech', { url: s.speech_url, visemeUrl: s.speech_viseme_url, avatar: target }, 30_000);
            stateResult.speech = { url: s.speech_url, visemeUrl: s.speech_viseme_url, ...played };
          })());
        }

        // Blink
        const blinkArgs = {};
        if (s.blink_enabled !== undefined) blinkArgs.enabled = s.blink_enabled;
        if (s.blink_interval !== undefined) blinkArgs.interval = s.blink_interval;
        if (s.blink_variation !== undefined) blinkArgs.variation = s.blink_variation;
        if (s.blink_speed !== undefined) blinkArgs.speed = s.blink_speed;
        if (s.blink_now !== undefined) blinkArgs.blink_now = s.blink_now;
        if (Object.keys(blinkArgs).length > 0) {
          promises.push((async () => {
            stateResult.blink = await bridge.request('set_blink', { ...blinkArgs, avatar: target });
          })());
        }

        // Look at
        const lookAtArgs = {};
        if (s.look_at_enabled !== undefined) lookAtArgs.enabled = s.look_at_enabled;
        if (s.look_at_x !== undefined) lookAtArgs.x = s.look_at_x;
        if (s.look_at_y !== undefined) lookAtArgs.y = s.look_at_y;
        if (s.look_at_z !== undefined) lookAtArgs.z = s.look_at_z;
        if (Object.keys(lookAtArgs).length > 0) {
          promises.push((async () => {
            stateResult.look_at = await bridge.request('set_look_at', { ...lookAtArgs, avatar: target });
          })());
        }

        // Fire all changes for this state concurrently.
        await Promise.all(promises);

        // Determine wait duration.
        let waitMs = s.duration_ms;
        if (waitMs === undefined) {
          if (stateResult.speech?.duration) {
            waitMs = Math.ceil(stateResult.speech.duration * 1000);
          } else {
            waitMs = 3000;
          }
        }
        stateResult.held_ms = waitMs;
        results.push(stateResult);

        // Wait before advancing to the next state (skip after the last).
        if (i < states.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
      }

      return textResult({ sequence: results });
    },
  );

  return server;
}

const app = express();
app.use(express.json({ limit: '4mb' }));

// WebSocket bridge for the browser scene
const httpServer = app.listen(PORT);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', (ws) => {
  if (bridge.connected) ws.close(1008, 'Another browser tab is already connected');
  else {
    bridge.setClient(ws);
    console.log('Browser scene connected');
  }
  ws.on('message', (data) => bridge.handleMessage(String(data)));
  ws.on('close', () => {
    bridge.clearClient(ws);
    console.log('Browser scene disconnected');
  });
});

// MCP Streamable HTTP — no auth
app.post('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  let transport;

  try {
    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableDnsRebindingProtection: false,
        onsessioninitialized: (sid) => {
          transports[sid] = transport;
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) delete transports[transport.sessionId];
      };
      const server = createMcpServer();
      await server.connect(transport);
    } else {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32_000, message: 'Bad Request: invalid or missing session' },
        id: null,
      });
      return;
    }
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('MCP error:', err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32_603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

const sessionHandler = async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }
  await transports[sessionId].handleRequest(req, res);
};

app.get('/mcp', sessionHandler);
app.delete('/mcp', sessionHandler);

// In-memory screenshots captured via the capture_screenshot MCP tool.
app.get('/images/:name', (req, res) => {
  const shot = screenshots.get(req.params.name);
  if (!shot) {
    res.status(404).send('No such screenshot (it may have been evicted from the cache).');
    return;
  }
  res.type(shot.contentType).send(shot.buffer);
});

// Browser-facing TTS: synthesize (cached) a clip + viseme timing and return
// their urls. Used by the Voice tab's Test button so the page can generate
// speech directly with the server's xAI key (no MCP client needed).
const TEST_PHRASE = "Hi, I'm Ruth. This is a quick test of my voice and lip sync.";
app.post('/api/speak', async (req, res) => {
  try {
    const text = String(req.body?.text || TEST_PHRASE).slice(0, 15_000);
    const voice = req.body?.voice;
    const { audioPath, visemePath, bytes } = await prepareSpeech(text, voice);
    res.json({ url: audioPath, visemeUrl: visemePath || undefined, voice: voice || 'eve', bytes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// In-memory speech clips synthesized via the avatar_text_to_speech MCP tool.
app.get('/audio/:name', (req, res) => {
  const clip = audioClips.get(req.params.name);
  if (!clip) {
    res.status(404).send('No such audio (it may have been evicted from the cache).');
    return;
  }
  res.type(clip.contentType).send(clip.buffer);
});

// Per-character viseme timing files for the speech clips above.
app.get('/viseme/:name', (req, res) => {
  const buf = visemeFiles.get(req.params.name);
  if (!buf) {
    res.status(404).send('No such viseme file (it may have been evicted from the cache).');
    return;
  }
  res.type('application/json').send(buf);
});

// Static site — serve the whole repo so the example page can pull the library
// files, models/, and anims/ from their real locations, and the MCP demo lives
// at /examples/mcp/.
app.use(express.static(ROOT));

console.log(`metaverse-avatar MCP example  http://localhost:${PORT}/examples/mcp/`);
console.log(`  MCP    http://localhost:${PORT}/mcp  (no auth)`);
