// A theremin-style XY pad: X is quantized to a pentatonic scale (no wrong
// notes), Y drives loudness and filter brightness together. Pointer Events
// unify mouse/touch/pen; a home-row + arrow-key path gives keyboard players
// the same two independent dimensions.

const startButtonEl = document.getElementById("start");
const padEl = document.getElementById("pad");
const cursorEl = document.getElementById("cursor");
const stampsEl = document.getElementById("stamps");
const recordButtonEl = document.getElementById("record");
const playButtonEl = document.getElementById("playback");

if (
  !(startButtonEl instanceof HTMLButtonElement) ||
  !(padEl instanceof HTMLDivElement) ||
  !(cursorEl instanceof HTMLDivElement) ||
  !(stampsEl instanceof SVGSVGElement) ||
  !(recordButtonEl instanceof HTMLButtonElement) ||
  !(playButtonEl instanceof HTMLButtonElement)
) {
  throw new Error(
    "instrument: expected #start, #pad, #cursor, #stamps, #record and #playback in the DOM",
  );
}

// Re-bind to non-nullable consts: narrowing above doesn't survive into the
// closures declared below, but a fresh const captures the narrowed type.
const startButton: HTMLButtonElement = startButtonEl;
const pad: HTMLDivElement = padEl;
const cursor: HTMLDivElement = cursorEl;
const stamps: SVGSVGElement = stampsEl;
const recordButton: HTMLButtonElement = recordButtonEl;
const playButton: HTMLButtonElement = playButtonEl;

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function expLerp(a: number, b: number, t: number): number {
  return a * (b / a) ** t;
}

// Minor pentatonic, root A3, 2 octaves = 10 discrete steps -- one per
// keyboard key below, so both input paths land on the same 10 pitches.
const SCALE_DEGREES = [0, 3, 5, 7, 10];
const ROOT_HZ = 220;
const OCTAVES = 2;
const STEPS = Array.from({ length: OCTAVES }, (_, octave) =>
  SCALE_DEGREES.map((degree) => degree + octave * 12),
).flat();
const KEYBOARD_KEYS = ["a", "s", "d", "f", "g", "h", "j", "k", "l", ";"];

function xToStepIndex(t: number): number {
  return clamp(Math.floor(t * STEPS.length), 0, STEPS.length - 1);
}

function xyToFreq(t: number): number {
  return ROOT_HZ * 2 ** (STEPS[xToStepIndex(t)] / 12);
}

function yToParams(u: number): { gain: number; cutoff: number } {
  return { gain: lerp(0.03, 0.28, u), cutoff: expLerp(300, 4000, u) };
}

function gainScaleFactor(y: number): number {
  const { gain } = yToParams(y);
  return lerp(0.7, 1.4, (gain - 0.03) / (0.28 - 0.03));
}

interface Voice {
  osc: OscillatorNode;
  gain: GainNode;
  filter: BiquadFilterNode;
  x: number;
  y: number;
  holdTimer: number;
}

const voices = new Map<string, Voice>();
const ATTACK = 0.02;
const RELEASE = 0.12;
const GLIDE = 0.05;

type RecordedEvent =
  | { t: number; kind: "on"; id: string; x: number; y: number }
  | { t: number; kind: "update"; id: string; x: number; y: number }
  | { t: number; kind: "off"; id: string };

let recording = false;
let recordStart = 0;
let recordedEvents: RecordedEvent[] = [];
let playing = false;
let playbackTimers: number[] = [];

function recordEvent(kind: RecordedEvent["kind"], id: string, x?: number, y?: number): void {
  if (!recording) return;
  const t = performance.now() - recordStart;
  if (kind === "off") {
    recordedEvents.push({ t, kind, id });
  } else {
    recordedEvents.push({ t, kind, id, x: x ?? 0, y: y ?? 0 });
  }
}

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;

function ensureAudio(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
    const compressor = audioCtx.createDynamicsCompressor();
    compressor.connect(audioCtx.destination);
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 1;
    masterGain.connect(compressor);
  }
  if (audioCtx.state === "suspended") {
    void audioCtx.resume();
  }
  return audioCtx;
}

