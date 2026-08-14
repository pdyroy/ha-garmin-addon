# Pacer — Layout-Briefing

Design-Briefing für den Layout-Umbau. Kein Code, sondern die Entscheidungen,
die den Code gut machen. Register: **Product** — Design dient der Aufgabe, der
Maßstab ist verdiente Vertrautheit, nicht Originalität.

## Kontext

Pacer läuft als Home-Assistant-Add-on in einem **Ingress-iframe**. Der Viewport
ist damit nicht das Browserfenster, sondern HAs Inhaltsbereich: am Desktop
typisch 1000–1900 px breit, am Handy die volle Gerätebreite. Ein Nutzer, deutsch,
Gesundheitsdaten, nutzt beides gleichwertig — morgens am Handy, Analyse am Rechner.

---

## Befund

Gemessen, nicht geschätzt:

| Was | Zustand |
|---|---|
| Container-Breite | 12 von 21 Seiten auf `max-w-lg` = **512 px** |
| Breiten-System | `md`, `lg`, `2xl`, `3xl`, `4xl` bunt gemischt, keine Regel |
| Breakpoints | `sm:` 35× · `md:` 3× · `lg:` 1× · `xl:` 0 · `2xl:` 0 |
| Navigation | Hamburger mit **19 flachen Einträgen** + Bottom-Bar mit 6 |
| Raster | `grid-cols-2` 27× · `-3` 12× · `-4` 11× — **ohne Breakpoint-Präfix** |
| Kartenradien | `rounded-2xl` 119× · `rounded-xl` 112× · `rounded-lg` 74× |
| Flächen-Token | 167× `bg-card`, daneben 77× hartkodiertes `bg-zinc-*` |
| Seitengröße | 500–1289 Zeilen pro `page.tsx`, 13.690 gesamt |

**Diagnose.** Das ist kein Mobile-First-Design. Mobile-First hieße: kleine
Basis, die nach oben aufmacht. Hier fehlt das Aufmachen komplett — `xl:` kommt
null Mal vor. Es ist ein **Nur-Mobil-Design, das auf großen Schirmen
stehenbleibt**: 512 px Inhalt in der Mitte, links und rechts nichts.

Gleichzeitig ist das Raster auf kleinen Schirmen zu eng: ein `grid-cols-4` ohne
Präfix bleibt auch auf 375 px vierspaltig. Beide Enden sind kaputt, aus
derselben Ursache — es gibt kein Layoutsystem, nur pro Seite gewachsene Werte.

---

## Entscheidungen

### 1. Ein Seitengerüst statt 21 Einzelentscheidungen

Eine `<PageShell>`-Komponente definiert Container, Kopfbereich, Abstände. Jede
Seite bekommt nur noch `density` und Inhalt. Damit verschwinden 21 verschiedene
`max-w-*`-Werte an einer Stelle.

Zwei Dichten, mehr braucht es nicht:

- **`reading`** (max. 65–75 ch): Insights, Coach, Journal, Onboarding, Settings.
  Fließtext braucht Zeilenlängenbegrenzung, egal wie breit der Schirm ist.
- **`data`** (max. ~1400 px): Trends, Training, Zones, Sleep, Fitness, Activities.
  Dichte Zahlen und Diagramme dürfen und sollen die Breite nutzen.

Über 1400 px wird **nicht** weiter gestreckt — Datentabellen jenseits davon
werden unlesbar, nicht besser.

### 2. Raster ohne Breakpoint-Gestrüpp

Statt `grid-cols-2 md:grid-cols-3 lg:grid-cols-4` überall:

```css
grid-template-columns: repeat(auto-fit, minmax(--min, 1fr));
```

Eine Regel, die von 375 bis 2560 px stimmt, ohne einen einzigen Breakpoint.
Drei Kachelgrößen reichen für die ganze App:

| Klasse | `minmax` | Wofür |
|---|---|---|
| `metric` | 160 px | Kennzahlen (HRV, RHR, SpO2) |
| `panel` | 320 px | Diagramme, Karten mit Inhalt |
| `wide` | 560 px | Tabellen, Aktivitätslisten |

Das ersetzt alle 56 unkonditionalen `grid-cols-*` mechanisch. Auf 375 px wird
alles einspaltig, auf 1600 px füllt es die Fläche — ohne Zutun.

### 3. Navigation: Sidebar ab Tablet, Bottom-Bar am Handy

19 Ziele in einer flachen Hamburger-Liste sind kein Menü, sondern ein
Inhaltsverzeichnis ohne Kapitel. Gruppieren:

- **Heute** — Today, Coach, Insights
- **Analyse** — Trends, Training Load, HRV, HR Zones, Fitness, Power, Correlations
- **Protokoll** — Activities, Sleep, Journal, Interventions, Stress Board
- **System** — Validation, Export, Team, Settings

