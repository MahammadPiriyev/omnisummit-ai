import "@tanstack/react-start/server-only";
import { z } from "zod";
import { getServerConfig } from "./config.server";
import { classifyProviderResponse, ProviderError } from "./errors.server";
import { retry, withDeadline } from "./retry.server";
import { logProviderStage } from "./logging.server";

let lastActiveAt = 0;
let warming: Promise<void> | undefined;

/** Load during session setup/audio capture, rather than the first extracted fact. */
export function warmLocalModel() {
  if (warming || Date.now() - lastActiveAt < 10 * 60_000) return warming ?? Promise.resolve();
  const config = getServerConfig();
  warming = withDeadline(async (signal) => {
    await request(
      "/api/chat",
      {
        model: config.fastModel,
        messages: [],
        stream: false,
        think: false,
        keep_alive: "15m",
        options: { num_ctx: 16384 },
      },
      signal,
    );
    lastActiveAt = Date.now();
  }, 15_000)
    .catch(() => {
      /* A warm-up failure must never prevent starting or retrying a session. */
    })
    .finally(() => {
      warming = undefined;
    });
  return warming;
}

async function request(path: string, body: unknown, signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason;
  const config = getServerConfig();
  let response: Response;
  try {
    response = await withDeadline(
      (deadline) =>
        fetch(`${config.ollamaBaseUrl.replace(/\/$/, "")}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: deadline,
        }),
      180_000,
      signal,
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof Error && error.message === "REQUEST_TIMEOUT") {
      throw new ProviderError(
        "ollama",
        "OLLAMA_TIMEOUT",
        "Lokal model vaxt həddini aşdı. Mənbə sayını və ya paralel yoxlamaları azaldıb yenidən cəhd edin.",
      );
    }
    throw new ProviderError(
      "ollama",
      "OLLAMA_UNAVAILABLE",
      "Lokal model cavab vermədi. Ollama-nı başladın və modelin yükləndiyini yoxlayın.",
    );
  }
  if (response.status === 404)
    throw new ProviderError(
      "ollama",
      "OLLAMA_MODEL_MISSING",
      "Lokal model tapılmadı. Modeli ollama pull əmri ilə yükləyin.",
    );
  if (!response.ok) throw classifyProviderResponse("ollama", response);
  return response;
}

interface CompletionOptions<T> {
  system: string;
  user: string;
  output: z.ZodType<T>;
  jsonSchema: { name: string; schema: Record<string, unknown> };
  model?: string;
  signal?: AbortSignal;
}

const pendingCompletions = new Map<string, Promise<unknown>>();

export async function ollamaCompletion<T>(options: CompletionOptions<T>): Promise<T> {
  // Only coalesce active identical work. Completed answers are never cached,
  // and independently cancellable requests keep their own provider request.
  if (options.signal) return complete(options);
  const config = getServerConfig();
  const key = JSON.stringify([
    config.ollamaBaseUrl,
    options.model ?? config.fastModel,
    options.system,
    options.user,
    options.jsonSchema,
  ]);
  let pending = pendingCompletions.get(key);
  if (!pending) {
    pending = complete(options);
    pendingCompletions.set(key, pending);
    const current = pending;
    const clear = () => {
      if (pendingCompletions.get(key) === current) pendingCompletions.delete(key);
    };
    void pending.then(clear, clear);
  }
  return options.output.parse(await pending);
}

async function complete<T>(options: CompletionOptions<T>) {
  const config = getServerConfig();
  return retry(
    async (attempt) => {
      const started = Date.now();
      const response = await request(
        "/api/chat",
        {
          model: options.model ?? config.fastModel,
          stream: false,
          think: false,
          keep_alive: "15m",
          format: options.jsonSchema.schema,
          options: {
            temperature: 0,
            num_ctx: 16384,
            num_predict: 4096,
            ...(options.jsonSchema.name === "verification_synthesis"
              ? { repeat_penalty: 1.1, repeat_last_n: 1024 }
              : {}),
          },
          messages: [
            {
              role: "system",
              content: `${options.system}\nReturn only JSON matching this schema: ${JSON.stringify(options.jsonSchema.schema)}`,
            },
            {
              role: "user",
              content:
                options.user +
                (attempt > 1
                  ? "\nCorrect the previous invalid output. Follow every schema constraint."
                  : ""),
            },
          ],
        },
        options.signal,
      );
      const body = (await response.json()) as {
        message?: { content?: string };
        done_reason?: string;
        prompt_eval_count?: number;
        eval_count?: number;
        load_duration?: number;
        prompt_eval_duration?: number;
        eval_duration?: number;
      };
      try {
        if (body.done_reason === "length") throw new Error("Truncated output");
        const parsed = options.output.parse(JSON.parse(body.message?.content ?? ""));
        lastActiveAt = Date.now();
        logProviderStage({
          provider: "ollama",
          stage: options.jsonSchema.name,
          durationMs: Date.now() - started,
          count: 1,
          promptTokens: body.prompt_eval_count,
          outputTokens: body.eval_count,
          loadMs: body.load_duration === undefined ? undefined : body.load_duration / 1e6,
          promptMs:
            body.prompt_eval_duration === undefined ? undefined : body.prompt_eval_duration / 1e6,
          generationMs: body.eval_duration === undefined ? undefined : body.eval_duration / 1e6,
        });
        return parsed;
      } catch {
        throw new ProviderError(
          "ollama",
          "OLLAMA_INVALID_OUTPUT",
          "Lokal model etibarlı cavab vermədi. Yenidən yoxlayın və ya daha böyük model seçin.",
          true,
        );
      }
    },
    { attempts: 2 },
  );
}

export async function ollamaEmbeddings(texts: string[], signal?: AbortSignal) {
  const config = getServerConfig();
  const response = await retry(() =>
    request(
      "/api/embed",
      {
        model: config.embeddingModel,
        input: texts,
        dimensions: 512,
        truncate: false,
        keep_alive: "15m",
      },
      signal,
    ),
  );
  const body = (await response.json()) as { embeddings?: number[][] };
  const vectors = body.embeddings;
  if (
    !vectors ||
    vectors.length !== texts.length ||
    vectors.some(
      (vector) => vector.length !== 512 || vector.some((value) => !Number.isFinite(value)),
    )
  ) {
    throw new ProviderError(
      "ollama",
      "OLLAMA_INVALID_EMBEDDINGS",
      "Lokal modelin mətn vektorları uyğun formatda deyil.",
    );
  }
  return vectors;
}
