# Changelog

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
