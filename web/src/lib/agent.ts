import { initApp } from "@freeappstore/sdk";
import { SYSTEM_PROMPT } from "./prompt";
import { runTool, tools, type ToolDef } from "./tools";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 4096;
const MAX_ITERATIONS = 8;
const ANTHROPIC_VERSION = "2023-06-01";

const fas = initApp({ appId: "population-agent" });

export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "tool_use"; name: string; input: unknown }
  | { type: "tool_result"; name: string; ok: boolean; preview: string }
  | { type: "done" }
  | { type: "error"; message: string };

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

interface MessageParam {
  role: "user" | "assistant";
  content: string | ContentBlock[] | Array<ToolResultBlockParam>;
}

interface ToolResultBlockParam {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

interface FinalMessage {
  stop_reason: string | null;
  content: ContentBlock[];
}

const toolsWithCache: Array<ToolDef & { cache_control?: { type: "ephemeral" } }> =
  tools.map((t, i) =>
    i === tools.length - 1
      ? { ...t, cache_control: { type: "ephemeral" } }
      : t,
  );

const systemWithCache = [
  {
    type: "text",
    text: SYSTEM_PROMPT,
    cache_control: { type: "ephemeral" },
  },
];

export async function* runAgent(
  history: MessageParam[],
  userMessage: string,
): AsyncGenerator<AgentEvent> {
  const messages: MessageParam[] = [
    ...history,
    { role: "user", content: userMessage },
  ];

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const body = {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemWithCache,
      tools: toolsWithCache,
      messages,
      stream: true,
    };

    const res = await fas.proxy.fetch("api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => "");
      yield {
        type: "error",
        message: `Anthropic ${res.status}: ${errText.slice(0, 300)}`,
      };
      return;
    }

    const finalMessage: FinalMessage = { stop_reason: null, content: [] };
    const blockBuilders = new Map<
      number,
      { type: "text"; text: string } | {
        type: "tool_use";
        id: string;
        name: string;
        partialJson: string;
      }
    >();

    for await (const frame of parseSse(res.body)) {
      const ev = frame.event;
      const data = frame.data;
      switch (ev) {
        case "content_block_start": {
          const block = data.content_block as ContentBlock & { id?: string };
          if (block.type === "text") {
            blockBuilders.set(data.index, { type: "text", text: "" });
          } else if (block.type === "tool_use") {
            blockBuilders.set(data.index, {
              type: "tool_use",
              id: block.id ?? "",
              name: block.name,
              partialJson: "",
            });
            yield { type: "tool_use", name: block.name, input: {} };
          }
          break;
        }
        case "content_block_delta": {
          const builder = blockBuilders.get(data.index);
          if (!builder) break;
          const delta = data.delta;
          if (delta.type === "text_delta" && builder.type === "text") {
            builder.text += delta.text;
            yield { type: "text", delta: delta.text };
          } else if (
            delta.type === "input_json_delta" &&
            builder.type === "tool_use"
          ) {
            builder.partialJson += delta.partial_json ?? "";
          }
          break;
        }
        case "content_block_stop": {
          const builder = blockBuilders.get(data.index);
          if (!builder) break;
          if (builder.type === "text") {
            finalMessage.content.push({ type: "text", text: builder.text });
          } else {
            let input: unknown = {};
            try {
              input = builder.partialJson
                ? JSON.parse(builder.partialJson)
                : {};
            } catch {
              input = { _raw: builder.partialJson };
            }
            finalMessage.content.push({
              type: "tool_use",
              id: builder.id,
              name: builder.name,
              input,
            });
          }
          blockBuilders.delete(data.index);
          break;
        }
        case "message_delta": {
          if (data.delta?.stop_reason) {
            finalMessage.stop_reason = data.delta.stop_reason;
          }
          break;
        }
        case "message_stop":
          break;
      }
    }

    messages.push({ role: "assistant", content: finalMessage.content });

    if (finalMessage.stop_reason === "end_turn") {
      yield { type: "done" };
      return;
    }

    if (finalMessage.stop_reason !== "tool_use") {
      yield {
        type: "error",
        message: `Unexpected stop_reason: ${finalMessage.stop_reason}`,
      };
      return;
    }

    const toolResults: ToolResultBlockParam[] = [];
    for (const block of finalMessage.content) {
      if (block.type !== "tool_use") continue;
      const result = await runTool(
        block.name,
        block.input as Record<string, unknown>,
      );
      const content = JSON.stringify(
        result.ok ? result.data : { error: result.error },
      );
      const preview =
        content.slice(0, 240) + (content.length > 240 ? "…" : "");
      yield { type: "tool_result", name: block.name, ok: result.ok, preview };
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content,
        is_error: !result.ok,
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  yield {
    type: "error",
    message: `Exceeded ${MAX_ITERATIONS} tool iterations.`,
  };
}

interface SseFrame {
  event: string;
  data: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const frame = parseFrame(raw);
        if (frame) yield frame;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseFrame(raw: string): SseFrame | null {
  const lines = raw.split("\n");
  let event = "message";
  let dataStr = "";
  for (const line of lines) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
  }
  if (!dataStr) return null;
  try {
    return { event, data: JSON.parse(dataStr) };
  } catch {
    return null;
  }
}
