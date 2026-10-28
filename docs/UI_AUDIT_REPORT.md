# UI feature audit — October 29, 2026

The audit used the running app at http://localhost:3000, real configured providers, and isolated Chromium profiles. The user's existing browser library was not read, changed, or uploaded. Automated regressions continue to use controlled providers and disposable databases.

## Inputs

- Learning video: [3Blue1Brown — But what is a neural network? Deep learning chapter 1](https://www.youtube.com/watch?v=aircAruvnKk). The UI listed 31 caption languages and imported English: 18,430 characters.
- Real PDF, DOCX, PPTX and TXT fixtures containing a binary-search-tree lesson, uploaded together through the file picker. Extracted combined source: 13,539 characters.
- A readable PNG learning page, uploaded through the same UI and extracted by the actual image provider: 411 characters.
- Synthetic speech routed through a browser test microphone and the real ephemeral-token Live API. No physical microphone or private audio was used.

## Results

| Feature | Result and evidence |
|---|---|
| YouTube URL, language picker, selected-caption import | Pass. Actual language-list and English-caption API responses returned 200. Caption selection no longer depends on the provider's failing bulk download endpoint. |
| Summary | Pass for video, combined documents, and image. Real generation and independent source review completed; outputs rendered and persisted. |
| Flashcards | Pass for all three inputs; eight cards each. Flip controls tested in the UI. Document Generate More Cards increased the set to 16. |
| Practice quiz | Pass for all three inputs; ten questions each. UI scoring, retake and reveal tested on video/document output. Add 5 More Questions increased the document quiz to 15. |
| Detailed notes | Pass for all three inputs. Document Explain More also succeeded after request/context fixes, expanding notes from 1,430 to 2,273 words. |
| Mind map | Pass for all three inputs. Actual SVG, layout switch, zoom/reset and refresh persistence checked. Video Regenerate Map passed with independent review. |
| Transcript/source text and topic grouping | Pass. Uploaded document source is now accessible. Real video Group by Topics completed without changing the source text. |
| Lecture tutor | Pass for video and documents, with saved chat history. An unsupported broad answer was rejected by the independent reviewer; a concrete source question succeeded. Review rejection remains an intentional protection, not a factual guarantee. |
| Recording | Pass with real provider and synthetic speech: connect, pause, resume, finish/save; latest check saved 310 characters in two chunks over 19 seconds. Physical microphone hardware remains outside this test. |
| Library controls | Pass. Import/export, source-text search, title/tag editing, deletion, themes and refresh persistence covered through UI checks. |
| Quiz Studio | Pass. Real three-question generation, editing, save and local publication. A separate guest selected answers, refreshed, submitted, and refreshed the persisted result. Creator analytics showed the attempt. |
| Study planner | Pass. Actual performance-based plan generated and displayed. Fixed immediate refresh of Saved plans; controlled UI regression starts from an empty plan list. |
| AI Activity / AI Settings | Pass. Actual runs, verification steps and server-side provider configuration displayed. No permanent keys are sent to the browser. |
| Opt-in source library | Pass. The audit explicitly saved its selected test source to the local backend and copied it back. No automatic library upload was added. |
| Multiplayer / unpublish | Pass. Two browsers joined the real generated three-question quiz, marked ready, completed all rounds, refreshed/reconnected, and displayed identical final ranks/scores. Unpublishing disabled the audit link. |
| Empty/invalid documents | Pass. Empty text is rejected before creating a source. Errors appear inline, and upload controls prevent overlapping/cancelled parsing. Legacy .doc files receive a conversion instruction. |
| Mobile and shared routes | Pass in isolated UI regressions; heavy PDF/Mermaid code remains lazy-loaded. |

## Problems fixed

1. The provider's all-languages download failed for learning videos with many tracks. The UI now lists languages, downloads the default language, and loads another language only when selected for import.
2. Summary and other study outputs were accepted as unconstrained JSON and could fail the application contract. Added explicit response schemas, limited normalization of known representations, one format-correction attempt, and safe validation diagnostics. Invalid raw schema candidates are not cached.
3. Mermaid text could be malformed or corrupted by the renderer's quote-replacement regex. Maps now use a validated node/edge structure compiled into quoted Mermaid by backend code; the renderer preserves quoted labels, ignores stale renders and fills its viewport.
4. Document mind maps were deliberately hidden/skipped, and their source tab was hidden. Both are now available, including in batch generation.
5. Review corrections lacked the previous study draft. They now receive a bounded candidate and specific reviewer feedback. Concept-map review distinguishes organizational arrows from explicit factual claims; unsupported content still fails after the correction limit.
6. Extended requests and daily quotas caused fallback failures. Added per-model pacing from provider headers, compound retry-duration parsing, request budgets tied to question count, compact note-expansion context, bounded Gemini thinking, and failover through models already explicitly configured for the same provider. Real primary-model and Gemini daily limits were observed; account limits and credentials were not changed.
7. Audio processing could remain suspended after token provisioning; pause/finish closed the stream before final transcription. Audio now starts during the user action, uses the supported audio-input field, signals end-of-stream before closing, guards stale/cancelled sessions, and rejects empty recordings.
8. Newly generated study plans did not immediately update Saved plans. The list now reloads after generation.
9. PPTX extraction now decodes actual XML text, and empty extracted documents fail before generation. Upload errors and batch progress are visible in the UI.

## Verification and limits

Final checks: 70 backend tests passed; the full 19-test UI suite passed, and the expanded two-round/reconnect battle regression passed separately. Typecheck, production build, Ruff fatal/syntax checks and diff checks passed. Built-asset credential scan: 57 JS/HTML files, zero permanent-key matches. Evidence screenshots and safe metadata are under `artifacts/live-ui-audit/` (ignored local artifacts). These include video/document maps, real quiz analytics, recording results and source-generation metadata.

Provider quotas still apply. The gateway can fail over to another already configured model, and reports quota exhaustion when no usable route remains; it cannot remove an account's limits. Independent AI review is fallible and can reject generated output. Supabase accounts, hosted PostgreSQL, physical microphone hardware and deployment were not tested or changed. All publication and source-library actions in this audit used test content on the local backend.
