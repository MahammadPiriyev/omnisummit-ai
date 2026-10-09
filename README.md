# Proofy

Proofy verifies factual claims from live speech and uploaded recordings. It transcribes speech, searches supporting and contradicting sources, and presents evidence-backed verdicts with explanations.

## Features

- Live microphone transcription and audio/video uploads.
- Claim extraction, quick or deep research, and source-linked evidence.
- PDF, TXT, and CSV documents as additional sources.
- English interface and AI responses, with original quotations preserved.
- Session history stored locally in the browser.

Video processing uses audio only. Confidence measures the available evidence, not the probability that a claim is true. Provider failures are reported separately from factual verdicts.

## Setup

Requirements: Node.js 22, Bun, and credentials for Gemini, Speechmatics, and Bright Data.

```sh
bun install
```

Create a single `.env` file in the project root:

```dotenv
VOICECLAIM_SERVICE_MODE=live
VOICECLAIM_LLM_PROVIDER=gemini
VOICECLAIM_SESSION_SIGNING_SECRET=replace_with_a_random_secret_of_at_least_32_characters

GEMINI_API_KEY=your_key
VOICECLAIM_FAST_MODEL=gemini-3.5-flash
VOICECLAIM_SYNTHESIS_MODEL=gemini-3.5-flash
VOICECLAIM_EMBEDDING_MODEL=gemini-embedding-001

SPEECHMATICS_API_KEY=your_key
BRIGHTDATA_API_TOKEN=your_token
```

```sh
bun run dev
```

Open the URL printed in the terminal. Allow microphone access or upload a recording. Restart the server after changing `.env`.

Keep `.env` private and never prefix API keys with `VITE_`. Live operation requires available provider quota; Speechmatics temporary-token access must be enabled for live transcription.

## Validation

```sh
bun run typecheck
bun run test
bun run build
```

With the development server running, test the Gemini integration:

```sh
node scripts/smoke-local-llm.mjs --provider=gemini
```

The integration test calls real provider APIs and uses their account quotas. Automated tests cover claim processing, source validation, verdict calculations, provider errors, embeddings, and storage.

## Technology

React, TanStack Start/Router, Vite, Nitro, Tailwind CSS, shadcn/Radix UI, Lucide, Zod, and IndexedDB (`idb`). Speechmatics provides transcription, Bright Data Web MCP provides web research, and Gemini provides analysis and document embeddings. AI/ML API and Ollama are alternative LLM integrations. OpenAI Codex assisted with development and testing.

## Data handling

Completed history retains transcripts, claims, and evidence in this browser. Uploaded media and temporary custom-document data are removed when a session ends or is abandoned. Live processing sends relevant audio, text, and research requests to the configured providers.
