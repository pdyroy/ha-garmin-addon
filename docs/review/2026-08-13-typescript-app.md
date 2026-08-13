# Pacer TypeScript-App — Review-Bericht

## 1. Zustand

Die App ist funktional weit gebaut, aber die Datenschicht ist unsicher (`drizzle-kit push --force` gegen die Live-DB bei jedem Boot, zwei Spaltengruppen fehlen im Schema und werden dabei gelöscht) und ein großer Teil der angezeigten Zahlen ist falsch berechnet — nicht kaputt, sondern plausibel falsch, was schlimmer ist. Das Theming existiert als Token-System, wird aber auf ganzen Seiten durch hartkodierte Zinc-/Black-/White-Klassen umgangen, weshalb im hellen Modus mehrere Seiten schwarz und im dunklen Modus eine Seite weiß-auf-weiß rendert. Engine-Funktionen bekommen an mehreren Stellen pro-Aktivität-Arrays, wo sie pro-Kalendertag-Serien erwarten — das verfälscht Readiness, ACWR und CTL/ATL systematisch.

---

## 2. Theme-Bug (weiß auf weiß / schwarze Seiten im Light-Mode)

### Ursache

Drei unabhängige Ursachen, die zusammen genau die beiden gemeldeten Symptome erzeugen:

**(a) Ganze Seiten setzen Hintergrund und/oder Text hart, ohne `dark:`-Gegenstück.** Der Text darin hat keine Farbklasse und erbt `--foreground` vom `<body>` — im hellen Palette-Set nahezu schwarz, im dunklen nahezu weiß. Ergebnis: schwarzer Hintergrund + schwarzer Text (Light-Mode) bzw. weißer Hintergrund + weißer Text (Dark-Mode).

**(b) Für dunkle Flächen gewählte Tailwind-Farben (`text-*-400`) auf 10–20 %-Tints.** 232 Vorkommen in 26 Dateien; nur `today-recommendation-card.tsx:48` liefert ein Light-Pendant.

**(c) Das Pre-Hydration-Theme-Skript liest `localStorage` ohne try/catch** (`packages/ui/src/theme.tsx:82`). In HA-Ingress läuft die App in einem iframe; bei Safari ITP / Firefox Strict / blockiertem Third-Party-Storage wirft der Zugriff, die IIFE bricht ab, `<html>` bekommt **gar keine** Klasse. Alle Varianten (`light`/`dark`/`auto`, styles.css:7-9) sind klassengebunden, es gibt keinen `prefers-color-scheme`-Fallback. Ergebnis: helle Tokens + dunkles hartkodiertes Markup, ThemeToggle rendert leer. Das erklärt das „manchmal".

### Konkrete Fundstellen

**Vollflächig falscher Seitenhintergrund**
- `apps/nextjs/src/app/insights/page.tsx:552` — `min-h-screen bg-black`; Header (`:555`) und Datum (`:557`) ohne Farbklasse → schwarz auf schwarz. **Fix:** Wrapper löschen, `<body>` malt bereits `bg-background`.
- `apps/nextjs/src/app/stress-board/page.tsx:373` — `bg-zinc-950 text-zinc-200`, 52 Zinc-Literale, kein `dark:`. Seite ist permanent dunkel; das global gemountete HamburgerMenu rendert hell darüber.
- `apps/nextjs/src/app/coach/page.tsx:373` — `bg-zinc-950` + hartkodierter Header (`:375`), Agent-Tabs (`:399`), Bubbles (`:289`), Chips (`:517`), Composer (`:543`). 27 Klassen, kein `dark:`.
- `apps/nextjs/src/app/zones/page.tsx:577,646,780,871,979,997` — `bg-zinc-900 border-zinc-800`-Karten in einem `<main>` ohne Hintergrund (`:517`); Kartentitel nutzen `text-muted-foreground` → ~3.3:1 auf `#18181b`. Dazu Selektor-Pills `:528,:544` und Kalender-Tooltip `:1258`.

