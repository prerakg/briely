# Server-side AI providers

GroqCloud and xAI Grok are different services. Groq is the primary provider; Gemini is the default fallback. xAI is disabled unless its key and model are set and it is selected as primary/fallback. No paid xAI account is required.

Set `GROQ_API_KEY`, `GEMINI_API_KEY`, `AI_PRIMARY_PROVIDER`, `AI_FALLBACK_PROVIDER`, `GROQ_MODEL`, `GEMINI_MODEL` and `GEMINI_LIVE_MODEL` in the backend environment. Models are configurable. Defaults were selected from official model catalogs on October 28, 2026: `openai/gpt-oss-20b` ([Groq models](https://console.groq.com/docs/models)), `gemini-3.8-flash` and `gemini-3.8-live` ([Gemini models](https://ai.google.dev/gemini-api/docs/models)). Check your account's model access, quotas and billing before enabling requests; free access is account dependent.

Optional `AI_TASK_MODELS` maps workflow task names to provider-specific model IDs, for example:

```dotenv
AI_TASK_MODELS={"verification":{"groq":"openai/gpt-oss-120b"},"tutor":{"groq":"openai/gpt-oss-20b"}}
```

The unified gateway supports text, structured JSON, chat context, per-task models, owner-scoped caching, request deduplication, token metadata, timeouts, bounded retry and fallback. At most two attempts are made per provider. Numeric/date Retry-After values are respected; waits up to the configured quota-wait budget (60 seconds by default) permit one primary retry before fallback. Authentication and malformed-request errors stop immediately. Groq quiz output errors with code json_validate_failed enter the bounded quiz format-correction path. Timeout/connection failures do not silently replay potentially billable calls.

Each workflow uses a separate verification request, with one bounded correction/review pass if necessary. Provider 429 and 5xx responses can fall back. Configure prompt/output budgets and request limits in `.env.example`. Very long material is chunked and sampled; choose a smaller topic when complete coverage is important. No private API keys are returned by AI Settings. A configured provider means its key is present, not that a live request has been tested. In-memory usage and failure counters reset on API restart; persisted run steps retain per-completion metadata. Exact costs are not estimated because provider pricing and account contracts vary.

`POST /api/v1/ai/stream` supports notes/tutor draft SSE events (`start`, `token`, `done`, `error`). Streamed drafts are explicitly marked `verified:false` and are not published or used for quiz grading. Interactive study screens use the fully validated workflow endpoint instead. Streams are never automatically replayed after a provider accepts a request.

Live transcription uses server-created ephemeral tokens constrained to a model, audio modality and transcription configuration. Permanent Gemini credentials remain server-side. See [Google ephemeral token guidance](https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens). Image extraction remains Gemini-specific; it is not misrouted to a text-only Groq model.

If permanent keys were previously bundled in an old deployment, rotate them in their provider consoles and replace the old static build. This implementation removes Vite secret injection but cannot revoke an already exposed credential. The existing `.env.local` has not been printed or committed.

## Longer-source reliability update

Generation now uses at most 7,000 evidence characters distributed over the selected source and task-specific output limits. GPT-OSS requests use low reasoning effort, supported by [Groq's reasoning API](https://console.groq.com/docs/reasoning). Bulk study generation is sequential. Retry-After or a safely extracted retry duration can pause a rate-limited request for up to AI_RATE_LIMIT_WAIT_SECONDS (60 seconds by default), with at most one retry per provider. Timeouts are still not silently replayed.

Independent review uses task-specific criteria. A rejected result gets one correction pass with reviewer feedback, then a second independent review. A second rejection still fails; this does not bypass quiz validation or mark rejected output verified. Failed graph steps now retain safe actionable error messages without source text or provider bodies. Automated browser fixtures use separate ports 3100/8100 so the real app can stay running on port 3000.

## Quiz formatting and notes depth

Generated quiz JSON receives a strict example plus one schema-correction opportunity. The AI boundary accepts only unambiguous representation changes (known type aliases/case, scalar index to index array, exact option text) and assigns server UUIDs. It does not guess conflicting answers, permit invalid indices, remove source checks or weaken published/public contracts. Creator title/settings are independent of model-supplied metadata. Independent answer verification still follows structural validation.

Notes have a dedicated prompt instead of the summary concision prompt. A long lecture targets roughly 900â€“1300 words with substantive sections, explanations and grounded examples; brief material gets proportional treatment. Depth validation can request one expansion. Explain More returns a full expanded replacement and the UI shows a word count. The notes output cap is now 4,200 tokens, still bounded by the configured global cap. Existing saved notes can be expanded after a frontend refresh.


## Create Quiz correction — October 29, 2026

Quiz Studio generation now sends a strict response schema to supported Groq models (GPT-OSS 20B/120B and Qwen 3.8), constraining count, requested type, difficulty and valid source-section IDs. Other models retain JSON-object output plus server validation. See [Groq structured outputs](https://console.groq.com/docs/structured-outputs). The server binds each selected section to actual source text, avoiding fabricated or imperfectly copied quotations. Public quiz contracts and answer-key protections remain unchanged.

Raw quiz completions are not cached: an invalid candidate can no longer make a later Create Quiz click instantly repeat the same failure. Other owner-scoped caches remain. Quiz output is capped at 6,000 tokens, bounded by AI_MAX_OUTPUT_TOKENS. Provider output-validation failures receive at most one format-correction attempt; structural diagnostics retain counts/lengths only.

Source retrieval retains introductory context and samples later sections within the existing evidence budget. Review can identify question IDs; correction receives the identified previous questions and replaces only those positions, preserves the other questions and reviews the complete merged draft again. Review remains fallible and source-based; a source can itself contain mistakes. The creator should inspect the draft before publishing.

The local environment now assigns verification to Groq GPT-OSS 120B using AI_TASK_MODELS, while generation continues with GPT-OSS 20B. This separates model quotas but does not guarantee availability or free usage. Existing credentials were preserved. Restart the backend after environment edits.