function noteOn(id: string, x: number, y: number): void {
  const ctx = ensureAudio();
  if (!masterGain) return;
  if (voices.has(id)) {
    noteUpdate(id, x, y);
    return;
  }
  recordEvent("on", id, x, y);
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = 0.7;
  const gain = ctx.createGain();
  const { gain: peak, cutoff } = yToParams(y);
  const now = ctx.currentTime;
  osc.frequency.setValueAtTime(xyToFreq(x), now);
  filter.frequency.setValueAtTime(cutoff, now);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(peak, now + ATTACK);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);
  osc.start(now);
  const voice: Voice = { osc, gain, filter, x, y, holdTimer: 0 };
  voices.set(id, voice);
  // While held, keep re-stamping at the current position on the same
  // cadence as a rapid re-tap, so a long press escalates the fill just
  // like tapping the same note repeatedly does.
  voice.holdTimer = window.setInterval(() => {
    const rect = pad.getBoundingClientRect();
    spawnAttackStamp(voice.x, voice.y, voice.x * rect.width, (1 - voice.y) * rect.height);
  }, HOLD_INTERVAL_MS);
}

function noteUpdate(id: string, x: number, y: number): void {
  const voice = voices.get(id);
  if (!voice || !audioCtx) return;
  recordEvent("update", id, x, y);
  const now = audioCtx.currentTime;
  const { gain: peak, cutoff } = yToParams(y);
  voice.osc.frequency.setTargetAtTime(xyToFreq(x), now, GLIDE);
  voice.filter.frequency.setTargetAtTime(cutoff, now, GLIDE);
  voice.gain.gain.setTargetAtTime(peak, now, GLIDE);
  voice.x = x;
  voice.y = y;
}

function noteOff(id: string): void {
  const voice = voices.get(id);
  if (!voice || !audioCtx) return;
  window.clearInterval(voice.holdTimer);
  recordEvent("off", id);
  const now = audioCtx.currentTime;
  const { osc, gain, filter } = voice;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(0, now + RELEASE);
  osc.stop(now + RELEASE + 0.02);
  osc.addEventListener("ended", () => {
    osc.disconnect();
    filter.disconnect();
    gain.disconnect();
  });
  voices.delete(id);
}

function syncActiveState(): void {
  const active = voices.size > 0;
  pad.classList.toggle("is-idle", !active);
  pad.classList.toggle("is-active", active);
}

function visualize(px: number, py: number, y: number): void {
  const scale = gainScaleFactor(y);
  const hue = lerp(260, 20, y);
  cursor.style.transform = `translate(${px}px, ${py}px) scale(${scale.toFixed(3)})`;
  cursor.style.setProperty("--hue", hue.toFixed(1));
}

// One low-poly shape per pentatonic degree (a 100x100 local box, centred on
// (50,50)) -- degree = stepIndex % SCALE_DEGREES.length picks the shape,
// octave picks its base size. Paths drawn by hand, not generated, so they
// stay simple, readable polygons rather than perfect regular ones.
const SHAPE_PATHS = [
  "M50,10 L84.64,70 L15.36,70 Z", // triangle
  "M22,22 L78,22 L78,78 L22,78 Z", // square
  "M50,10 L90,50 L50,90 L10,50 Z", // diamond
  "M36,14 L64,14 L64,36 L86,36 L86,64 L64,64 L64,86 L36,86 L36,64 L14,64 L14,36 L36,36 Z", // cross
  "M50,10 L88.04,37.64 L73.51,82.36 L26.49,82.36 L11.96,37.64 Z", // pentagon
];

const FILL_STATES = ["hollow", "solid", "striped"] as const;
type FillState = (typeof FILL_STATES)[number];

// Rapid re-attacks of the *same* scale step cycle the fill state -- one
// counter per step, not per voice id, so it tracks "the same note again"
// regardless of which finger/key produced it. A held note re-runs the same
// check on a timer (HOLD_INTERVAL_MS < REPEAT_WINDOW_MS), so holding down
// escalates the fill exactly like tapping the same note repeatedly does.
const REPEAT_WINDOW_MS = 400;
const HOLD_INTERVAL_MS = 350;
const STAMP_FADE_MS = 550;
const lastAttackAt: number[] = new Array(STEPS.length).fill(-Infinity);
const fillCycle: number[] = new Array(STEPS.length).fill(0);

const SVG_NS = "http://www.w3.org/2000/svg";

