import { useEffect, useRef, useState } from "react";
import { Shell } from "./components/Shell.tsx";
import { runAgent } from "./lib/agent";
import { renderMarkdown } from "./lib/markdown";

interface ToolEvent {
  name: string;
  status: "calling" | "ok" | "error";
  preview?: string;
}

interface UserMessage {
  role: "user";
  text: string;
}

interface AssistantMessage {
  role: "assistant";
  text: string;
  events: ToolEvent[];
}

type ChatMessage = UserMessage | AssistantMessage;

const STORAGE_KEY = "population-agent:history";

const SUGGESTIONS = [
  "What is the population of Australia?",
  "Compare all states and territories.",
  "How fast has Queensland grown since 2015?",
];

function loadHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatMessage[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function saveHistory(history: ChatMessage[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // localStorage may be full or unavailable — ignore.
  }
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>(loadHistory);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    saveHistory(messages);
  }, [messages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function send(text: string) {
    if (!text.trim() || sending) return;
    setSending(true);
    const userMsg: UserMessage = { role: "user", text: text.trim() };
    const assistantMsg: AssistantMessage = {
      role: "assistant",
      text: "",
      events: [],
    };

    // Snapshot the history BEFORE this user message; the agent appends its
    // own internal tool turns and shouldn't see them mixed with prior chats.
    const priorPlainHistory = messages
      .map((m) =>
        m.role === "user"
          ? { role: "user" as const, content: m.text }
          : { role: "assistant" as const, content: m.text },
      )
      .filter((m) => m.content.trim().length > 0);

    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    try {
      const gen = runAgent(priorPlainHistory, text.trim());
      for await (const ev of gen) {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last.role !== "assistant") return prev;
          switch (ev.type) {
            case "text":
              updated[updated.length - 1] = { ...last, text: last.text + ev.delta };
              break;
            case "tool_use":
              updated[updated.length - 1] = {
                ...last,
                events: [...last.events, { name: ev.name, status: "calling" }],
              };
              break;
            case "tool_result": {
              const events = [...last.events];
              for (let i = events.length - 1; i >= 0; i--) {
                if (events[i].name === ev.name && events[i].status === "calling") {
                  events[i] = {
                    name: ev.name,
                    status: ev.ok ? "ok" : "error",
                    preview: ev.preview,
                  };
                  break;
                }
              }
              updated[updated.length - 1] = { ...last, events };
              break;
            }
            case "error":
              updated[updated.length - 1] = {
                ...last,
                events: [
                  ...last.events,
                  { name: "error", status: "error", preview: ev.message },
                ],
              };
              break;
            case "done":
              break;
          }
          return updated;
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last.role !== "assistant") return prev;
        updated[updated.length - 1] = {
          ...last,
          events: [
            ...last.events,
            { name: "error", status: "error", preview: message },
          ],
        };
        return updated;
      });
    } finally {
      setSending(false);
    }
  }

  function clearChat() {
    setMessages([]);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input;
    setInput("");
    send(text);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit(e as unknown as React.FormEvent);
    }
  }

  return (
    <Shell>
      <div className="flex h-[100dvh] min-h-0 flex-col lg:h-[calc(100dvh-4rem)]">
        <div
          ref={scrollRef}
          className="flex-1 min-h-0 overflow-y-auto px-1 py-4 sm:px-4"
        >
          {messages.length === 0 ? (
            <Empty onPick={(s) => send(s)} />
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-3">
              {messages.map((m, i) => (
                <Message key={i} msg={m} />
              ))}
              {sending && (
                <div className="text-xs text-[var(--muted)] italic px-2">
                  thinking…
                </div>
              )}
            </div>
          )}
        </div>

        <form
          onSubmit={onSubmit}
          className="mx-auto w-full max-w-3xl px-1 pb-16 pt-2 sm:px-4 lg:pb-4"
        >
          <div className="flex gap-2 rounded-2xl border border-[var(--line)] bg-[var(--glass-strong)] p-2 shadow-[var(--shadow-soft)] backdrop-blur-xl">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask about Australian population…"
              rows={2}
              disabled={sending}
              className="flex-1 resize-none bg-transparent px-2 py-1 text-sm text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="self-end rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Send
            </button>
          </div>
          <div className="mt-2 flex justify-between px-1 text-[0.65rem] text-[var(--muted)]">
            <span>
              Data: live ABS{" "}
              <a
                href="https://data.api.abs.gov.au/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-[var(--ink)]"
              >
                Data API
              </a>
              . Model: Claude Sonnet 4.6.
            </span>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={clearChat}
                className="underline hover:text-[var(--ink)]"
              >
                clear chat
              </button>
            )}
          </div>
        </form>
      </div>
    </Shell>
  );
}

function Empty({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-6 px-4 text-center">
      <div>
        <h1 className="display-font text-3xl font-bold text-[var(--ink)] sm:text-4xl">
          PopulationAgent
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Ask about Australia's population. Live data from the Australian
          Bureau of Statistics.
        </p>
      </div>
      <div className="flex flex-col gap-2 w-full max-w-md">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="rounded-xl border border-[var(--line)] bg-[var(--glass)] px-4 py-3 text-left text-sm text-[var(--ink)] hover:border-[var(--line-strong)] hover:bg-[var(--glass-strong)]"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function Message({ msg }: { msg: ChatMessage }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl bg-[var(--ink)] px-4 py-2 text-sm text-[var(--paper)] whitespace-pre-wrap">
          {msg.text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      {msg.events.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {msg.events.map((e, i) => (
            <ToolBadge key={i} ev={e} />
          ))}
        </div>
      )}
      {msg.text && (
        <div
          className="prose-chat max-w-[92%] rounded-2xl border border-[var(--line)] bg-[var(--glass-strong)] px-4 py-2 text-sm text-[var(--ink)]"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }}
        />
      )}
    </div>
  );
}

function ToolBadge({ ev }: { ev: ToolEvent }) {
  const color =
    ev.status === "error"
      ? "border-red-300 bg-red-50 text-red-800"
      : ev.status === "ok"
        ? "border-[var(--line-strong)] bg-[var(--glass)] text-[var(--muted)]"
        : "border-[var(--accent)] bg-[var(--glass-strong)] text-[var(--accent-deep)] animate-pulse";
  const icon = ev.status === "ok" ? "✓" : ev.status === "error" ? "✕" : "→";
  return (
    <div
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.65rem] font-mono ${color}`}
      title={ev.preview}
    >
      <span>{icon}</span>
      <span className="truncate">{ev.name}</span>
    </div>
  );
}
