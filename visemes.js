// Viseme model for speech lip-sync.
//
// xAI TTS returns per-character timing (graph_chars + graph_times). We map
// each grapheme to one of a small set of visemes, each a target for three
// mouth controls (consumed by RuthAvatar.setMouth):
//   open  — jaw drop (vowels)
//   round — lip pucker / protrude (o, u, w)
//   wide  — lip spread (e, i)
//
// English spelling → phoneme is irregular, so this is a heuristic grapheme
// mapping, not a phonemizer — but with correct timing and real closures
// (m/b/p shut the lips) it reads far better than amplitude-only jaw motion.

export const VISEMES = {
  sil: { open: 0.0,  round: 0.0,  wide: 0.0 },  // silence / rest (closed)
  PP:  { open: 0.0,  round: 0.0,  wide: 0.05 }, // p b m — lips closed
  FF:  { open: 0.12, round: 0.0,  wide: 0.25 }, // f v
  TH:  { open: 0.18, round: 0.0,  wide: 0.20 }, // th
  DD:  { open: 0.25, round: 0.0,  wide: 0.35 }, // generic consonant (d t n s z l c k g …)
  RR:  { open: 0.22, round: 0.35, wide: 0.0 },  // r
  AA:  { open: 0.90, round: 0.0,  wide: 0.20 }, // a
  E:   { open: 0.45, round: 0.0,  wide: 0.60 }, // e
  I:   { open: 0.28, round: 0.0,  wide: 0.80 }, // i y
  O:   { open: 0.55, round: 0.70, wide: 0.0 },  // o
  U:   { open: 0.32, round: 0.95, wide: 0.0 },  // u w
};

const CHAR_VISEME = {
  a: 'AA', e: 'E', i: 'I', o: 'O', u: 'U', y: 'I', w: 'U',
  m: 'PP', b: 'PP', p: 'PP',
  f: 'FF', v: 'FF',
  r: 'RR',
  // every other consonant collapses to a generic open-consonant shape
  d: 'DD', t: 'DD', n: 'DD', s: 'DD', z: 'DD', l: 'DD', c: 'DD',
  k: 'DD', g: 'DD', h: 'DD', j: 'DD', q: 'DD', x: 'DD',
};

export function charToViseme(ch) {
  return CHAR_VISEME[(ch ?? '').toLowerCase()] ?? 'sil'; // spaces / punctuation / digits
}

// Build a time-ordered list of { start, end, viseme } from xAI's
// audio_timestamps ({ graph_chars, graph_times: [[start, end], …] }).
export function buildVisemeTimeline(timestamps) {
  const chars = timestamps?.graph_chars ?? [];
  const times = timestamps?.graph_times ?? [];
  const segs = [];
  for (let i = 0; i < chars.length; i++) {
    const t = times[i];
    if (!t || typeof t[0] !== 'number') continue;
    segs.push({ start: t[0], end: typeof t[1] === 'number' ? t[1] : t[0], viseme: charToViseme(chars[i]) });
  }
  return segs;
}

// Target mouth controls for playback time `t` (seconds). Holds the most
// recently started viseme, relaxing to neutral during pauses between words.
export function sampleViseme(timeline, t) {
  if (!timeline || timeline.length === 0) return VISEMES.sil;
  let seg = null;
  for (const s of timeline) {
    if (s.start <= t) seg = s; else break;
  }
  if (!seg || t > seg.end + 0.12) return VISEMES.sil;
  return VISEMES[seg.viseme] ?? VISEMES.sil;
}