function spawnStamp(
  px: number,
  py: number,
  shapeIndex: number,
  fill: FillState,
  hue: number,
  diameterPx: number,
): void {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", `pad-stamp pad-stamp--${fill}`);
  g.style.setProperty("--hue", hue.toFixed(1));

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", SHAPE_PATHS[shapeIndex]);
  g.appendChild(path);

  if (fill === "striped") {
    const overlay = document.createElementNS(SVG_NS, "path");
    overlay.setAttribute("d", SHAPE_PATHS[shapeIndex]);
    overlay.setAttribute("class", "pad-stamp-overlay");
    g.appendChild(overlay);
  }

  stamps.appendChild(g);

  // Pop in past the target size with an overshoot ease, then settle back
  // down and dissolve -- a stamp landing, not just a fade. A small random
  // tilt keeps repeated shapes from reading as stickers on a grid.
  const scale = diameterPx / 80;
  const rotation = (Math.random() - 0.5) * 30;
  const at = (s: number) =>
    `translate(${px}px, ${py}px) rotate(${rotation.toFixed(1)}deg) scale(${s.toFixed(3)}) translate(-50px, -50px)`;
  const anim = g.animate(
    [
      { transform: at(scale * 0.4), opacity: 0.9, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" },
      { transform: at(scale * 1.2), opacity: 1, offset: 0.35, easing: "ease-in" },
      { transform: at(scale * 0.8), opacity: 0, offset: 1 },
    ],
    { duration: STAMP_FADE_MS, fill: "forwards" },
  );
  anim.addEventListener("finish", () => g.remove());
}

function spawnAttackStamp(x: number, y: number, px: number, py: number): void {
  const stepIndex = xToStepIndex(x);
  const degree = stepIndex % SCALE_DEGREES.length;
  const octave = Math.floor(stepIndex / SCALE_DEGREES.length);

  const now = performance.now();
  fillCycle[stepIndex] =
    now - lastAttackAt[stepIndex] < REPEAT_WINDOW_MS
      ? (fillCycle[stepIndex] + 1) % FILL_STATES.length
      : 0;
  lastAttackAt[stepIndex] = now;

  const hue = lerp(260, 20, y);
  const baseDiameter = octave === 0 ? 34 : 74;
  const diameterPx = baseDiameter * gainScaleFactor(y);
  spawnStamp(px, py, degree, FILL_STATES[fillCycle[stepIndex]], hue, diameterPx);
}

function pointerToFraction(e: PointerEvent): { x: number; y: number; px: number; py: number } {
  const rect = pad.getBoundingClientRect();
  const px = clamp(e.clientX - rect.left, 0, rect.width);
  const py = clamp(e.clientY - rect.top, 0, rect.height);
  const x = rect.width > 0 ? px / rect.width : 0.5;
  const y = rect.height > 0 ? 1 - py / rect.height : 0.5;
  return { x, y, px, py };
}

pad.classList.add("is-idle");

pad.addEventListener("pointerdown", (e) => {
  pad.setPointerCapture(e.pointerId);
  const { x, y, px, py } = pointerToFraction(e);
  noteOn(`p${e.pointerId}`, x, y);
  visualize(px, py, y);
  spawnAttackStamp(x, y, px, py);
  syncActiveState();
});

pad.addEventListener("pointermove", (e) => {
  const id = `p${e.pointerId}`;
  if (!voices.has(id)) return;
  const { x, y, px, py } = pointerToFraction(e);
  noteUpdate(id, x, y);
  visualize(px, py, y);
});

function endPointer(e: PointerEvent): void {
  const id = `p${e.pointerId}`;
  if (voices.has(id)) {
    noteOff(id);
    syncActiveState();
  }
}

pad.addEventListener("pointerup", endPointer);
pad.addEventListener("pointercancel", endPointer);
pad.addEventListener("pointerleave", (e) => {
  // Pointer capture keeps a drag "inside" logically even once the cursor
  // visually leaves; only release here for pointers that were never captured.
  if (pad.hasPointerCapture(e.pointerId)) return;
  endPointer(e);
});

let keyboardY = 0.5;

window.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
  if (KEYBOARD_KEYS.includes(key)) {
    if (e.repeat) return;
    const index = KEYBOARD_KEYS.indexOf(key);
    const x = (index + 0.5) / KEYBOARD_KEYS.length;
    noteOn(`k${key}`, x, keyboardY);
    const rect = pad.getBoundingClientRect();
    const px = x * rect.width;
    const py = (1 - keyboardY) * rect.height;
    visualize(px, py, keyboardY);
    spawnAttackStamp(x, keyboardY, px, py);
    syncActiveState();
    return;
  }
  if (key === "arrowup" || key === "arrowdown") {
    e.preventDefault();
    keyboardY = clamp(keyboardY + (key === "arrowup" ? 0.05 : -0.05), 0, 1);
    const rect = pad.getBoundingClientRect();
    let lastX: number | null = null;
    for (const [id, voice] of voices) {
      if (!id.startsWith("k")) continue;
      noteUpdate(id, voice.x, keyboardY);
      lastX = voice.x;
    }
    if (lastX !== null) {
      visualize(lastX * rect.width, (1 - keyboardY) * rect.height, keyboardY);
    }
  }
});

