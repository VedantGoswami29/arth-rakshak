# AI Financial Coach — Mastra + Groq + MongoDB

Port of the Google ADK agent (`agent/main.py`) to **Mastra + TypeScript + Zod**, using **Groq** (`@ai-sdk/groq`) and **MongoDB via Mongoose**.

## Install & run

```bash
# backend deps (exact command used to produce package.json)
npm install @ai-sdk/groq @mastra/core @mastra/memory @mastra/mongodb bcryptjs cors dotenv express jose mongoose zod
npm install -D @types/cors @types/express @types/node tsx typescript

# frontend deps (inside ./frontend)
npm --prefix frontend install        # or simply: npm run setup   (installs both)

cp .env.example .env                 # set GROQ_API_KEY, MONGODB_URI, AUTH_JWT_SECRET
npm run typecheck
```

Requires Node >= 22.13 and a reachable MongoDB (local: `docker run -d -p 27017:27017 mongo:7`).

### Run in production mode (one Express process serves API + UI)

```bash
npm run build:all     # vite build → frontend/dist, then tsc → dist/
npm start             # http://localhost:8000  (UI at /, API at /api and /auth)
```

### Run in development (hot reload)

```bash
npm run dev           # terminal 1: Express API on :8000 (tsx watch)
npm run dev:web       # terminal 2: Vite on :5173, proxies /api and /auth to :8000
```

The Express server serves `frontend/dist` (override with `FRONTEND_DIST_DIR`): fingerprinted `/assets/*` are cached immutably, `index.html` is always revalidated, and any other GET falls back to `index.html`. If `frontend/dist` is missing the server still starts and serves the API only.

### Try it

```bash
# 1. create an account (returns a JWT)
curl -s localhost:8000/auth/register -H 'content-type: application/json' \
  -d '{"email":"alice@example.com","password":"correct-horse-battery","name":"Alice"}'
export TOKEN=<token from the response>     # or POST /auth/login

# 2. chat
curl -s localhost:8000/api/chat -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"message":"My income is $8000/month and my rent is $2400. I also have a $500 student loan at 5%."}'
curl -s localhost:8000/api/chat -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"message":"Give me the full picture"}'
curl -s localhost:8000/api/state -H "Authorization: Bearer $TOKEN"
```

## Authentication (built-in)

