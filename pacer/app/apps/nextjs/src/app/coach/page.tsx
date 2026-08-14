"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { cn } from "@acme/ui";

import { IngressLink as Link } from "~/app/_components/ingress-link";
import { PageShell } from "~/components/page-shell";
import { formatTimeInTz, useUserTimezone } from "~/lib/format-date";
import { useTRPC } from "~/trpc/react";

// ---------------------------------------------------------------------------
// Agent configuration
// ---------------------------------------------------------------------------

type AgentType =
  | "sport-scientist"
  | "psychologist"
  | "nutritionist"
  | "recovery";

interface AgentConfig {
  id: AgentType;
  label: string;
  shortLabel: string; // abbreviated label for mobile tab strip
  icon: string;
  accent: string; // tailwind text color
  accentBg: string; // tailwind bg color for buttons
  accentBorder: string; // tailwind border color
  welcome: string;
  quickActions: readonly { label: string; message: string }[];
}

const AGENTS: AgentConfig[] = [
  {
    id: "sport-scientist",
    label: "Sportwissenschaftler",
    shortLabel: "Wissenschaft",
    icon: "🏋️",
    accent: "text-blue-400",
    accentBg: "bg-blue-600 hover:bg-blue-500",
    accentBorder: "border-blue-500",
    welcome:
      "Ich bin dein Sportwissenschaftler. Ich analysiere deine Training Load, Zonenverteilung, ACWR und VO2max-Trends, um deine Leistung zu optimieren. Frag mich einfach alles zu deinem Training.",
    quickActions: [
      {
        label: "Trainiere ich zu viel?",
        message: "Trainiere ich zu viel? Analysiere meinen ACWR und meine Training Load.",
      },
      {
        label: "Zonenverteilung",
        message:
          "Analysiere meine Herzfrequenz-Zonenverteilung der letzten 30 Tage.",
      },
      {
        label: "Vorbereitung auf 10 km",
        message:
          "Wie sollte ich mich basierend auf meiner aktuellen Fitness auf ein 10-km-Rennen vorbereiten?",
      },
      {
        label: "Trainingstipp",
        message:
          "Wie sollte mein Training heute basierend auf meiner Readiness aussehen?",
      },
    ],
  },
  {
    id: "psychologist",
    label: "Psychologe",
    shortLabel: "Psyche",
    icon: "🧠",
    accent: "text-purple-400",
    accentBg: "bg-purple-600 hover:bg-purple-500",
    accentBorder: "border-purple-500",
    welcome:
      "Ich bin dein Sportpsychologe. Ich helfe dir bei Motivation, mentaler Widerstandsfähigkeit und Leistungspsychologie. Lass uns an der mentalen Seite deines Trainings arbeiten.",
    quickActions: [
      {
        label: "Motivation verloren",
        message: "Ich verliere die Motivation zu trainieren. Kannst du mir helfen?",
      },
      {
        label: "Wettkampftag-Vorbereitung",
        message: "Hilf mir bei der mentalen Vorbereitung auf den Wettkampftag.",
      },
      {
        label: "Dranbleiben",
        message: "Wie kann ich mein Training konsequenter durchziehen?",
      },
      {
        label: "Mit Druck umgehen",
        message: "Wie gehe ich mit Leistungsdruck und Nervosität um?",
      },
    ],
  },
  {
    id: "nutritionist",
    label: "Ernährungsberater",
    shortLabel: "Ernährung",
    icon: "🥗",
    accent: "text-green-400",
    accentBg: "bg-green-600 hover:bg-green-500",
    accentBorder: "border-green-500",
    welcome:
      "Ich bin dein Sporternährungsberater. Ich helfe dir bei Ernährungsstrategien, Regenerationsernährung und Flüssigkeitszufuhr passend zu deiner Trainingsbelastung.",
    quickActions: [
      {
        label: "Vor dem Training essen",
        message: "Was sollte ich vor meinem Training essen?",
      },
      {
        label: "Regenerationsmahlzeiten",
        message:
          "Was sind die besten Mahlzeiten zur Regeneration nach einer harten Einheit?",
      },
      {
        label: "Kalorienbedarf",
        message:
          "Wie hoch ist mein Kalorien- und Makronährstoffbedarf basierend auf meiner aktuellen Training Load?",
      },
      {
        label: "Trinkplan",
        message: "Hilf mir mit einer Trinkstrategie für mein Training.",
      },
    ],
  },
  {
    id: "recovery",
    label: "Erholungscoach",
    shortLabel: "Erholung",
    icon: "💤",
    accent: "text-teal-400",
    accentBg: "bg-teal-600 hover:bg-teal-500",
    accentBorder: "border-teal-500",
    welcome:
      "Ich bin dein Erholungscoach. Ich analysiere Schlaf, HRV, Stress und Body Battery, damit du gesund und verletzungsfrei bleibst.",
    quickActions: [
      {
        label: "Genug Schlaf?",
        message: "Bekomme ich genug Schlaf? Analysiere meine Schlaftrends.",
      },
      {
        label: "Deload-Woche?",
        message: "Sollte ich basierend auf meinen aktuellen Daten eine Deload-Woche einlegen?",
      },
      {
        label: "Verletzungsrisiko",
        message:
          "Wie hoch ist mein aktuelles Verletzungsrisiko basierend auf Training Load und Erholung?",
      },
      {
        label: "Erholungstipps",
        message: "Gib mir konkrete Erholungsmaßnahmen für heute.",
      },
    ],
  },
] as const;

