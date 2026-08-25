# Process overview

A reading-guide to how the work came together --- a map to your process, not an
essay about it. Markers read this file and follow its citations; they don't
trawl the repo for evidence you didn't point at, so if a moment mattered, cite
it.

This file is the shape; the course site's
[assessment page](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/topics/assessment/#what-you-submit)
is the requirement, and its
[word counts](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/topics/assessment/#word-counts)
cover every deliverable.

## What I built

A browser-based instrument: an XY pad you drag, tap, or play with the
keyboard, where X is quantized to a two-octave pentatonic scale (so there is
no wrong note) and Y drives loudness and filter brightness together, all
synthesised live through the Web Audio API rather than played back from a
file. Every note-on stamps a shape onto the pad --- which scale degree by which
polygon, repeated taps or a held note by escalating fill (hollow, then solid,
then striped) --- and dragging leaves a trail of smaller, dimmer, faster-fading
stamps so a slide reads as a continuous gesture. A record button captures a
phrase (pitch, glide, and timing) and a playback button replays it through the
same live synth path a second later, so you can hear a phrase back or play
over your own recording.

## The moments that mattered

1. **Quantizing pitch instead of trusting the ear.** The spec rules out a
   fail state or wrong notes, and the obvious approach --- map Y position
   continuously to frequency --- makes that a matter of taste, not structure:
   a player can still land between notes and it just sounds off. Instead,
   `xToStepIndex` floors the X position onto one of ten fixed pentatonic
   steps (`SCALE_DEGREES` across two octaves), so every possible drag or key
   lands on a real note by construction, not by luck. Verified against
   `spec/instrument.test.ts`'s playability checks and by ear: dragging fast
   across the pad glides between discrete pitches, it never lands on a
   dissonant interval.
   [`9b5c21f`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-aSH201807/commit/9b5c21f)

2. **Playback replays control data, not audio.** The easy way to add
   record/playback is to capture a `MediaRecorder` audio buffer and hand it
   back through an `<audio>` element --- except the spec explicitly rules out
   a static `<audio>`/`<video>` source, since the point is that sound is made
   live in the page. Instead, `recordEvent` taps the existing
   `noteOn`/`noteUpdate`/`noteOff` call sites and stores timestamped control
   events; `startPlayback` schedules those same three functions again later,
   with ids prefixed `r:` so a played-back phrase can never collide with (or
   block) whatever is played live at the same moment. Verified manually:
   recorded a phrase, played it back and watched the cursor re-trace it while
   dragging live on top of it at the same time, with neither voice getting
   stuck or cut off; `spec/instrument.test.ts`'s
   "no `<audio>`/`<video>`" assertion stayed green throughout.
   [`15be001`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-aSH201807/commit/15be001)

3. **Escalating fill by scale step, not by voice id.** For the shape/fill
   stamp system, the obvious counter to reach for is per-voice-id (per
   finger, per key) --- but that would mean the same physical note played by a
   different finger or key always starts back at "hollow," which doesn't
   read as the same note being repeated. Instead `fillCycle`/`lastAttackAt`
   are keyed by scale step index, so cycling hollow → solid → striped tracks
   "the same pitch again" regardless of which input produced it, and a held
   note re-fires the same check on an interval shorter than the repeat
   window, so holding escalates exactly like rapid tapping does. Verified via
   `pnpm check` (typecheck, build, and the full spec suite green) and by
   playing the same key repeatedly versus alternating two keys on the same
   scale step in a real browser.
   [`39dcf30`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-aSH201807/commit/39dcf30)

4. **Tuning the drag trail from feedback, not a guess.** Stamping on every
   `pointermove` would flood the pad with shapes, so drag trails are gated on
   a hybrid rule: always stamp on crossing into a new scale step, otherwise
   only once enough time and distance have passed. After trying it, the
   actual problem wasn't the trigger rate --- it was that trail stamps looked
   identical to attack stamps, so a drag read as a pile-up of full-brightness
   shapes. Rather than throttling harder (which would make a fast drag look
   sparse), `isTrail` stamps were given their own shorter fade duration and a
   lower `--light` CSS value, so trails read as a dim wake behind the
   brighter attack stamps instead of more of the same. Verified with
   `pnpm check` green, and by dragging across the pad in the browser before
   and after the change to confirm the trail was visibly calmer without
   losing the sense of a continuous gesture.
   [`d3bf7c7`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-aSH201807/commit/d3bf7c7)

## Before you ship

`pnpm check:evidence` verifies your citations resolve to real commits, that a
reflection entry the marker reads is in `reflections/`, and that your
`CLAUDE.md` is there --- before a marker ever opens the file. It checks that
your map is traceable, not that it is good: the marker judges whether your
small, deliberately chosen set of moments shows real judgement and reflection. A
green check is not a substitute for that curation.

Images aren't checked: whether one renders is visible the moment you look. Open
this file on GitHub and look at it before you ship.
