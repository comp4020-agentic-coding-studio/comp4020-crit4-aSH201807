// A theremin-style XY pad: X is quantized to a pentatonic scale (no wrong
// notes), Y drives loudness and filter brightness together. Pointer Events
// unify mouse/touch/pen; a home-row + arrow-key path gives keyboard players
// the same two independent dimensions.

const startButtonEl = document.getElementById("start");
const padEl = document.getElementById("pad");
const cursorEl = document.getElementById("cursor");

if (
  !(startButtonEl instanceof HTMLButtonElement) ||
  !(padEl instanceof HTMLDivElement) ||
  !(cursorEl instanceof HTMLDivElement)
) {
  throw new Error("instrument: expected #start, #pad and #cursor in the DOM");
}

// Re-bind to non-nullable consts: narrowing above doesn't survive into the
// closures declared below, but a fresh const captures the narrowed type.
const startButton: HTMLButtonElement = startButtonEl;
const pad: HTMLDivElement = padEl;
const cursor: HTMLDivElement = cursorEl;

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

function xyToFreq(t: number): number {
  const index = clamp(Math.floor(t * STEPS.length), 0, STEPS.length - 1);
  return ROOT_HZ * 2 ** (STEPS[index] / 12);
}

function yToParams(u: number): { gain: number; cutoff: number } {
  return { gain: lerp(0.03, 0.28, u), cutoff: expLerp(300, 4000, u) };
}

interface Voice {
  osc: OscillatorNode;
  gain: GainNode;
  filter: BiquadFilterNode;
  x: number;
  y: number;
}

const voices = new Map<string, Voice>();
const ATTACK = 0.02;
const RELEASE = 0.12;
const GLIDE = 0.05;

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
  voices.set(id, { osc, gain, filter, x, y });
}

function noteUpdate(id: string, x: number, y: number): void {
  const voice = voices.get(id);
  if (!voice || !audioCtx) return;
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
  const { gain } = yToParams(y);
  const scale = lerp(0.7, 1.4, (gain - 0.03) / (0.28 - 0.03));
  const hue = lerp(260, 20, y);
  cursor.style.transform = `translate(${px}px, ${py}px) scale(${scale.toFixed(3)})`;
  cursor.style.setProperty("--hue", hue.toFixed(1));
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
    visualize(x * rect.width, (1 - keyboardY) * rect.height, keyboardY);
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
