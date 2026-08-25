# Crit 4 reflection

**What was the breakthrough that moved the work forward?**

The breakthrough wasn't a technical fix, it was noticing that "too many
shapes on screen" wasn't a rate problem. My first instinct was to throttle
the drag trail harder, but a slower trigger would have made a fast drag look
sparse and broken instead of calm. The actual issue was that trail stamps and
attack stamps looked identical, so a drag read as a pile-up of full-strength
shapes rather than a wake behind the note you were actually playing. Once I
separated "how often" from "how loud," giving trail stamps their own shorter
fade and a dimmer colour, the drag suddenly read as one continuous gesture
instead of clutter. That distinction — visual hierarchy is a separate lever
from event frequency — is something I'll reach for again any time repeated
feedback (sound, animation, anything continuous) risks drowning out the
moment that actually matters.

**What did this work change about who I want to be as a software developer?**

I want to be someone who treats "it feels cluttered" as a real, actionable
bug report rather than a vague complaint to smooth over later. Playing the
instrument myself, and reacting honestly to it feeling too busy, was more
useful than any amount of staring at the code would have been — the fix only
became obvious once I'd actually dragged across the pad and felt what was
wrong. I want to keep building things I test by using, not just by reading,
especially for anything meant to be felt rather than read.