function getAgentConfig(id: AgentType): AgentConfig {
  return AGENTS.find((a) => a.id === id)!;
}

// ---------------------------------------------------------------------------
// Markdown renderer (simple: bold, lists, headers)
// ---------------------------------------------------------------------------

function renderMarkdown(text: string) {
  const lines = text.split("\n");
  return lines.map((line, li) => {
    // Strip leading whitespace before matching block-level markers. LLMs
    // sometimes indent bullets/headers under a parent list which previously
    // caused the prefix (`*`, `-`, `### `) to render literally (#153).
    const trimmed = line.replace(/^\s+/, "");

    // Horizontal rule (e.g. "---" / "***" / "___"). Render as a divider
    // instead of leaking the literal text into the response body.
    if (/^[-*_]{3,}\s*$/.test(trimmed))
      return (
        <hr
          key={li}
          className="my-2 border-0 border-t border-border/60"
          aria-hidden="true"
        />
      );

    // Headers
    if (trimmed.startsWith("### "))
      return (
        <h4 key={li} className="mt-3 mb-1 text-sm font-bold text-foreground">
          {renderInline(trimmed.slice(4))}
        </h4>
      );
    if (trimmed.startsWith("## "))
      return (
        <h3 key={li} className="mt-3 mb-1 text-sm font-bold text-foreground">
          {renderInline(trimmed.slice(3))}
        </h3>
      );

    // Bullet lists
    if (/^[-•*] /.test(trimmed))
      return (
        <li key={li} className="ml-4 list-disc text-sm leading-relaxed">
          {renderInline(trimmed.replace(/^[-•*] /, ""))}
        </li>
      );

    // Numbered lists
    if (/^\d+\. /.test(trimmed))
      return (
        <li key={li} className="ml-4 list-decimal text-sm leading-relaxed">
          {renderInline(trimmed.replace(/^\d+\. /, ""))}
        </li>
      );

    // Empty line → spacer
    if (line.trim() === "") return <br key={li} />;

    // Normal paragraph
    return (
      <p key={li} className="text-sm leading-relaxed">
        {renderInline(line)}
      </p>
    );
  });
}

function renderInline(text: string) {
  // Bold **text**, italic _text_ or *text*. LLMs often emit single-asterisk
  // italics which previously rendered as literal asterisks (#153).
  // Order matters: try **bold** first so single-asterisk italic doesn't
  // greedily eat the inner content.
  return text.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*|_[^_\n]+_)/).map((seg, i) => {
    if (seg.startsWith("**") && seg.endsWith("**"))
      return (
        <strong key={i} className="font-semibold">
          {seg.slice(2, -2)}
        </strong>
      );
    if (
      (seg.startsWith("_") && seg.endsWith("_") && seg.length > 2) ||
      (seg.startsWith("*") && seg.endsWith("*") && seg.length > 2)
    )
      return (
        <em key={i} className="italic">
          {seg.slice(1, -1)}
        </em>
      );
    return <span key={i}>{seg}</span>;
  });
}