**Dark-Mode weiß auf weiß (das gemeldete „weiß auf weiß mit Schrift")**
- `apps/nextjs/src/app/debug/page.tsx:135,178,209` — `bg-white`, dazu `bg-gray-50` (`:167,199,228`) und `bg-blue-50` (`:238`), kein `dark:`. Überschriften (`:136,179,210`) und alle Wert-`<td>` (`:152-165,187-197,216-226`) erben das im Dark-Mode nahezu weiße `--foreground`. **Fix:** `bg-white→bg-card`, `bg-gray-50→bg-muted`, `bg-blue-50→bg-primary/10`, `text-gray-500→text-muted-foreground`, `text-gray-700→text-foreground`.

**Für Dark getunte Textfarben auf hellem Grund**
- `_components/quick-stats.tsx:22-28,44` — `text-green-400` auf `bg-green-500/10` etc., ~1.5:1 im Light-Mode. Betrifft die Headline-Kennzahlen des Dashboards. Gleiches Muster 232× app-weit.
- `vitals/page.tsx:55,82,109,136,163,190` (`text-zinc-400` auf `bg-zinc-500/20`, ~1.9:1) und `:43,:49` (yellow/red-400); `hrv/page.tsx:53` identisch. Betrifft auch das „🚨 Critical"-Badge.
- `fitness/page.tsx:800,838,900` — `bg-zinc-800/60` mit geerbtem Foreground; die Race-Prognosen (`:811`) sind die Hauptzahlen der Seite, ~2:1.
- `trends/page.tsx:170,164,781,787,797,807` — `bg-zinc-800/50` + `text-zinc-300`/`text-zinc-400` für alle „weak"-Korrelationen.
- `correlations/page.tsx:216,227` — Diagonale und Leerzellen ~2.2–2.5:1.
- `_components/info-button.tsx:38,43-46` — `border-zinc-600 text-zinc-400` ohne Hintergrund; Popover hartkodiert `bg-zinc-800`. `SectionHeader` (`:73`) rendert das neben fast jeder Sektionsüberschrift der App.

**Punktuelle Kontrast-Ausfälle**
- Alle Recharts-Tooltips: `TOOLTIP_STYLE = { backgroundColor: "#18181b", … }` **ohne `color`** — `zones/page.tsx:74` sowie `power:247,309`, `vitals:415`, `fitness:522,605,676`, `hrv:316,397`, `training:220,413,471,659,707,883`, `zones:607,703,829,916,1027`. `.recharts-tooltip-label` erbt `--foreground` → schwarz auf schwarz im Light-Mode. (`sleep`/`trends` entkommen nur wegen `labelStyle`.) **Fix:** ein gemeinsames `contentStyle` mit `var(--popover)`/`var(--popover-foreground)` statt 18 Kopien.
- Achsen/Grid hartkodiert `#888`/`#333`: `fitness:506,508,512`, `power:236,239,242,294,300,304`, `vitals:394,400,405,425,429`, `training`, `hrv`, `zones:592,598`. Auf weißem `bg-card`: fast schwarzes Grid, ausgewaschene Ticks.
- `_components/dashboard-home.tsx:218,230` — `hover:bg-zinc-800/80`, Label erbt Foreground → Text verschwindet beim Hover. **Fix:** `hover:bg-accent`.
- `insights/page.tsx:169` — `hover:text-white` auf `bg-card` (weiß) → „Mark as read" verschwindet beim Hover. **Fix:** `hover:text-foreground`.
- `_components/readiness-card.tsx:223` und `insights/page.tsx:157` — `bg-white/5` auf weißer Karte = unsichtbarer Container. **Fix:** `bg-muted/60`.
- `_components/daily-outlook-card.tsx:63,73`, `quick-stats.tsx:55`, `sleep/page.tsx:895` — `bg-zinc-700/800` als Progress-Track in weißen Karten. **Fix:** `bg-muted` / Marker `bg-foreground`.
- `settings/page.tsx:953` — `hover:text-accent-foreground` aus `variant="outline"` überschreibt `text-white`; Label wird beim Hover pink auf purple (~1.8:1).

### Ehrlichkeitsvorbehalt

Die Befunde erklären **schwarze Seiten im Light-Mode** vollständig (insights, stress-board, coach, zones) und **weiß-auf-weiß** nur für **eine** Route: `/debug` im Dark-Mode. Wenn weiß-auf-weiß auch anderswo auftrat, ist das durch Ursache (c) erklärbar (keine Theme-Klasse → helle Tokens + dunkles Markup), aber es gibt keinen zweiten konkret belegten Fundort. Falls das Symptom auf einer anderen Seite reproduzierbar ist, fehlt dafür noch ein Befund.

### Reihenfolge der Behebung

1. `theme.tsx:82` in try/catch + `@media (prefers-color-scheme: dark)`-Block in theme.css spiegeln — behebt die intermittente Variante und ist eine Datei.
2. `bg-black`/`bg-zinc-9xx`/`bg-white`-Seitenwrapper auf Tokens umstellen (5 Dateien).
3. Ein gemeinsames Tooltip-`contentStyle` + Achsenfarben als CSS-Variablen.
4. Semantische Status-Tokens (`--success`/`--warning`/`--danger`) in theme.css, dann die 232 `text-*-400` darauf umstellen — das ist der große, aber mechanische Rest.

---

## 3. Übrige Befunde nach Schwere

### Kritisch — Datenverlust bei jedem Neustart

**Schema und Live-DB divergieren; `push --force` löscht die Differenz.**
Das Boot-Skript führt `npx drizzle-kit push --force` gegen die Nutzer-DB aus (`rootfs/etc/s6-overlay/s6-rc.d/pacer/run:138`), `drizzle.config.ts` setzt keinen `tablesFilter`. Alles, was nicht in `schema.ts` steht, wird verworfen.

- **`packages/db/src/schema.ts:127` — `Activity`: `strava_activity_id` und `source_platform` fehlen.** Beide existieren nur, weil `strava-sync.py:161,180` sie per `ADD COLUMN IF NOT EXISTS` nachträgt, zusammen mit dem Unique-Constraint `activity_strava_id_uq` (`strava-sync.py:166-177`), von dem `ON CONFLICT (strava_activity_id)` (`:252`) abhängt. Das Boot-Skript trägt sie **nicht** nach.
  *Was der Nutzer sieht:* Nach jedem Neustart werden die Spalten leer neu angelegt; `ON CONFLICT` matcht wegen NULL nichts, alle Strava-Aktivitäten der letzten 7 Tage werden dupliziert. Nach drei Neustarts steht derselbe Longrun viermal in `activity`. `metrics-compute.py` summiert TRIMP darüber → CTL/ATL/TSB/ACWR, Readiness und Coach melden eine um den Faktor „Anzahl Neustarts" aufgeblähte Last. `migrate_legacy_strava_user_id` (`:198`) wird still zum No-Op.
  *Fix:* `stravaActivityId: t.bigint({ mode: "number" }).unique()` und `sourcePlatform: t.varchar({ length: 20 }).default("garmin")` in `schema.ts` deklarieren; `ensure_strava_column()` danach als idempotentes Sicherheitsnetz belassen oder entfernen.

- **`packages/db/src/schema.ts:70` — `DailyMetric`: `data_quality`, `weight_kg`, `body_fat_pct`, `garmin_readiness_factors` fehlen.** Geschrieben von `garmin-sync.py:600-610`, gelesen über die Materialized View `create_daily_athlete_summary.sql:44,48-49,55`. Nachgetragen wird erst *nach* dem Push (`run:146,158,170,172`) — `ADD COLUMN IF NOT EXISTS` stellt die Spalte wieder her, nie die Daten.
  *Was der Nutzer sieht:* Zwei Ausgänge. (a) Wenn der Push die View zuerst droppt: die gesamte Gewichts- und Körperfett-Historie ist weg — Garmin liefert die nicht rückwirkend nach, die Trendkurve ist dauerhaft leer. (b) Wenn nicht: Postgres verweigert `DROP COLUMN data_quality` wegen der View-Abhängigkeit, der Push bricht mitten drin ab, das Skript schluckt das als „Schema push had warnings". Da `push` nicht transaktional läuft, landet **ab da nie wieder** eine echte Schemaänderung — ein späteres Add-on-Update mit neuer Spalte erzeugt 500er auf jeder Seite, die sie liest.
  *Fix:* Die vier Spalten in `schema.ts` deklarieren, die `ALTER TABLE`-Zeilen in `run` löschen. Mittelfristig: `push --force` gegen eine Produktiv-DB durch versionierte `drizzle-kit migrate`-Migrationen ersetzen.

### Hoch

**Gesundheitsdaten gehen trotz `ai_backend: none`/`ollama` an HA's Cloud-Agent** — `packages/api/src/router/chat.ts:183`
Einzige Backend-Auswahl ist `isOpenRouterConfigured()`; alles andere fällt in den `else` (`:191`) und ruft `haConversationChat`. `SUPERVISOR_TOKEN` ist immer gesetzt, `discoverAgent` bevorzugt gezielt Google/OpenAI/Anthropic-Einträge. `run:374-418` loggt derweil „AI backend: rules-based (no LLM)".
*Sichtbar:* Wer `ollama` wählt, um lokal zu bleiben, schickt bei konfigurierter HA-Google-Integration jede Coach-Nachricht inkl. `- Medications:`, `- Allergies:`, `- Health conditions:`, `- Current injuries:` (`data-context.ts:447-467`) an Google. Ollama wird nur erreicht, wenn der Cloud-Call wirft.
*Fix:* Explizit auf `process.env.AI_BACKEND` verzweigen; `none` → direkt `generateFallbackResponse`.

**Prompt wird bei 4000 Zeichen hart abgeschnitten** — `packages/api/src/lib/data-context.ts:1185`
`result.slice(0, cap)` nach dem Zusammenbau. Metric-Availability-JSON allein ~1600 Zeichen. Alles ab Abschnitt 3b (YTD-Summary, Zonen, Schlaf, Readiness, SpO2, Journal, Interventionen, Advanced Load, Baselines, Trends, Chart-Guide) fällt regelmäßig weg; `slice` schneidet mitten in Zahlen („- CTL: 43.2 → 5").
*Sichtbar:* Frage „Zusammenfassung aller Läufe dieses Jahr" → `detectAggregateIntent` weitet die Query auf 365 Tage/500 Zeilen (`:87`), die Aktivitätsliste frisst das Budget, und ausgerechnet der `## Activity Summary (Year to Date)`-Block (`:573`) fliegt als erstes raus. Antwort um Größenordnungen falsch. Im Normalfall verschwinden Schlaf/Trends → „I don't have that data yet" für korrekt berechnete Werte.
*Fix:* Pro Sektion budgetieren statt den fertigen String zu schneiden; Prioritätsreihenfolge JSON → YTD → Trends → Readiness/Schlaf → Aktivitäten, Aktivitätsliste kürzen statt Aggregate. Minimum: an der letzten `\n` schneiden.

**Pro-Aktivität-Arrays in Engines, die Kalendertage erwarten** *(drei Befunde zusammengelegt — gemeinsame Ursache)*
- `data-context.ts:499` — `strainScores` (`:481`) ist ein Eintrag pro Aktivität, max. 10, an `computeTrainingLoads` (erwartet tägliche Samples inkl. Ruhetag-Nullen), `computeACWR` (7d/28d-Slices) und `countConsecutiveHardDays` übergeben.
- `packages/api/src/router/readiness.ts:378` — `recentActivities` (`:276-282`) = 7 Tage, ein Element pro Aktivität, geht an `calculateReadiness` → `scoreTrainingLoad` → `computeACWR`. `computeTargetStrain(…, cachedStrainScores.slice(0,14))` (`:341,401`) hat denselben Fehler; das `length >= 7`-Gate feuert bei 7 Aktivitäten, nicht 7 Tagen. `analytics.ts:42-89` dokumentiert genau diesen Defekt und löst ihn mit `aggregateDailyLoads` — `readiness.ts` hat den Fix nie bekommen.
- `packages/engine/src/strain/index.ts:112` — `computeACWR` verstärkt das: bei `len <= 7` sind `acuteDays` und `chronicDays` identisch, das Ergebnis ist **exakt 1.00**, egal wie die Last verteilt ist. `computeACWR([20,20,20,1,1,1,1])` = `computeACWR([10,10,10,10,10,10,10])` = 1.00.

*Sichtbar:* Wer 3×/Woche trainiert, bekommt die letzten 10 Sessions über 23 Tage als 10 aufeinanderfolgende Tage gerechnet. CTL überhöht (keine Nullen dämpfen den EWMA), „Consecutive hard days: 4" für vier Einheiten über zwei Wochen, und die 20 %-gewichtete Load-Komponente der Readiness steht konstant bei 87/100 („well managed") — auch während eines echten Lastsprungs. Der Prompt sagt dann „ACWR 1.52 (High injury risk)" und der Coach rät zum Trainingsstopp.
*Fix:* `aggregateDailyLoads` nach `lib/` extrahieren, 28+ Tage laden, nach `dayInTimezone` bucketen, mit Nullen auffüllen, an alle drei Aufrufer geben (`workout.ts:79-87` braucht das ebenfalls). `computeACWR` soll bei <14 Tagen `null` liefern statt zwei identische Fenster zu dividieren. Achtung: `readiness.test.ts:176-196` („handles under-training (low ACWR)") verdeckt das — das Fixture hat ACWR 1.00, nicht niedrig.

**Bis zu 14 Tage alte Werte werden als „heute" ausgegeben** *(drei Befunde zusammengelegt)*
- `data-context.ts:672` — `todayMetric = metrics14[0]` (`:307`) ist die neueste Zeile im 14-Tage-Fenster, ohne Datumsprüfung. Ausgegeben als `hrv_status: "available"` (`:323-338`) und als „- Today's HRV: X ms". `as_of_date` (`:309`) bevorzugt `latestReadiness.date` und stempelt so das heutige Datum auf wochenalte Werte.
- `packages/api/src/router/proactive.ts:82` — dasselbe, inklusive `severity: critical` „🫁 SpO2 Critically Low — 91%" mit dem Text „Today's blood oxygen …" aus einer drei Tage alten Messung, gespeichert unter dem heutigen Datum (`:468`).
- `packages/api/src/router/readiness.ts:382` — `metricInputs[0]` ist die neueste vorhandene Zeile, wird als `todayMetrics` gescort und mit `date: today` persistiert (`:408`). Der Cache-Zweig (`:294-300`) gibt sie den Rest des Tages unverändert zurück, auch wenn der echte Sync um 08:00 nachkommt.

*Sichtbar:* Bricht der Garmin-Sync am Montag, meldet die App am Freitag Montags HRV als heutige, und die Datengrounding-Regel („I don't have that data yet") feuert nie, weil `statusFor` nur auf `null` prüft. Ein medizinisch formulierter SpO2-Alarm wird aus einer drei Tage alten Messung erzeugt.
*Fix:* Für alles, was „today" heißt, auf `m.date === today` filtern und sonst als `unavailable` markieren bzw. das echte Datum ausschreiben. In `readiness.ts` den vorhandenen `todayDbMetric`-Query (`:261`) nutzen und bei Abwesenheit `null` liefern; Cache über `existing.computedAt < todayDbMetric.syncedAt` invalidieren.

**„Heute" ist der UTC-Tag, der Sync schreibt in der Athleten-Zeitzone** — `packages/api/src/router/readiness.ts:219`
`getDateString()` = `new Date().toISOString().split("T")[0]`. `garmin-sync.py:87` nutzt `datetime.now(USER_TZ).date()`. Derselbe Helper ist nach `workout.ts:23`, `trends.ts:113`, `sleep.ts:46`, `vitals.ts:9`, `hrv.ts:9`, `data-quality.ts:15`, `baselines.ts:9` kopiert; `proactive.ts:40` und `advanced-metrics.ts:130` inlinen ihn. `lib/timezone.ts` exportiert bereits das korrekte `todayInTimezone()`, genutzt nur in `coach.ts:689` und `analytics.ts:82`.
*Sichtbar:* Ein Athlet in Sydney sieht die ersten elf Stunden jedes Tages gestrige Readiness, gestriges Workout und gestrige Recovery-Schätzung. Westlich von UTC spiegelbildlich abends.
*Fix:* Die sieben Kopien löschen, alles über `todayInTimezone(profile?.timezone)` + `shiftIsoDay` führen (Muster: `coach.ts:686-689`).

**`workout.getToday` löscht die Workout-Zeile und damit den Erledigt-Status** — `packages/api/src/router/workout.ts:71`
Bei Zonen-Mismatch DELETE + INSERT (`:69-76`, `:133-155`). Die gelöschte Zeile trägt `status` (von `coach.reconcile`, `coach.ts:982-990`), `weeklyPlanId` und `adjustDifficulty`-Edits. `zone` fällt bei fehlender Readiness auf `"moderate"` zurück (`:61`), der Mismatch feuert also regelmäßig. Eine `.query()` schreibt hier destruktiv, und `DailyWorkout` (`schema.ts:258`) hat **keinen** Unique-Index auf (userId, date) — *dieser Befund ist mit dem separaten Schema-Befund zusammengelegt*.
*Sichtbar:* Morgens ohne Readiness generiertes Workout wird absolviert und auf `completed` gesetzt; nach dem 10-Uhr-Sync ist die Zone „high", die erledigte Einheit wird gelöscht und als `planned` neu angelegt. Die Session verschwindet aus dem Plan, `coach.adherenceTrend` (`coach.ts:507`) meldet den Tag als verpasst, die Streak reißt. Ohne Unique-Index können zwei parallele Aufrufe (RSC-Prefetch + Client-Refetch, zwei Tabs) zwei Zeilen für denselben Tag anlegen; `findFirst` ohne `orderBy` liefert dann mal die eine, mal die andere — die Empfehlung wechselt beim Reload, `getWeekPlan` (`:161-167`) zeigt den Tag doppelt, `adjustDifficulty` (`:190-242`) editiert nur eine und wirkt in der Hälfte der Fälle nicht.
*Fix:* `uniqueIndex("daily_workout_user_date_unique").on(userId, date)` in `schema.ts:258`, DELETE+INSERT durch ein `onConflictDoUpdate` ersetzen, `status`/`weeklyPlanId`/`id` erhalten, Regeneration verweigern sobald `status !== "planned"`.

**„Stunden bis erholt" basiert auf der letzten Aktivität überhaupt** — `packages/api/src/router/analytics.ts:585`
`findFirst` nur nach `userId`, ohne Datumsgrenze. `estimateRecoveryTime` (`engine/src/training-status/index.ts:162-184`) misst ab der Einheit, nicht ab jetzt; nichts zieht die verstrichene Zeit ab. Zusätzlich `readiness?.score ?? 50` (`:620`), was in den `>= 40`-Zweig fällt und pauschal +20 % addiert.
*Sichtbar:* Nach zehn Tagen Pause zeigt die Anzeige jeden Tag „60h until recovered" für eine Einheit, die 240 h zurückliegt, und zählt nie herunter.
*Fix:* Query auf `gte(startedAt, now - 4d)` begrenzen, bei leerem Ergebnis „erholt" liefern, `(Date.now() - startedAt)/3.6e6` abziehen, Readiness als `null` durchreichen statt 50 zu erfinden.

**z-Score-Sigmoid ist 3× zu steil** — `packages/engine/src/baselines/index.ts:165`
`zScoreToScore(z, steepness = 1.5)` — der Kommentar direkt darüber dokumentiert „z = 1 → ≈73, z = 2 → ≈88", das entspricht steepness ≈ 0.5. Mit 1.5 sind es 95.3 / 4.7 bei ±1 und 99.8 / 0.2 bei ±2. `readiness/index.ts:147-150` wiederholt die falschen Zahlen. `scoreHRV`, `scoreRestingHR` und `scoreSleepQuantity` laufen alle da durch, sobald eine SD vorliegt — und `computeBaselines` liefert nie SD 0, es fällt auf die Populations-SD zurück.
*Sichtbar:* Drei der sechs Readiness-Komponenten sind faktisch binär: neutral nur innerhalb ±0.3 SD, sonst am Anschlag. HRV-Baseline 45 ms/SD 10, eine ganz normale Nacht mit 35 ms (ca. jeder 6. Tag) → HRV-Komponente 4.7 statt 27. Die Readiness schwankt bei physiologischem Rauschen um 15–20 Punkte und kippt die Zone.
*Fix:* Default auf `steepness = 0.5`. `src/__tests__/validation.test.ts:173-198` zementiert die gesättigten Werte und muss mit angepasst werden; der z-Pfad hat sonst keine Testabdeckung.

**Zwei inkompatible Kodierungen für `sleep_start_time`/`sleep_end_time`** — `packages/db/src/schema.ts:104`
Deklariert als `t.varchar({ length: 10 })` ohne dokumentiertes Format. Produktion (`garmin-sync.py:371-389`) schreibt Minuten seit Mitternacht (`"420"`), der Seed (`packages/db/src/seed.ts:601-602`) Uhrzeiten (`"06:14"`). `sleep.ts:125-126` liest sie als Minuten, `sleep.ts:95` reicht denselben Rohwert an die Engine, deren Parameter explizit `wakeTimeHHMM // "06:30" format` heißt und bei `:` splittet (`engine/src/sleep-coach/index.ts:126`).
*Sichtbar:* Mit echten Garmin-Daten wird `"420".split(":")` zu `[420]`, `wakeM` ist `undefined`, der Guard (`:127`) scheitert, `recommendedBedtime` bleibt `null`. `sleep/page.tsx:362` rendert `Bedtime: {…}` unbedingt → dauerhaft das nackte Label „Bedtime:" ohne Wert. Der Bedtime-Hinweis auf `/insights` (`:318-319`) verschwindet still. Lokal funktioniert es, weil der Seed Uhrzeiten schreibt.
*Fix:* Auf `sleepStartTimeMinutes`/`sleepEndTimeMinutes: t.integer()` umstellen, `seed.ts:601-602` anpassen, an der einen Aufrufstelle `sleep.ts:95` nach „HH:MM" formatieren.

**Load-Focus-Tortendiagramm zeigt erfundene Prozente** — `apps/nextjs/src/app/training/page.tsx:909`
`getFocusPieData()` gibt konstant 70/30, 30/70 oder 50/50 zurück, abhängig nur vom kategorialen String `loads.data.loadFocus`. Keine Aerob/Anaerob-Minuten werden gelesen. Der Infotext behauptet „Zone minute aggregation over selected period", der Recharts-Tooltip präsentiert die Zahlen als echt.
*Sichtbar:* Ein zu 95 % Z1-2 trainierender Athlet und einer mit 72 % sehen exakt dasselbe Diagramm: 70 % / 30 %.
*Fix:* Echte Zonenminuten aus `analytics.getTrainingLoads` durchreichen — oder den Donut streichen und nur das qualitative Badge plus korrigierten Infotext zeigen.

**Grade-Adjusted Pace um Faktor 100 zu klein und in die falsche Richtung** — `apps/nextjs/src/app/activities/[id]/page.tsx:865`
`gap = avgPaceSecPerKm * (1 + (elevationGain / distanceMeters) * 0.033)`. Der Quotient ist die Steigung als Bruch, der Koeffizient 0.033 erwartet Prozent. Zusätzlich ist der Faktor > 1, macht die „flach-äquivalente" Pace also langsamer statt schneller.
*Sichtbar:* 10 km, 200 hm, 5:30/km → korrekt ≈ 5:15/km, angezeigt 5:30/km. Bei mehr Höhenmetern wird die GAP langsamer als die reale Pace.
*Fix:* `const gradePct = (elevationGain / distanceMeters) * 100; const gap = avgPaceSecPerKm / (1 + gradePct * 0.033);`, `gradePct` auf 0–15 klemmen.

**Schlaf-Effizienz mittelt über zwei verschiedene Nächtemengen** — `apps/nextjs/src/app/sleep/page.tsx:174`
`totals` und `awakes` werden unabhängig von Nulls gefiltert, dann `(sum(totals) - sum(awakes)) / sum(totals)`. Nächte mit `totalSleepMinutes` aber ohne `awakeMinutes` (bei vielen Garmin-Geräten der Normalfall) landen nur im Nenner.
*Sichtbar:* 28 Nächte, davon 4 mit Awake-Werten → 98 % statt der realen ~89 %. Die Zahl wird besser, je schlechter die Sensorabdeckung.
*Fix:* Paarweise filtern (beide Felder non-null), Definition auf `asleep / (asleep + awake)` umstellen, sonst „—".

**Konfidenz und Running-Shape ändern sich mit dem Chart-Zeitraum** — `apps/nextjs/src/app/fitness/page.tsx:286`
`workoutCount90d = recentActivities.data.length`, aber `recentActivities` fragt `{ days: chartDays }` aus dem `DateRangeSelector` ab. Das Label (`:793`) und der Name behaupten 90 Tage; der Wert speist auch `confidenceInterval()` (`:290`) und den Volumen-Bonus der Running Shape (`:373`).
*Sichtbar:* „±3 % confidence (40 workouts/90d)", Shape 80 „Peak Shape". Ein Tap auf „7d" → „±8 % confidence (3 workouts/90d)", Shape −20 Punkte auf „Building" — ohne jede Trainingsänderung.
*Fix:* Zweiter, fest auf 90 Tage parametrisierter Query für Konfidenz/Shape; `recentActivities` nur noch für den Chart.

**Journal überträgt Vortageswerte auf einen leeren Tag und speichert sie dort** — `apps/nextjs/src/app/journal/page.tsx:247`
Der Reset-Block läuft nur bei `syncedDate !== null || tags nicht leer || notes !== ""`. `loadEntry()` und `shiftDate()` setzen `syncedDate` vorher auf `null`, also ist die Bedingung falsch, sobald der vorige Eintrag weder Tags noch Notizen hatte. Soreness, Mood, Koffein, Alkohol, Nap, Medikamente, Zyklusphase bleiben stehen.
*Sichtbar:* Gestern Soreness 8, Mood 3, 200 mg Koffein. Pfeil nach links auf einen unberührten Tag → Formular zeigt weiterhin 8/3/200. `handleSave()` (`:341`) schreibt diese Werte unter dem neuen Datum; die Korrelationsanalyse verarbeitet sie anschließend.
*Fix:* Guard entfernen, immer alle Felder zurücksetzen plus `setSyncedDate(selectedDate)`, in einem `clearForm()`-Helper, damit kein Feld vergessen wird.

**`garmin.triggerBackfill` schreibt erfundene Daten in die Produktions-Tabellen** — `packages/api/src/router/garmin.ts:51,58` *(zwei Befunde zusammengelegt)*
Live-`protectedProcedure` in `appRouter` (`root.ts:35`), erreichbar unter `/api/trpc/garmin.triggerBackfill`. Ruft `backfillDays("mock_garmin_access_token", days)`; `packages/garmin/src/backfill.ts:35-53` ist ein `seededRandom(42)`-Generator für Sleep Score, HRV, Ruhepuls, Stress, Body Battery, VO2max und ganze Aktivitäten (`garminActivityId: "mock-activity-<date>"`). Einfügung direkt in `DailyMetric` und `Activity` unter der echten User-ID. Mit `DEV_BYPASS_AUTH=true` (`trpc.ts:128`, vom Add-on gesetzt) braucht `protectedProcedure` keinerlei Credential.
*Sichtbar:* Ein POST mit `{days: 90}` füllt jede Lücke der letzten 90 Tage mit Zufallsphysiologie und bis zu ~60 Fake-Sessions. Diese Zeilen speisen HRV/RHR-Baselines, CTL/ATL/ACWR, VO2max und den Coach — dauerhaft, ohne Marker, ohne Unterscheidungsmöglichkeit zu echten Daten.
*Fix:* `triggerBackfill`, `initiateOAuth`, `handleCallback`, `getConnectionStatus` löschen — allesamt Mock-Stubs ohne UI-Aufrufer, der echte Sync läuft über `rootfs/app/scripts/garmin-sync.py`. Falls der Stub bleiben muss: `TRPCError({code:"NOT_IMPLEMENTED"})` bzw. Gate auf `NODE_ENV !== "production"`.

### Mittel

**AI-Backends**
- `packages/api/src/lib/ha-conversation.ts:127` — `/sorry,?\s*i['']?\s*m? not (sure|able)/i` ohne Anker trifft die vom System-Prompt ausdrücklich geforderte ehrliche Unsicherheit (`agent-prompts.ts:16,48`). Eine korrekte Rückfrage („Sorry, I'm not sure which race you're targeting …") wird verworfen und der Agent-Cache invalidiert (`:255-256`). → Anker + Geräte-/Intent-Kontext verlangen, Cache nicht auf Textheuristik hin leeren.
- `ha-conversation.ts:150` — `/rate[_ ]?limit(ed|s)?/i` ohne Wortgrenzen trifft „rate limiting", „heart rate limits". Eine korrekte sportwissenschaftliche Antwort wird als Provider-Fehler behandelt und geworfen (`:271`); derselbe Fehler tritt bei derselben Frage reproduzierbar wieder auf. Gleiches bei `/5(0[023]|29)/…overloaded/` und „your 500m repeats left you overloaded". → An Fehlerkontext ankern.
- `data-context.ts:774` — dieselbe `rampRate` wird als „pts/week" (`:516`), als „+X.X%" (`:774`) und als „%/week (safe <5-8 pts)" (`:1050`) ausgegeben. Die Engine liefert absolute CTL-Punkte (`engine/src/strain/index.ts:194`). → Eine Einheit, Doppelausgabe entfernen.
- `packages/api/src/lib/quality-gate.ts:111` — `/[+-]?\d[\d,]*(?:\.\d+)?/g` liest Bindestriche in Datums- und Bereichsangaben als Vorzeichen: „2026-08-13" liefert 2026, −8, −13. Eine halluzinierte „TSB −13" gilt damit als gedeckt und wird mit hoher Konfidenz durchgereicht — negative Werte sind genau die, die das Gate prüfen soll. → Lookbehind `(?<![\w.])`, ISO-Daten vorher entfernen.
- `chat.ts:223` — das Gate prüft gegen den bei 4000 Zeichen gekappten Kontext, flaggt also korrekte Zahlen als Halluzination und hängt „⚠️ Low confidence" an akkurate Antworten. → `buildDataContext` soll `{ prompt, full }` liefern, das Gate bekommt `full`.
- `data-context.ts:98` — `classifyVO2max` nimmt `age` entgegen und verwendet es nie; feste Cut-Points (52/43/36 bzw. 45/38/31) entsprechen etwa der Altersgruppe 30-39. Ein 62-Jähriger mit 44 ml/kg/min (≈90. Perzentil) wird als „Good" eingestuft und bekommt zusätzliche VO2max-Intervalle verordnet. → ACSM-Altersbänder nutzen oder das Label ganz weglassen.
- `chat.ts:163` — `fullPrompt` (HA-Pfad, also der Default) enthält keine Chat-Historie, `chatMessages` (`:167`, OpenRouter/Ollama) schon; auch keine `conversation_id` an `/api/conversation/process`. Folgefragen („was ist mit Donnerstag?") verlieren den Bezug — je nach unsichtbarer Einstellung verhält sich dasselbe Produkt unterschiedlich.
- `data-context.ts:218` — `metrics30` selektiert alle Spalten inkl. `laps`/`rawGarminData` (die Nachbar-Queries schließen die explizit aus, `:196`, `:273`) und limitiert auf 30 **Zeilen**, während die Sektion „Zone Distribution (Last 30 Days)" (`:619`) heißt. Bei zwei Einheiten täglich sind das 15 Tage; zusätzlich werden pro Chat-Request 30 Roh-Blobs deserialisiert — auf dem RPi4 genau der Speicherpeak, gegen den der `_aiInFlight`-Mutex existiert.
- `data-context.ts:852` — `findValueNDaysAgo` bricht beim ersten Treffer `date <= target` ab, auch wenn dessen Wert `null` ist. Ein Tag ohne Aktivität (`acwr = null`) unterdrückt die gesamte ACWR-Trendzeile, obwohl eine Zeile tiefer ein gültiger Wert steht. → Weitersuchen statt `return`.
- `chat.ts:119` *(mit `chat.ts:132` zusammengelegt)* — `_aiAbortController.abort()` (`:116`) ist wirkungslos, weil das `signal` nie an `openRouterChat`/`haConversationChat`/`ollamaChat` durchgereicht wird (jede erzeugt ihren eigenen Controller). Der Busy-Zweig gibt eine synthetische Nachricht `id: "busy"` zurück **bevor** die Nutzernachricht eingefügt wird (`:136`); da die Mutation erfolgreich ist, feuert `onSuccess`, `chat.getHistory` wird refetcht, und die Frage verschwindet aus Eingabefeld und Verlauf — ohne Fehler, ohne DB-Zeile. Das Log meldet derweil „Cancelling previous AI request", während die erste Inferenz weiterläuft und ihren Speicher hält. → Nutzernachricht vor dem Busy-Check speichern oder `TRPCError({code:"TOO_MANY_REQUESTS"})` werfen; Controller entweder durchreichen oder löschen.
- `chat.ts:210` — doppelte Unavailable-Meldung (`:210` + `generateFallbackResponse:49`), danach der komplette Kontext verbatim inkl. ```json-Block und Medikamentenliste; der Markdown-Renderer der Coach-Seite kennt keine Code-Fences. → Prefix entfernen, im Fallback nur Readiness/Load/Aktivitäten whitelisten.

**API-Router**
- `packages/api/src/router/analytics.ts:513` — `getCorrelations` bucketet Strain per `toISOString()` (UTC) und joint gegen `DailyMetric.date` in Athleten-Zeitzone. Dieselbe Datei nutzt `dayInTimezone` in `aggregateDailyLoads` (`:76`) korrekt. Für UTC+11 ist jede Morgeneinheit einen Tag verschoben → „Strain vs. HRV am Folgetag" wird aus falsch gepaarten Werten berechnet, Vorzeichen inklusive. Gleiche Einzeiler-Korrektur in `trends.ts:48` und `advanced-metrics.ts:67`.
- `packages/api/src/router/trends.ts:48` — `fetchStrainByDate` ist die einzige Strain-Quelle für `getChart`, `getLongTermTrend`, `getRollingAverages`, `getNotableChanges`, `getMultiMetricChart` und keyt ebenfalls per UTC. Im Multi-Metric-Chart liegt die harte Einheit einen Tag links neben dem HRV-Einbruch, den sie erklären soll.
- `packages/api/src/router/coach.ts:785` — `getDailyRecommendation` ist eine `.query()`, schreibt aber bei jedem Aufruf per `recordRecommendationAudit` eine Audit-Zeile mit vollständigem `recommendation` + `engineInput`. Jeder Refetch, Tab-Fokus und Retry hängt eine an. `lib/learning.ts:90-96` scannt 180 Tage davon; `ruleEffectiveness` gewichtet Regeln damit nach Seitenaufrufen statt nach Entscheidungen. → Unique-Index auf (userId, date, kind) + Upsert.
- `packages/api/src/router/analytics.ts:547` — `getRunningForm` lädt ohne `limit`, ohne Datumsgrenze und ohne `columns`-Projektion die gesamte Aktivitätshistorie inkl. `rawGarminData`/`laps` und sucht den letzten Lauf per `Array.find`. Nach zwei Jahren (~1500 Aktivitäten) sekundenlange Anfrage und OOM-Risiko auf dem Pi, um sechs Zahlen einer Zeile zu lesen. → Filter in SQL, `limit: 1`, Projektion.

**Engine**
- `packages/engine/src/strain/index.ts:47` — TRIMP ohne Banisters Geschlechtsfaktor: implementiert ist `D × ΔHR × e^(k·ΔHR)`, korrekt wäre `× 0.64` (m) bzw. `× 0.86` (w). Folge: alle Werte überhöht (×1.56 m, ×1.16 w) **und** das Geschlechterverhältnis invertiert. 60 min bei 75 % HRR: Code 189.9 (m) / 157.5 (w), Banister 121.6 / 135.4. `personalTrimpMax = 250` wurde offensichtlich gegen die unskalierte Version kalibriert; die 14er-Schwelle in `countConsecutiveHardDays` wird von Einheiten überschritten, die nicht hart sind. Tests, die das Verhalten festschreiben und mitkorrigiert werden müssen: `__tests__/accuracy-reference.test.ts:33-102` („male coefficient produces higher TRIMP than female" — verkehrt herum) und `validation.test.ts:90-113`.
- `packages/engine/src/baselines/index.ts:105` — `computeEMA` erwartet chronologische Reihenfolge (das letzte Element dominiert), `readiness.ts:374-375` liefert aber eine `desc(date)`-Query. Die „30-Tage-EMA" gewichtet damit den Wert von vor 30 Tagen am stärksten. HRV steigend 40→69 ms: korrekt 56.6, tatsächlich 52.4 — z um ~0.4 SD überhöht, bei der aktuellen Steilheit ~15 Punkte auf die HRV-Komponente, dauerhaft und in die falsche Richtung für jeden mit Trend. `baselines.test.ts` kann das nicht fangen (nur konstante Fixtures). → Array in `computeBaselines` umdrehen, Ordering-Kontrakt dokumentieren.
- `packages/engine/src/readiness/index.ts:111` — Der Stage-Fallback in `scoreSleepQuality` behandelt fehlende Daten gleichzeitig als schlechteste Architektur (`deep ?? 0`, `rem ?? 0`) und beste Effizienz (`awake ?? 0` → `total/total = 1.0`). Der Zweig greift nur bei `sleepScore === null` — also genau bei den Geräten, die auch keine Stages liefern. Ergebnis konstant `0×0.55 + 100×0.45 = 45`, egal ob 4 oder 10 Stunden, und unterhalb des neutralen 50. `readiness.test.ts:304-321` prüft nur 0..100. → Neutral 50 zurückgeben, wenn weder Score noch Stages vorliegen.
- `packages/engine/src/coaching/index.ts:75` — `daysKey = availableDays >= 5 ? "5d" : "3d"` macht `"strength-body_composition-4d"` (`:58`) unerreichbar; auch `strength-maintain-3d` fehlt, also greift der Lauf-Fallback. Wer im Onboarding (`onboarding/page.tsx:76`) „strength" + „Body Composition" wählt, bekommt dauerhaft „Deload Session — 3x5 at 60% normal load / Default easy session." an Mo/Mi/Sa und sonst Ruhetage. `coaching.test.ts` deckt nur Running ab.
- `packages/engine/src/forecasting/index.ts:378` — `simulateWhatIf` baut `futureLoads = [opt.todayLoad, ...tail]`, `projectPMC` interpretiert Index 0 aber als *morgen*, und der Aufrufer (`analytics.ts:263`) übergibt eine Historie, deren letztes Element bereits heute inkl. der schon absolvierten Einheit ist. „Rest today" legt also einen Ruhetag *auf morgen* über die reale heutige Last und beschriftet das Ergebnis als `tomorrow`. `forecasting.test.ts:167-200` vergleicht nur Optionen untereinander und sieht die Verschiebung nicht.

**Next.js-Seiten**
- `trends/page.tsx:435` — Karte „Avg Stress" zeigt `s.avgStress`, bekommt aber `trend={trendStrain.data}` und die Strain-Farbe; `trendStress` (`:256`) wird nur in der Liste darunter genutzt. Pfeilrichtung beschreibt die falsche Metrik.
- `trends/page.tsx:104` — `summaryPeriod()` mappt alles außer „7d" auf „28d", während die Überschrift (`:375`) „1 Y overview" anzeigt und die Charts darunter den vollen Zeitraum abdecken. Der Nutzer vergleicht einen 28-Tage-Mittelwert mit einem Jahreschart.
- `zones/page.tsx:1144` — `CalendarHeatmap` parst `firstDate + "T00:00:00"` lokal und keyt mit `toISOString()` (UTC). Östlich von UTC ist jede Zelle einen Tag verschoben: Samstagstraining erscheint auf Freitag, Tooltip zeigt „Aug 14". Gleiches in `:446` („Most consistent week" nennt einen Samstag als Wochenstart, `formatWeek` bei `:468`).
- `zones/page.tsx:250` — `sportType: sportType ?? "running"`; `undefined` ist genau der „All sports"-Sentinel, also zeigt der Effizienz-Chart bei „Alle Sportarten" still nur Laufen. Alle anderen Queries der Seite reichen `undefined` korrekt durch. Titel und die abgeleitete „Efficiency improved by X%"-Insight (`:428`) erwähnen Laufen nicht.
- `zones/page.tsx:219` — `sport` bleibt beim Wechsel des Zeitraums stehen, `sportOptions` wird aus `listSportTypes({ days })` neu gebaut. Fällt die Auswahl aus der Liste, zeigt das `<select>` „All sports", der State hält aber weiter „tennis" → alle Charts leer, der Nutzer hält seine 90-Tage-Daten für verloren. → `useEffect`-Reset auf ungültige Auswahl.
- `sleep/page.tsx:871` — `windowStart = 1200`, `windowEnd = 1920` ergeben 12 Stunden (bis 08:00), die Achsenbeschriftung (`:916-920`) nennt fünf gleichverteilte Marken für 16 Stunden (8 PM … 12 PM). Ein Schlaf 23:00–07:00 liest sich an dieser Skala als „Mitternacht bis ca. 10 Uhr". → Entweder `windowEnd = 2160` oder Labels auf 8 PM / 11 PM / 2 AM / 5 AM / 8 AM.
- `sleep/page.tsx:455,590` — Titel „Last 14 Nights" / „Last 28 Days" sind Literale, die Charts hängen am `DateRangeSelector`-State (`:334`). Bei „90d" zeigen sie 90 Tage unter falscher Beschriftung.
- `training/page.tsx:781` — ACWR-Gauge: Marker linear bei `clamped/2*100`, farbige Segmente korrekt 40/25/10/25 %, aber die Tick-Labels per `flex justify-between` bei 0/25/50/75/100 %. ACWR 1.0 setzt den Marker exakt über das Label „1.3", während die Zahl darunter „1.00 Optimal" sagt. → Labels absolut bei 0/40/65/75/100 % positionieren.
- `training/page.tsx:637` — Der 14-Tage-Strain-Chart prüft nur `length > 0` und mappt `value ?? 0`; der 42-Tage-Chart (`:386`) prüft korrekt auf `> 0`. Ohne HR-Einheiten stehen 14 Nullbalken auf einer 0–21-Achse statt eines Leerzustands.
- `journal/page.tsx:178` — `useState(toDateStr(new Date(), timezone))` läuft, bevor `useUserTimezone()` das Profil aufgelöst hat (also mit Browser-Zone/UTC), wird danach nie resynchronisiert, während der „Today"-Vergleich (`:397`) und der Vorwärts-Guard (`:405`) die aufgelöste Zone nutzen. `dateRange()` (`:128`) und `shiftDate()` (`:367`) rufen `toDateStr` ganz ohne Zone auf. Auf einem HA-Kiosk mit UTC-Browser landen Einträge unter dem Vortag.
- `settings/page.tsx:104,257` — `useEffect(… , [profile])` überschreibt lokalen Formularstate bei jeder Query-Identitätsänderung, und die Sync-/Recompute-Poller rufen das ungefilterte `queryClient.invalidateQueries()` (`:672`, `:722`); dazu `refetchOnWindowFocus: true` bei 5 s staleTime. Nach „Sync Now" verschwindet eine gerade getippte Medikamentenliste nach 3–30 s ersatzlos; Tabwechsel genügt ebenfalls. → State nur einmal seeden (`profile?.id` + `editing`-Guard).
- `export/page.tsx:25` — `String(val)` für JSONB-Spalten: `tags`, `hrZoneMinutes`, `laps`, `rawGarminData`, `runningFormScore` werden zu `[object Object]`. Der Journal-Export verliert damit genau das, wofür man ihn macht. → Nicht-Primitives per `JSON.stringify`.
- `fitness/page.tsx:278` — `classifyVO2max(value)` ohne `ageGroup` → immer Bucket „30-39" der **männlichen** Normtabelle, `percentileEstimate()` ist konstruktionsbedingt männlich. Der Text darunter (`:740`) sagt „for your age group". Eine 58-jährige Athletin mit 34 wird als „Fair / bottom 40%" eingestuft, obwohl sie in ihrer Kohorte deutlich überdurchschnittlich ist. `Profile` hat `age` und `sex` (`schema.ts:15-16`), die Seite fragt sie nie ab.
- `activities/page.tsx:121` und `activities/[id]/page.tsx:548` — beide geben ein nacktes `<div>` ohne den sonst überall genutzten `<main className="mx-auto max-w-lg px-4 pt-6 pb-24">` zurück, und es gibt kein `activities/layout.tsx`. Der fixe HamburgerMenu-Button (`top-3 left-3 z-50`) liegt damit exakt auf dem „← Back to Activities"-Link: der Tap öffnet die Navigation statt zurückzugehen. Karten laufen am Handy gegen den Rand.
- `onboarding/page.tsx:120` — `router.push("/")` ist der einzige `router.push` der App; laut `ingress-link.tsx:18-20` kann Next-Client-Routing die Ingress-Prefixe nicht auflösen. Nach „Finish" landet man in der HA-Wurzel, nicht im Add-on. → `window.location.href = getIngressUrl("/")`.
- `power/page.tsx:79` — `pdCurveData` wählt Aktivitäten, deren **Gesamtdauer** ±20 % um den Bucket liegt, und nimmt deren Durchschnittsleistung. Eine Power-Duration-Kurve ist das beste rollende N-Minuten-Mittel *innerhalb* einer Aktivität; der Infotext behauptet genau das. Ein 5-Minuten-Peak von 380 W in einer 60-min-Ausfahrt taucht nie auf, der 60-min-Punkt zeigt 240 W. Kurzzeit-Peaks sind strukturell unmöglich darstellbar. → Serverseitig aus Power-Streams berechnen, bis dahin umbenennen in „Average power by activity duration".

**Konfiguration / Sicherheit**
- `apps/nextjs/src/app/api/internal/rebuild-memory/route.ts:52` — Die Arbeitsliste kommt aus `db.query.user.findMany()`, der better-auth-Tabelle. Im Add-on wird da nie eine Zeile angelegt (Auth ist per `DEV_BYPASS_AUTH` umgangen, der einzige Insert steht in `seed-e2e.ts:86`), alle Daten hängen an `"seed-user-001"` (`trpc.ts:133`). Der nächtliche Cron liefert also jede Nacht `{"success":true,"users":0}`; `summarizeAndEmbedHistory` und `recomputeOutcomeAttribution` laufen nie. Der Coach bekommt nie Langzeitgedächtnis, im Log sieht alles grün aus. → Nutzer-IDs aus `daily_metric`/`profile` ziehen, bei `users: 0` eine Warnung zurückgeben.
- `apps/nextjs/src/auth/server.ts:54` — `productionUrl` fällt auf `https://turbo.t3.gg` zurück, wenn `VERCEL_PROJECT_PRODUCTION_URL` fehlt — also in **jedem** Self-Hosting- und Add-on-Deployment. Der Wert geht an `oAuthProxy({ productionURL })` und in die Discord-`redirectURI` (`packages/auth/src/index.ts:127,136`). Wer ohne `DEV_BYPASS_AUTH` echte Authentifizierung nutzt, leitet den OAuth-Code über eine fremde Domain. → `APP_URL` in `env.ts` erzwingen, nie auf eine Fremddomain zurückfallen; ohne konfigurierten Provider `oAuthProxy` und den Discord-Block ganz entfernen.
- `packages/auth/env.ts:16` — `apps/nextjs/src/env.ts:43` erweitert `skipValidation` um den Bypass, aber `authEnv()` hat sein eigenes `createEnv`, das `AUTH_DISCORD_ID`/`_SECRET` unbedingt validiert; ein per `extends` übergebenes Preset ist bereits konstruiert, das äußere `skipValidation` greift nicht. Der dokumentierte Single-User-Modus verlangt damit Discord-Credentials; `next build` und `node server.js` brechen ab, bevor ein Request bedient wird. Das ausgelieferte Add-on überlebt nur, weil das Run-Skript `AUTH_DISCORD_ID="unused"` exportiert. → Vars bei Bypass optional machen oder `skipValidation` angleichen.
- `apps/nextjs/src/app/api/garmin/webhook/route.ts:79` — Nach der HMAC-Prüfung wird `payload.userId` verbatim als `userId` geschrieben; `packages/garmin/src/webhook.ts:27` liest `(raw.userId as string) ?? "unknown"` — eine Garmin-Health-API-ID ohne Mapping-Tabelle. `DailyMetric.userId`/`Activity.userId` sind FK-lose `text()`-Spalten (`schema.ts:74,131`), Postgres nimmt alles. Jede Lesepfad-Query scopt auf die Session-ID (`"seed-user-001"`). Ergebnis: `{received: true}`, Zeile committed, nie sichtbar, nie geloggt. → Garmin-ID auf App-ID auflösen, sonst 404 mit Warnung; leeres `raw.userId` ablehnen statt `"unknown"`.

### Niedrig

- `packages/api/src/router/readiness.ts:407` — Insert ohne `onConflictDoUpdate` in eine Tabelle mit `readiness_score_user_date_unique` (`schema.ts:217`); der Check-then-insert (`:294-300`) ist ein TOCTOU-Fenster. RSC-Prefetch + Client-Hydration beim ersten Laden des Tages → Unique-Violation als 500, die Readiness-Karte zeigt ihren Fehlerzustand genau dann, wenn man sie braucht.
- `packages/api/src/router/zones.ts:482` — `getPeakPerformances` nimmt als einzige Prozedur des Routers kein `days`, lädt alle Aktivitäten der Sportart inkl. `rawGarminData`/`laps`/`hrZoneMinutes` und reduziert in JS auf Monatsbestwerte. Ladezeit und Speicher wachsen linear mit der Trainingshistorie.
- `packages/api/src/router/vitals.ts:61` — `baselineWindow = allData.slice(-30)` nach dem Null-Filter: bei selten erfassten Metriken (Hauttemperatur, SpO2) sind das die letzten 30 *Messungen*, ggf. über 10 Wochen. `skinTempStatus` vergleicht mit ±0.3 °C gegen diesen Langzeitmittelwert und meldet saisonale Drift als „elevated" — das Krankheitssignal. → Fenster nach Datum wählen.
- `packages/api/src/router/readiness.ts:462` — `z.object({ date: z.string() })` geht direkt in `eq(ReadinessScore.date, …)`; ebenso `journal.ts:13-15,29,43` und `intervention.ts:27-28,46`. `"2026-02-30"` erzeugt einen Postgres-Fehler als INTERNAL_SERVER_ERROR statt eines 400 mit `zodError`. `coach.ts:62-67` hat bereits ein korrektes `IsoDateSchema`, nur nicht exportiert.
- `packages/engine/src/vo2max/index.ts:271` — Docstring verlangt „4 Punkte über 14+ Tage", geprüft wird nur `length < 4`. Vier Tageswerte 47.0/47.2/47.4/47.6 (innerhalb des Firstbeat-Rauschens) ergeben +1.4 ml/kg/min pro Woche „improving"; vier Tage später „declining". → Mindestspanne 14 Tage, sonst `null`.
- `packages/engine/src/training-status/index.ts:131` — `categorizeLoad` hat keinen Zweig für ACWR 0.6–0.8, das Band fällt in `optimal`. Überall sonst gilt 0.8 als Untergrenze (`readiness/index.ts:237`, `daily-recommendation/rules.ts:211`). Nach zwei Wochen Pause bei 0.7: „maintaining", während die Empfehlungskarte gleichzeitig zu niedriger Last rät.
- `packages/engine/src/readiness/index.ts:419` — `zone` kommt aus dem gerundeten Score, `generateExplanation` berechnet die gewichtete Summe erneut und zont den **ungerundeten** Wert. Bei 79.6 zeigt die Karte 80/„prime", der Text darunter die „high"-Empfehlung. → Zone durchreichen statt zweimal zu berechnen.
- `packages/engine/src/daily-recommendation/index.ts:274` — `buildReason` gibt „Plan day — no signals against your scheduled workout." auch dann zurück, wenn `weeklyPlan` null ist und gar kein Workout geplant war. `daily-recommendation.test.ts:377-387` trifft genau diesen Pfad, prüft den String aber nicht.
- `_components/adherence-trend-card.tsx:129` — `adherenceRate()` liefert 0 bei leerem Nenner; der Leerzustand (`:273`) greift nur bei `points.length === 0`. Ein Fenster aus lauter `no-plan`-Punkten zeigt ein 4xl „0% adherence rate", liest sich als „alles verpasst".
- `team/page.tsx:96` — `(profile.data as { name?: string }).name` — `Profile` (`schema.ts:12-55`) hat keine `name`-Spalte, der Cast unterdrückt nur den Typfehler. Die Karte heißt für jeden „Athlete" mit Avatar „A".
- `apps/nextjs/src/app/api/garmin/meeting-stress/route.ts:11` — einzige Route unter `api/garmin/`, die `requireSession()` nicht aufruft (alle Geschwister tun es: `auth/route.ts:56,66,90,103`, `sync:14,40`, `recompute:14,55`, `gcal-*`, `interactions/*`). Ohne `DEV_BYPASS_AUTH` kann ein unauthentifizierter POST ein bis zu 900 s laufendes Rescoring über Kalender- und Herzfrequenzhistorie starten; der GET verrät, ob ein Job läuft.
- `apps/nextjs/src/app/api/trpc/[trpc]/route.ts:16` — `ALLOWED_ORIGINS` enthält `http://localhost:3000` und `127.0.0.1:3000` unabhängig von `NODE_ENV`, gespiegelt mit `Access-Control-Allow-Credentials: true` (`:32-34`). Jede andere lokal auf Port 3000 laufende Web-App kann damit credentialed die volle Trainings-, Schlaf-, HRV- und Journal-Historie auslesen. Der Kommentar in der Datei benennt das Risiko selbst. → Localhost-Einträge nur bei `NODE_ENV !== "production"` (Muster: `auth/guard.ts:24`).
- `packages/auth/package.json:7` — `"./middleware"` und `"./client"` zeigen auf nicht existierende Dateien; `src/` enthält nur `index.ts`. → Einträge löschen.

---

## 4. Sofort beheben

1. **Die vier `DailyMetric`- und zwei `Activity`-Spalten in `schema.ts` deklarieren.** Jeder Neustart löscht derzeit Gewichts-/Körperfetthistorie (nicht wiederherstellbar) oder dupliziert Strava-Aktivitäten und bläht damit die gesamte Trainingslast auf.
2. **`push --force` aus dem Boot-Skript nehmen** (versionierte Migrationen). Solange das gegen die Live-DB läuft, ist jede künftige Schemaänderung eine potenzielle Datenlöschung.
3. **`chat.ts:183` auf `AI_BACKEND` verzweigen.** Medikamente, Allergien und Diagnosen gehen aktuell auch dann an einen Cloud-Agenten, wenn der Nutzer explizit „lokal" gewählt hat.
4. **`garmin.triggerBackfill` löschen.** Ein unauthentifizierter HTTP-Aufruf schreibt irreversibel Zufallsdaten in die Gesundheitshistorie; die Prozedur hat keinen einzigen UI-Aufrufer.
5. **`theme.tsx:82` in try/catch + `prefers-color-scheme`-Fallback in theme.css.** Eine Datei, behebt die intermittente „mal geht's, mal nicht"-Variante des Theme-Bugs.
6. **Seitenwrapper `bg-black`/`bg-zinc-950`/`bg-zinc-900`/`bg-white` auf Tokens umstellen** (insights, stress-board, coach, zones, debug). Fünf Dateien, behebt die vier komplett unlesbaren Seiten.
7. **`aggregateDailyLoads` extrahieren und in `readiness.ts`, `workout.ts`, `data-context.ts` nutzen; `computeACWR` bei <14 Tagen `null` liefern lassen.** Die Readiness-Zahl, auf der die ganze App aufbaut, ist sonst in der Load-Komponente eine Konstante.
8. **`zScoreToScore`-Default auf 0.5 und EMA-Reihenfolge in `computeBaselines` umdrehen.** Zwei Zeilen, die drei von sechs Readiness-Komponenten von „binär und in die falsche Richtung verzerrt" auf die dokumentierte Kalibrierung bringen.
9. **`getDateString` an sieben Stellen durch `todayInTimezone(profile?.timezone)` ersetzen.** Betrifft jeden Nutzer außerhalb von UTC täglich mehrere Stunden lang.
10. **`workout.getToday`: Unique-Index + `onConflictDoUpdate` statt DELETE+INSERT.** Löscht sonst abgeschlossene Einheiten und reißt Streaks.

---

## 5. Wiederkehrende Muster

**Schema und Realität sind entkoppelt.** `schema.ts` beschreibt nicht die Tabellen, die tatsächlich existieren: Spalten werden von Python-Skripten und Shell-`ALTER TABLE`s nachgetragen, Constraints fehlen (`DailyWorkout`), Kodierungen sind undokumentiert (`sleep_start_time` als `varchar(10)` mit zwei Formaten), Fremdschlüssel fehlen (`userId` als freies `text`). Der `push --force`-Boot macht aus jeder dieser Divergenzen einen Datenverlust.

**Pro-Aktivität-Arrays gegen Pro-Tag-Engines.** Dieselbe Verwechslung an fünf Stellen (`readiness.ts`, `data-context.ts`, `workout.ts`, `computeACWR`, `computeTargetStrain`). `analytics.ts` hat die Lösung (`aggregateDailyLoads`) und dokumentiert den Defekt sogar — sie wurde nie zurückportiert. Ruhetage fehlen dadurch systematisch aus allen EWMA- und Fenster-Berechnungen.

**„Neueste Zeile" wird als „heute" ausgegeben.** In `data-context.ts`, `proactive.ts` und `readiness.ts` identisch: `array[0]` ohne Datumsprüfung, dann mit dem heutigen Datum beschriftet und persistiert. Die überall eingebaute „ich habe keine Daten"-Sicherung prüft nur auf `null` und feuert deshalb nie.

**UTC vs. Profil-Zeitzone.** Sieben kopierte `getDateString`-Helfer plus vier inline `toISOString().split("T")[0]`-Bucketings, obwohl `lib/timezone.ts` die korrekten Funktionen exportiert und zwei Router sie bereits nutzen. Im Frontend dieselbe Sache über `new Date(str + "T00:00:00")` → `toISOString()`.

**Labels behaupten Zeitfenster, die der Code nicht einhält.** „Last 30 Days" = 30 Zeilen, „workouts/90d" = der gewählte Chartbereich, „Last 14 Nights" = der State-Wert, „1 Y overview" über 28-Tage-Mitteln, „30-day baseline" = 30 Messungen, „16-hour window" auf einer 12-Stunden-Skala. Jedes Mal sieht der Nutzer eine plausible Zahl unter einer falschen Überschrift.

**Erfundene Werte statt Leerzustand.** Konstante Tortendiagramm-Prozente, `readiness ?? 50`, `deep ?? 0`, ACWR exakt 1.00 bei zu wenig Daten, „0% adherence" ohne Plan, 14 Nullbalken statt „keine Daten". Überall wird ein Platzhalter als Messwert dargestellt — und speist anschließend nachgelagerte Berechnungen.

**Hartkodierte Farbliterale neben einem vorhandenen Token-System.** `theme.css` definiert vollständige Light-/Dark-Paletten; ~300 Klassen und 18 Recharts-`contentStyle`-Kopien umgehen sie. Kein einziger Fall braucht die Literale.

**Regex-Heuristiken ohne Anker auf Fließtext.** Zwei Filter in `ha-conversation.ts` und der Zahlen-Scanner in `quality-gate.ts` matchen Substrings in normaler Sportprosa bzw. in ISO-Daten. Beide verwerfen korrekte Antworten oder segnen falsche ab — und tun das reproduzierbar für dasselbe Thema.

**Queries ohne `limit`, Datumsgrenze oder `columns`-Projektion.** `getRunningForm`, `getPeakPerformances`, `getRecoveryTime`, `metrics30` laden JSONB-Rohdaten (`rawGarminData`, `laps`), um wenige Zahlen zu lesen. Auf dem RPi4, für den die Codebasis explizit optimiert wurde, ist das der Speicherpeak, gegen den anderswo ein Mutex gebaut wurde.

**Tests, die den Fehler festschreiben.** `accuracy-reference.test.ts:84-102` behauptet die invertierte TRIMP-Geschlechterrelation als Sollverhalten, `validation.test.ts:173-198` die übersteilte Sigmoid, `readiness.test.ts:176-196` nennt ACWR 1.00 „low", `baselines.test.ts` nutzt nur konstante Fixtures. Vier Bugfixes erfordern daher Testkorrekturen — die Tests sind hier nicht die Absicherung, sondern Teil des Problems.