- **Users** live in the `users` collection (`models/User.ts`): unique lowercase email, `passwordHash` (bcrypt via `bcryptjs`, `select:false`), `status` (`active`/`disabled`), `tokenVersion`, `lastLoginAt`, timestamps.
- **userId = the user's `_id`**. `/auth/register` and `/auth/login` issue an HS256 JWT (`sub` = userId, `ver` = tokenVersion).
- On **every request** the token is verified *and* the user is re-checked in MongoDB (exists, active, version matches), so disabling a user, changing a password, or "log out everywhere" takes effect immediately.
- Passwords: 10–72 bytes (bcrypt's limit), hashed with `BCRYPT_ROUNDS` (default 12); unknown-email logins still run a dummy bcrypt compare to equalise timing.
- Login/register are rate limited (in-memory, per process — also rate limit at your gateway when running several instances).
- `x-user-id` header auth exists only with `ALLOW_INSECURE_DEV_AUTH=true` and is refused in production. It bypasses the users table, so don't use it with real data.
- Register returns 409 for a duplicate email (this reveals that an email exists; remove if you need enumeration resistance).
- Not included: email verification, password reset by email, refresh tokens, MFA.

## API

| Route | Purpose |
|---|---|
| `POST /auth/register` | `{email, password, name?}` → `{user, token, expiresIn}` (public) |
| `POST /auth/login` | `{email, password}` → `{user, token, expiresIn}` (public) |
| `GET /api/me` | current user |
| `POST /api/me/password` | `{currentPassword, newPassword}` → new token; all old tokens revoked |
| `POST /api/me/logout-all` | revoke all tokens |
| `DELETE /api/me` | `{password}` → erase chat history, financial data and the user record |
| `POST /api/chat` | `{message, threadId?}` → `{reply, financial_data, reports}` |
| `POST /api/chat/stream` | same, SSE events `text`, `state`, `done`, `error` |
| `GET /api/state` | profile + latest card of each type |
| `GET /api/reports?type=&limit=` | report history |
| `DELETE /api/me/data` | erase everything for the caller |
| `GET /health` | liveness + DB state |

## Frontend (`frontend/`)

Vite + React + TypeScript + Tailwind CSS v4. Sign in / register, streaming chat (SSE), profile panel and Budget / Savings / Debt cards, account menu (change password, sign out everywhere, delete data, delete account), dark mode via system preference, mobile tabs. The JWT is kept in `localStorage` (simple, but readable by any XSS — the server sends a strict CSP; use an httpOnly-cookie flow if your threat model needs it). The chat transcript is kept in `localStorage` per user/thread; the model's own context lives server-side in Mastra Memory.

## ADK → Mastra mapping

| Google ADK (Python) | Mastra (TypeScript) |
|---|---|
| Pydantic models | Zod schemas — `schemas/finance.schema.ts` |
| `LlmAgent(model="gemini-3.5-flash")` | `new Agent({ model: groq(GROQ_MODEL) })` |
| `output_schema` | `generate(..., { structuredOutput: { schema } })` |
| `output_key` (session state) | `financial_reports` collection (`runSpecialists.ts`) |
| `state["financial_data"]` | `financial_profiles` collection |
| `before_model_callback` state injector | async `instructions` resolver (`agents/stateInjector.ts`) |
| `before_agent_callback=on_before_agent` | coach `instructions` resolver → `ensureFinancialProfile` |
| `update_financial_data` function tool | five small `createTool`s — `set_monthly_income`, `set_dependants`, `set_expenses`, `add_debts`, `remove_debts` (one per action; Mastra rewrites tool schemas for Groq so that every argument is required, which small models can't satisfy with one big optional-argument tool) |
| `AgentTool(agent)` | `createTool` whose id = agent name, running the agent |
| `SequentialAgent` | `createWorkflow(...).then().then().then().commit()` |
| coach `tools=[...]` routing | coach `tools: {...}`, routing prompt unchanged |
| `ADKAgent(user_id="demo_user")` | `RequestContext` userId set from the verified JWT of a real `users` document |
| ADK in-memory sessions | Mastra Memory (conversation history only) |
| `ag_ui_adk` FastAPI endpoint | Express REST/SSE API + Vite/React UI |

## Data isolation

`userId` is set once, by `context/auth.ts`, into Mastra's `RequestContext`. It is not in any tool input schema or prompt. Every service function takes it explicitly, validates it as a plain string (blocks `{"$ne": null}`-style injection) and filters every query by it. Chat thread ids are namespaced `userId:threadId` and Memory `resource` = userId.

## MongoDB vs Mastra Memory

- **Mongoose** (`finance_coach` DB): source of truth for financial profile + reports.
- **Mastra Memory** (`finance_coach_mastra` DB via `@mastra/mongodb`): chat message history only. Needed because the ADK session held conversation history; no working memory or semantic recall is used.

## Behaviour changes (unavoidable or deliberate)

1. **Model**: Gemini → Groq (`openai/gpt-oss-120b` default). Output quality/wording will differ. Set `GROQ_STRUCTURED_OUTPUT=prompt` for models without `json_schema` support.
2. **`Optional[X]` outputs** are `.nullable()` (key present, value `null`) instead of omitted, for Groq strict-schema compatibility.
3. **`skip_summarization=True`** has no Mastra equivalent: the coach makes a final model call after an analysis tool. The unchanged prompt already asks for a 1–2 sentence takeaway.
4. **`FullAnalysisPipeline`** tool returns all three reports (ADK returned the last agent's output); all three are also persisted.
5. **State injection** happens once per agent invocation (ADK: before every model call). Specialists make a single call, so this is equivalent for them.
6. **Persistence**: ADK state was in-memory per session; now durable per user. Reports keep history (latest = current).
7. **Hardening added**: tool inputs are range-validated (no negative amounts, rates 0–1000); optimistic-concurrency retries on profile writes.
8. **UI protocol**: AG-UI/CopilotKit endpoint replaced by REST/SSE (Express) and a bundled React UI; cards are returned in the `reports` field.
9. **Tool-call limits**: Mastra's default step limit applies instead of ADK's.

## Not verified here

Type-checked with `tsc`, and the domain logic, module graph, tool auth guard, and DB-down error path were run. **Not run against a live MongoDB or live Groq** (no network access to either in the build sandbox) — do a first end-to-end run yourself.