Verhalten:

| Breite | Navigation |
|---|---|
| ≥ 1024 px | Feste Sidebar links, Gruppen sichtbar, aktiver Eintrag markiert |
| 640–1023 px | Icon-Rail, Beschriftung beim Aufklappen |
| < 640 px | Bottom-Bar mit 5 Zielen, Rest über ein Sheet |

Das löst zwei der vier genannten Probleme auf einmal: verschwendete Breite
(die Sidebar nutzt sie sinnvoll) und Orientierung (man sieht, wo man ist).

**Achtung Ingress:** alle Links müssen weiter über `IngressLink` laufen,
sonst brechen sie außerhalb des iframes aus.

### 4. Karten sind die faule Antwort

Aktuell ist alles eine Karte. Drei Radien, verschachtelte Karten, Karten um
einzelne Zahlen. Regeln:

- **Ein** Radius (`rounded-xl`), **ein** Rahmen, **ein** Flächen-Token (`bg-card`).
- Verschachtelte Karten sind immer falsch — innen reicht ein Trennstrich oder Abstand.
- Kennzahlengruppen brauchen keine Karte pro Zahl. Ein Raster aus Wert +
  Beschriftung, getrennt durch Weißraum, liest sich besser und ist dichter.
- Die 77 hartkodierten `bg-zinc-*` durch Token ersetzen — das ist zugleich der
  Rest des Theme-Bugs.

### 5. Hierarchie über Raum und Gewicht, nicht über Kästen

Der Readiness-Score ist die eine Zahl, die den Tag bestimmt — er darf groß sein.
Aber: **keine Hero-Kachel mit Verlauf**. Große Zahl, darunter Kontext, drumherum
Ruhe. Der Rest der Seite bleibt gleichmäßig. Ein Blick soll reichen, um
Wichtigstes, Zweitwichtigstes und Gruppen zu erkennen.

Typografie im Product-Register: **eine** Schriftfamilie, feste rem-Stufen
(kein `clamp()` für UI-Text), Stufenverhältnis 1.125–1.2. Fließende
Überschriftengrößen helfen einer App nicht, sie machen sie nur unruhig.

### 6. Abstände aus einer Skala

4er-Basis: 4, 8, 12, 16, 24, 32, 48, 64. Innerhalb einer Gruppe eng, zwischen
Gruppen großzügig — das erzeugt den Rhythmus, der aktuell fehlt, weil überall
derselbe Abstand steht.

---

## Reihenfolge

**Phase 1 — System.** `PageShell`, die drei Rasterklassen, Navigation,
Abstandsskala, Kartenregeln. Kein sichtbarer Umbau, nur die Grundlage.

**Phase 2 — Pilotseiten.** Today, Training, Trends, Sleep. Vier Seiten, die
die vier Fälle abdecken: Übersicht, dichte Kennzahlen, Diagramme, Listen. Hier
zeigt sich, ob das System trägt.

**Phase 3 — Rest.** Die übrigen 17 Seiten mechanisch nachziehen. Nach Phase 2
ist das Fleißarbeit, keine Designarbeit mehr.

Nicht Teil davon: die 500–1289-Zeilen-Seitenkomponenten aufteilen. Das ist eine
eigene Aufgabe und sollte den Layoutumbau nicht blockieren.

---

## Verifikation

Ohne Nachweis ist es nur Behauptung:

1. **Breiten** — 375, 768, 1280, 1920, 2560 px durchklicken. Kein horizontales
   Scrollen, keine 512-px-Spalte im Nichts, keine gequetschte Vierspaltigkeit.
2. **Beide Themes** auf jeder Pilotseite. Nach dem Umbau darf `bg-zinc-*` in
   den Pilotseiten nicht mehr vorkommen: `grep -r 'bg-zinc-' app/…` = leer.
3. **Kontrast** — Fließtext ≥ 4.5:1, große Schrift ≥ 3:1. Besonders die
   `text-*-400`-Werte auf hellen Flächen, die der Review als 232 Vorkommen
   in 26 Dateien gezählt hat.
4. **Im echten Ingress**, nicht nur lokal. Der iframe ist der Ernstfall:
   Links, Weiterleitungen, Viewport-Höhe (`h-dvh`) verhalten sich dort anders.
5. **Touch-Ziele ≥ 44 px** in der Bottom-Bar und bei allen Filter-Chips.

## Was das nicht wird

- Kein neues Farbschema. Die oklch-Token sind gut und bleiben.
- Keine Animationsschicht. Product-Register: 150–250 ms für Zustandswechsel,
  sonst nichts. Kein Seitenaufbau mit Choreografie.
- Keine erfundenen Bedienelemente. Sidebar, Tabs, Bottom-Bar sind Standard,
  und Standard ist hier eine Tugend.
