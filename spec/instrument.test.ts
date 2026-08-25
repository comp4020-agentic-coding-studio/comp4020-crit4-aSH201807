import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

// This week's published spec (crits/04-instrument) turned into contracts.
// Judged-by-ear/eye lines are left to the crit, not tested here:
//   - "expressive: the player's choices shape what they hear, and two players
//     sound different"
//   - "the browser is the instrument — sound is made live in the page by the
//     player, not played back" (beyond the static-<audio>/<video> floor below)
//   - "you can account for how you directed, grounded and corrected the work"
// See spec/README.md for what "deployed and live" and "the starter's
// invariant checks pass" already cover elsewhere.

const doc = new JSDOM(readFileSync(resolve("dist/index.html"), "utf8")).window.document;

// Scoped to <main>, not the whole page: the template's own <nav> already
// contains a real <a href>, which would make these pass against the
// unmodified starter and defeat the point of a red-first test.
const CONTROLS_SELECTOR =
  'main button, main a[href], main [role="button"][tabindex], main [role="slider"][tabindex]';

describe("instrument spec: playability", () => {
  it("offers at least one native interactive control on load", () => {
    // "a stranger can play it uninstructed" and "playable with whatever is at
    // hand — mouse, keyboard or touch" both need a real affordance: a native
    // control (button, link, or an explicit [role]+[tabindex] pairing) gets
    // click, touch and keyboard activation for free, without bespoke handlers
    // for each input type.
    const controls = doc.querySelectorAll(CONTROLS_SELECTOR);
    expect(
      controls.length,
      "no native interactive element found in <main> — a stranger needs something obvious to press, and it needs to work by mouse, touch, or keyboard alike",
    ).toBeGreaterThan(0);
  });

  it("does not gate the first sound behind instructions", () => {
    // The opening screen should invite the first sound, not explain it first.
    // A floor check: the control isn't hidden or disabled at load.
    const controls = doc.querySelectorAll(CONTROLS_SELECTOR);
    const usable = Array.from(controls).some(
      (el) => !el.hasAttribute("disabled") && !el.hasAttribute("hidden"),
    );
    expect(
      usable,
      "every candidate control is disabled or hidden on load — nothing is playable before the player does something else first",
    ).toBe(true);
  });
});

describe("instrument spec: no fail state", () => {
  it("has no score or game-over markup", () => {
    // "there is no way to play it wrong — no score, no fail state"
    const flagged = doc.querySelectorAll(
      '[data-testid*="score" i], [data-testid*="fail" i], [data-testid*="game-over" i]',
    );
    expect(
      flagged.length,
      `found scoring/fail-state markup: ${Array.from(flagged)
        .map((el) => el.outerHTML)
        .join(", ")}`,
    ).toBe(0);
  });

  it("has no score or game-over language in the visible text", () => {
    const text = doc.body.textContent ?? "";
    expect(/game over|you (win|lose|lost)|\bscore\s*:/i.test(text), text).toBe(false);
  });
});

describe("instrument spec: live sound, not playback", () => {
  it("does not ship a static <audio>/<video> element as the sound source", () => {
    // A floor only: a plain <audio src> or <video> is a played-back file, the
    // opposite of "sound is made live in the page by the player". This can't
    // prove the sound is synthesised live — that's judged by ear at the crit.
    const playback = doc.querySelectorAll("audio, video");
    expect(
      playback.length,
      `found ${playback.length} <audio>/<video> element(s) — sound should be synthesised live (e.g. Web Audio API), not played back from a file`,
    ).toBe(0);
  });
});
