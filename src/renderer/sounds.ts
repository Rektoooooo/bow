/**
 * WHY this file exists:
 *   Arc plays short, quiet sounds on some actions. Ours are synthesized here with Web Audio (nothing recorded or
 *   copied): a soft tick for closing a tab, a swoosh for clearing Today, a two-note chime for a Space switch, a pop
 *   for a new split and a shutter for a capture. Library › Settings turns them off.
 *
 * Data source:
 *   sidebar.ts (it sees each change of the state) and the main process (captures) tell which sound to play.
 *
 * Data flow:
 *   state change / "playSound" sidebar command → playSound(name) → a few oscillators or noise through a gain envelope
 */

import type { SoundName } from "../shared/actions.js";

/** Overall loudness (0…1). Our choice: audible in a quiet room, never startling. */
const MASTER_VOLUME = 0.12;

let audioContext: AudioContext | null = null;

/**
 * The shared audio context, made on first use (browsers allow it after the user has interacted with the page).
 */
function getAudioContext(): AudioContext {
  if (audioContext === null) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

/**
 * A gain node that fades a sound in fast and out over its length, connected to the speakers.
 */
function createEnvelope(context: AudioContext, startTime: number, lengthSeconds: number, peak: number): GainNode {
  const gain = context.createGain();
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(peak * MASTER_VOLUME, startTime + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + lengthSeconds);
  gain.connect(context.destination);
  return gain;
}

/**
 * A short tone sliding from one pitch to another.
 */
function playTone(context: AudioContext, fromHz: number, toHz: number, startTime: number, lengthSeconds: number, peak: number): void {
  const oscillator = context.createOscillator();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(fromHz, startTime);
  oscillator.frequency.exponentialRampToValueAtTime(toHz, startTime + lengthSeconds);
  oscillator.connect(createEnvelope(context, startTime, lengthSeconds, peak));
  oscillator.start(startTime);
  oscillator.stop(startTime + lengthSeconds + 0.02);
}

/**
 * A burst of filtered noise, its filter sliding from one frequency to another (a swoosh, or a click when short).
 */
function playNoise(context: AudioContext, fromHz: number, toHz: number, startTime: number, lengthSeconds: number, peak: number): void {
  const sampleCount = Math.ceil(context.sampleRate * lengthSeconds);
  const buffer = context.createBuffer(1, sampleCount, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < sampleCount; index++) {
    samples[index] = Math.random() * 2 - 1;
  }
  const source = context.createBufferSource();
  source.buffer = buffer;
  const filter = context.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 1.2;
  filter.frequency.setValueAtTime(fromHz, startTime);
  filter.frequency.exponentialRampToValueAtTime(toHz, startTime + lengthSeconds);
  source.connect(filter);
  filter.connect(createEnvelope(context, startTime, lengthSeconds, peak));
  source.start(startTime);
}

/** One layer of a sound: a tone or a noise burst, sliding from one frequency to another, starting a moment in. */
interface SoundLayer {
  kind: "tone" | "noise";
  fromHz: number;
  toHz: number;
  delaySeconds: number;
  lengthSeconds: number;
  peak: number;
}

/** Our sound designs (our choice, tuned by ear to be short and soft). */
const SOUND_DESIGNS: Record<SoundName, SoundLayer[]> = {
  closeTab: [{ kind: "tone", fromHz: 700, toHz: 380, delaySeconds: 0, lengthSeconds: 0.09, peak: 0.6 }],
  clearToday: [{ kind: "noise", fromHz: 2400, toHz: 380, delaySeconds: 0, lengthSeconds: 0.32, peak: 1.4 }],
  switchSpace: [
    { kind: "tone", fromHz: 880, toHz: 880, delaySeconds: 0, lengthSeconds: 0.12, peak: 0.35 },
    { kind: "tone", fromHz: 1320, toHz: 1320, delaySeconds: 0.05, lengthSeconds: 0.16, peak: 0.3 },
  ],
  split: [{ kind: "tone", fromHz: 420, toHz: 900, delaySeconds: 0, lengthSeconds: 0.07, peak: 0.6 }],
  capture: [
    { kind: "noise", fromHz: 5000, toHz: 1800, delaySeconds: 0, lengthSeconds: 0.035, peak: 1.6 },
    { kind: "noise", fromHz: 3000, toHz: 1200, delaySeconds: 0.06, lengthSeconds: 0.05, peak: 1.2 },
  ],
};

/**
 * Plays one of our sounds.
 */
export function playSound(name: SoundName): void {
  const context = getAudioContext();
  for (const layer of SOUND_DESIGNS[name]) {
    const startTime = context.currentTime + layer.delaySeconds;
    if (layer.kind === "tone") {
      playTone(context, layer.fromHz, layer.toHz, startTime, layer.lengthSeconds, layer.peak);
    } else {
      playNoise(context, layer.fromHz, layer.toHz, startTime, layer.lengthSeconds, layer.peak);
    }
  }
}