// ---------------------------------------------------------------------------
// Chat Bubble
// ---------------------------------------------------------------------------

function ChatBubble({
  role,
  content,
  createdAt,
  agentConfig,
  timezone,
}: {
  role: string;
  content: string;
  createdAt: string | Date;
  agentConfig: AgentConfig;
  timezone: string;
}) {
  const isUser = role === "user";
  const time = formatTimeInTz(createdAt, timezone, {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}
    >
      <div className={cn("max-w-[85%] space-y-1")}>
        {!isUser && (
          <span className={cn("text-xs font-medium", agentConfig.accent)}>
            {agentConfig.icon} {agentConfig.label}
          </span>
        )}
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5",
            isUser
              ? "bg-indigo-600 text-primary-foreground"
              : "bg-muted text-foreground",
          )}
        >
          {isUser ? (
            <p className="text-sm leading-relaxed">{content}</p>
          ) : (
            <div className="space-y-0.5">{renderMarkdown(content)}</div>
          )}
        </div>
        <p
          className={cn(
            "text-[10px] text-muted-foreground",
            isUser ? "text-right" : "text-left",
          )}
        >
          {time}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CoachPage() {
  const trpc = useTRPC();
  const timezone = useUserTimezone();
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [activeAgent, setActiveAgent] = useState<AgentType>("sport-scientist");
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const agentConfig = getAgentConfig(activeAgent);

  const history = useQuery(trpc.chat.getHistory.queryOptions({ limit: 50 }));

  const [sendError, setSendError] = useState<string | null>(null);

  const sendMutation = useMutation(
    trpc.chat.sendMessage.mutationOptions({
      onSuccess: () => {
        setSendError(null);
        void queryClient.invalidateQueries({
          queryKey: trpc.chat.getHistory.queryKey(),
        });
      },
      onError: (err) => {
        setSendError(
          err.message ?? "KI-Antwort fehlgeschlagen. Bitte versuch es erneut.",
        );
      },
    }),
  );

  const clearMutation = useMutation(
    trpc.chat.clearHistory.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.chat.getHistory.queryKey(),
        });
        setShowClearConfirm(false);
      },
    }),
  );

  const messages = history.data ?? [];

  // A coaching answer takes tens of seconds — a reasoning model on a pinned
  // provider was measured between 34s and 94s. Static dots give no sign that
  // anything is still happening over that long, so count the seconds.
  const [waitedSeconds, setWaitedSeconds] = useState(0);
  useEffect(() => {
    if (!sendMutation.isPending) {
      setWaitedSeconds(0);
      return;
    }
    const started = Date.now();
    const id = setInterval(
      () => setWaitedSeconds(Math.round((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, [sendMutation.isPending]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, sendMutation.isPending]);

  function handleSend(text?: string) {
    const content = (text ?? input).trim();
    if (!content || sendMutation.isPending) return;
    setInput("");
    sendMutation.mutate({ content, agent: activeAgent });
  }

  return (
    <PageShell density="reading">
      {/* PageShell's own pt-6 + pb-10 (4rem total) is subtracted here so this
          chat shell still fills exactly one viewport, matching the fixed
          header/input behavior it had before the migration. */}
      <div className="bg-background flex h-[calc(100dvh-4rem)] flex-col">
      {/* Header */}
      <header className="border-border bg-card flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Zurück
          </Link>
          <div>
            <h1 className="text-foreground text-base font-semibold">
              {agentConfig.icon} KI-{agentConfig.label}
            </h1>
            <p className="text-muted-foreground text-xs">
              Basierend auf deinen Garmin-Daten
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowClearConfirm(true)}
          className="text-muted-foreground hover:bg-accent hover:text-foreground rounded-lg px-2 py-1 text-xs transition-colors"
        >
          Löschen
        </button>
      </header>

      {/* Agent Selector Tabs */}
      <div className="border-border bg-card/60 flex [scrollbar-width:thin] gap-1 overflow-x-auto border-b px-3 py-2">
        {AGENTS.map((agent) => (
          <button
            key={agent.id}
            onClick={() => setActiveAgent(agent.id)}
            aria-label={agent.label}
            className={cn(
              "shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors sm:px-3",
              activeAgent === agent.id
                ? cn(agent.accentBg, "text-primary-foreground")
                : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <span aria-hidden="true">{agent.icon}</span>
            <span className="ml-1 sm:hidden">{agent.shortLabel}</span>
            <span className="ml-1 hidden sm:inline">{agent.label}</span>
          </button>
        ))}
      </div>

      {/* Clear confirmation dialog */}
      {showClearConfirm && (
        <div className="border-border bg-card/80 border-b px-4 py-3">
          <p className="text-foreground text-sm">Gesamten Chatverlauf löschen?</p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => clearMutation.mutate()}
              disabled={clearMutation.isPending}
              className="text-primary-foreground rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium hover:bg-red-500 disabled:opacity-50"
            >
              {clearMutation.isPending ? "Wird gelöscht…" : "Ja, löschen"}
            </button>
            <button
              onClick={() => setShowClearConfirm(false)}
              className="bg-muted text-foreground hover:bg-accent rounded-lg px-3 py-1.5 text-xs"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !history.isLoading ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="text-4xl">{agentConfig.icon}</p>
            <p className="text-muted-foreground mt-3 max-w-xs text-sm leading-relaxed">
              {agentConfig.welcome}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => (
              <ChatBubble
                key={msg.id}
                role={msg.role}
                content={msg.content}
                createdAt={msg.createdAt}
                agentConfig={agentConfig}
                timezone={timezone}
              />
            ))}
            {sendMutation.isPending && (
              <div className="flex justify-start">
                <div className="max-w-[85%] space-y-1">
                  <span
                    className={cn("text-xs font-medium", agentConfig.accent)}
                  >
                    {agentConfig.icon} {agentConfig.label}
                  </span>
                  <div className="bg-muted text-foreground rounded-2xl px-4 py-3 text-sm">
                    <span className="mr-2">
                      {agentConfig.label} denkt nach…
                      {waitedSeconds > 0 && ` ${waitedSeconds}s`}
                    </span>
                    <span className="inline-flex gap-1" aria-hidden="true">
                      <span className="animate-bounce">●</span>
                      <span className="animate-bounce [animation-delay:0.15s]">
                        ●
                      </span>
                      <span className="animate-bounce [animation-delay:0.3s]">
                        ●
                      </span>
                    </span>
                    {waitedSeconds >= 20 && (
                      <p className="text-muted-foreground mt-2 text-xs">
                        Das Modell denkt intern, bevor es antwortet — das dauert
                        meist 30–90 Sekunden.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
            {sendError && !sendMutation.isPending && (
              <div className="flex justify-start">
                <div className="max-w-[85%] space-y-1">
                  <div className="rounded-2xl border border-red-700/50 bg-red-900/40 px-4 py-2.5 text-sm text-red-300">
                    {sendError}
                  </div>
                  <button
                    onClick={() => setSendError(null)}
                    className="text-muted-foreground hover:text-foreground text-[10px] transition-colors"
                  >
                    Schließen
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Quick Actions — always visible above input */}
      {!history.isLoading && (
        <div className="border-border flex flex-wrap gap-2 border-t px-4 py-2">
          {agentConfig.quickActions.map((action) => (
            <button
              key={action.label}
              onClick={() => handleSend(action.message)}
              disabled={sendMutation.isPending}
              className={cn(
                "max-w-full rounded-full border px-3 py-1.5 text-left text-xs whitespace-normal transition-colors disabled:opacity-50",
                agentConfig.accentBorder,
                "bg-muted text-foreground hover:bg-accent",
              )}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      {/* Input Area */}
      <div className="border-border bg-card border-t px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex gap-2"
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`${agentConfig.label}: deine Nachricht…`}
            disabled={sendMutation.isPending}
            className={cn(
              "bg-muted text-foreground placeholder:text-muted-foreground flex-1 rounded-xl border px-4 py-2.5 text-sm focus:outline-none disabled:opacity-50",
              `focus:${agentConfig.accentBorder}`,
              "border-border",
            )}
          />
          <button
            type="submit"
            disabled={!input.trim() || sendMutation.isPending}
            className={cn(
              "text-primary-foreground rounded-xl px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50",
              agentConfig.accentBg,
            )}
          >
            Senden
          </button>
        </form>
      </div>
      </div>
    </PageShell>
  );
}