window.addEventListener("keyup", (e) => {
  const key = e.key.toLowerCase();
  if (!KEYBOARD_KEYS.includes(key)) return;
  const id = `k${key}`;
  if (voices.has(id)) {
    noteOff(id);
    syncActiveState();
  }
});

window.addEventListener("blur", () => {
  for (const id of [...voices.keys()]) noteOff(id);
  syncActiveState();
});

let started = false;
let muted = false;

startButton.addEventListener("click", () => {
  const ctx = ensureAudio();
  if (!started) {
    started = true;
    startButton.textContent = "\u{1F507} Mute";
    return;
  }
  muted = !muted;
  if (masterGain) {
    const now = ctx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.linearRampToValueAtTime(muted ? 0 : 1, now + 0.05);
  }
  startButton.setAttribute("aria-pressed", String(muted));
  startButton.textContent = muted ? "\u{1F507} Muted" : "\u{1F50A} Mute";
});

// Playback replays a recording through the same noteOn/noteUpdate/noteOff
// used for live input, with ids prefixed "r:" so it can never collide with
// (and never blocks) whatever's playing live at the same time.
function stopPlayback(): void {
  for (const timer of playbackTimers) clearTimeout(timer);
  playbackTimers = [];
  for (const id of [...voices.keys()]) {
    if (id.startsWith("r:")) noteOff(id);
  }
  playing = false;
  playButton.textContent = "\u{25B6} Play recording";
  syncActiveState();
}

function startPlayback(): void {
  if (recordedEvents.length === 0 || playing) return;
  playing = true;
  playButton.textContent = "⏹ Stop";
  ensureAudio();
  const rect = pad.getBoundingClientRect();
  for (const ev of recordedEvents) {
    const timer = window.setTimeout(() => {
      const id = `r:${ev.id}`;
      if (ev.kind === "on") {
        noteOn(id, ev.x, ev.y);
        const px = ev.x * rect.width;
        const py = (1 - ev.y) * rect.height;
        visualize(px, py, ev.y);
        spawnAttackStamp(ev.x, ev.y, px, py);
      } else if (ev.kind === "update") {
        noteUpdate(id, ev.x, ev.y);
        visualize(ev.x * rect.width, (1 - ev.y) * rect.height, ev.y);
      } else {
        noteOff(id);
      }
      syncActiveState();
    }, ev.t);
    playbackTimers.push(timer);
  }
  const lastEvent = recordedEvents[recordedEvents.length - 1];
  const endTimer = window.setTimeout(
    () => {
      playing = false;
      playButton.textContent = "\u{25B6} Play recording";
    },
    lastEvent.t + RELEASE * 1000 + 50,
  );
  playbackTimers.push(endTimer);
}

recordButton.addEventListener("click", () => {
  if (playing) return;
  if (!recording) {
    recording = true;
    recordedEvents = [];
    recordStart = performance.now();
    recordButton.textContent = "⏺ Stop recording";
    recordButton.setAttribute("aria-pressed", "true");
    playButton.disabled = true;
    pad.classList.add("is-recording");
  } else {
    recording = false;
    recordButton.textContent = "⏺ Record";
    recordButton.setAttribute("aria-pressed", "false");
    pad.classList.remove("is-recording");
    playButton.disabled = recordedEvents.length === 0;
  }
});

playButton.addEventListener("click", () => {
  if (recording) return;
  if (playing) stopPlayback();
  else startPlayback();
});
