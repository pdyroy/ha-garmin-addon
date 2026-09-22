# Changelog

## 1.2.2

- Strength training is now tracked by movement pattern rather than by muscle
  group. A new **Kraft** page under Training shows nine tiles — squat, hinge,
  lunge, horizontal and vertical push, horizontal and vertical pull, loaded
  carry, rotation/anti-rotation — and says which of them actually got loaded
  over a rolling 7- or 14-day window. A session count cannot answer that: a
  full-looking week routinely misses the horizontal pull and the carry.
- Sets, reps and weights are entered in the add-on, seven slots per exercise
  per day, over a seeded catalogue of 42 exercises tagged with equipment and
  whether they load one side at a time. Garmin's own strength tracking
  records that a session happened and nothing about its content, so it is not
  used as the source here.
- Coverage and staleness are deliberately separate horizons. A pattern counts
  as covered inside the window; it only raises a warning once more than ten
  days have passed since it was last trained at all, looking past the window
  to do so. A pattern never logged is reported as missing data rather than as
  a warning, so the first week of logging does not fire nine alarms.
- The coach can now read the strength log. A new prompt section carries
  pattern coverage, per-pattern recency and the heaviest logged set per
  exercise, and the grounding rules forbid inferring exercises or loads from
  a session's duration and heart rate — on a strength session, strain and
  average HR measure rest intervals, not mechanical load. When Garmin shows
  strength sessions but nothing is logged, the prompt says so explicitly
  instead of leaving a gap the model would fill with invention.
- **Fix:** German aggregate questions now widen the coach's activity window.
  The matcher that decides between 14 days / 10 activities and 365 days / 500
  was English-only, while the answer language is German — so "wie viele
  Kilometer bin ich dieses Jahr gelaufen?" was answered from two weeks of
  history. Both languages are recognised now, with a regression test.
- The coach's waiting indicator is a filling ring with the elapsed seconds in
  it, replacing the bouncing dots. It fills against the measured typical
  answer time and switches to a spinning arc once the wait stops being
  predictable, rather than sitting at 100% while nothing arrives.
- The per-agent YouTube search suggestions collapsed into one shared rule.
  Four agents carried three hardcoded example searches each, which padded
  every prompt and every answer with references the coach cannot verify.

## 1.2.1

- Replaced the out-of-date architecture diagram in the README with an
  accurate component table: added the Strava sync, coach-memory rebuild and
  Stress-Board rescore services, and corrected the notify cadence (60 min,
  not 30) and stress rescore (6 h, not hourly).

## 1.2.0

- The coach can now read the detail of a specific run instead of only the
  one-line summary in the prompt. Splits per kilometre, running form
  (cadence/SPM, ground-contact time, vertical oscillation, stride), HR
  zones and HR drift are rendered on demand, plus an opt-in downsampled
  per-minute HR/pace curve — all deterministic text, so it works the same
  on OpenRouter, Requesty and Ollama and stays fully private.
- The run a question names is now resolved properly: "wie war mein Lauf am
  Sonntag?" or "vom 06.09.?" targets that day's session (in the athlete's
  timezone) rather than the most recent one. Weekday and date forms
  (`DD.MM.`, `DD.MM.YYYY`, `YYYY-MM-DD`, compound nouns like `Sonntagslauf`)
  are recognised.

## 1.1.0

- **Security:** Home Assistant ingress is now verified instead of assumed.
  The add-on used to run with the session guard switched off entirely
  (`DEV_BYPASS_AUTH=true`) while the ingress proxy listened on
  `0.0.0.0:3000` in the shared hassio bridge network, so any other add-on
  could read the full health history and overwrite the Garmin tokens
  without a credential. The proxy now refuses peers other than the
  Supervisor and stamps a per-boot token on what it forwards; the app grants
  its single-user session only to requests carrying that token.
  `node scripts/test-ingress-proxy.js` checks the gate.
- **Security:** each process only receives the secrets it uses. The Garmin
  and Strava credentials are no longer in the environment of the Next.js
  server, and the internet-facing proxy now runs without any secret at all —
  previously every one of them, including the Garmin plaintext password,
  was exported process-wide and inherited by both.
- Added a fitness age: VO2max expressed as an age against the HUNT3
  reference cohort (Loe et al., PLoS One 2013), on the Fitness page and as
  `sensor.pacer_fitness_age`.
- Added a target bedtime and wake window, anchored on the chronotype where
  one is computable, as `sensor.pacer_bedtime_target` /
  `sensor.pacer_wake_window` plus a wind-down reminder blueprint.
- Added the Energiekonto page: the intraday Body Battery curve with every
  charge and drain attributed to sleep, an activity, or a part of the day.
  The intraday series comes from the Garmin stress payload the sync already
  fetched, so it costs no extra API call.
- Fixed the sleep page reading a field the engine does not return, which
  left "tonight's recommendation" blank and silently fell back to a
  hard-coded 8 h in the sleep-debt chart.
- Added NOTICE and per-file copyright for the files written in this fork.
- Removed the internal review reports from docs/.

## 1.0.0

First release under the name Pacer. Versioning restarts here; releases
before this point belong to the upstream projects listed in the README.

- Renamed the add-on to Pacer (slug `pacer`). Home Assistant treats this as
  a new add-on: fresh database, new `sensor.pacer_*` entity IDs.
- Added a native OpenRouter AI backend that calls the chat-completions API
  directly, bypassing the Home Assistant Conversation layer. The previous
  path relied on agent auto-discovery that could not see every conversation
  integration and silently fell back to the built-in Assist intent matcher.
- The image now builds entirely from vendored source in `pacer/app/` instead
  of cloning the application from GitHub at build time.
- Dropped `image:` from the manifest so Home Assistant builds locally.
- Removed boot-time migrations for data layouts this version never had, and
  a third, unused AI-backend abstraction.
- Removed the test suites except the engine unit tests, along with the CI
  automation and agent scaffolding that came with the upstream repositories.
