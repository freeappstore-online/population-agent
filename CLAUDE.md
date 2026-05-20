# population-agent

A free app on FreeAppStore. Chatbot for Australian population data — Claude Sonnet 4.6 with tool use, live data from the ABS Data API (`data.api.abs.gov.au`).

- Subdomain: `population-agent.freeappstore.online`
- Dev: `pnpm install && pnpm dev`
- Build: `pnpm build`
- Deploy: `git push origin main` (auto-deploys via Cloudflare Pages)

Free, MIT-licensed, no tracking. For platform conventions, read
https://freeappstore.online/skills.md (canonical: https://raw.githubusercontent.com/freeappstore-online/freeappstore/main/SKILLS.md)
before writing or changing anything.

---

## Architecture (repo-specific)

- **Standalone** app — all logic in the browser, no Firebase. Chat history persists in `localStorage`.
- **Anthropic API** is called via `@freeappstore/sdk` proxy (`fas.proxy.fetch('api.anthropic.com/v1/messages', …)`). The developer's `ANTHROPIC_API_KEY` is stored server-side via `fas secret set` and injected by the proxy as the `x-api-key` header — the key never reaches the browser. POST + streaming SSE.
- **ABS Data API** is called directly with `fetch()` — ABS publishes public SDMX-JSON dataflows with CORS. See `web/src/lib/abs.ts` for the SDMX-JSON flattener.
- **Tools** exposed to the agent: `get_population`, `get_population_time_series`, `compare_states`, `list_abs_dataflows`, `query_abs_dataset` (escape hatch). Defined in `web/src/lib/tools.ts`.
- **Prompt caching**: `cache_control: ephemeral` on the last tool definition (caches tools + system prefix together; tools render before system in the request).
