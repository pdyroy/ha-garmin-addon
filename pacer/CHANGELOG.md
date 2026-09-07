# Changelog

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
