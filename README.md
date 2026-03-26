# StackDash

AI-powered customer support issue triage and task management dashboard for StackOne. Automatically analyzes incoming support issues from Pylon, prioritizes them using Claude AI, generates actionable tasks, and provides team visibility into support workload.

## Features

- **AI Issue Triage** - Claude AI analyzes and prioritizes incoming issues (high/medium/low) with confidence scores
- **Webhook Integration** - Receives issues from Pylon with HMAC signature verification
- **Task Generation** - Creates actionable todos from triaged issues with investigation steps
- **Meeting Actions** - Extracts action items from Fireflies meeting transcripts
- **Claude Code Prompts** - Generates investigation prompts for debugging customer issues
- **Response Drafting** - AI-generated customer response templates
- **Team Management** - Assignee tracking with filtering by team member
- **Real-time Dashboard** - Live statistics and issue tracking with polling updates

## Tech Stack

- **Frontend**: React 19, TypeScript
- **Backend**: Hono (web framework), Bun (local dev), Cloudflare Workers (production)
- **Database**: Cloudflare D1 (SQLite), KV storage
- **AI**: Anthropic Claude API
- **Auth**: Google OAuth 2.0 (domain-restricted to @stackone.com)
- **Integrations**: StackOne MCP (Pylon, Fireflies)

## Prerequisites

- [Bun](https://bun.sh/) runtime
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) for Cloudflare deployment
- Anthropic API key
- Google OAuth credentials (for production auth)
- StackOne API credentials

## Setup

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd stackdash
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Copy the environment template and configure:
   ```bash
   cp .env.example .env
   ```

4. Configure environment variables (see [Environment Variables](#environment-variables))

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude API key for AI features |
| `PYLON_WEBHOOK_SECRET` | HMAC secret for webhook verification |
| `STACKONE_MCP_URL` | StackOne MCP endpoint |
| `STACKONE_API_KEY` | StackOne API key |
| `STACKONE_ACCOUNT_ID` | Pylon account ID |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `AUTH_REDIRECT_URI` | OAuth callback URL |
| `COOKIE_SECRET` | Secret for signing session cookies |
| `PORT` | Server port (default: 3000) |

## Development

Run the local development server with hot reload:

```bash
bun run dev
```

Or use Cloudflare Workers local environment:

```bash
bun run cf:dev
```

## Deployment

Build and deploy to Cloudflare Workers:

```bash
bun run deploy
```

This builds the React frontend, bundles assets, and deploys via Wrangler.

### Database Migrations

Apply D1 database migrations:

```bash
wrangler d1 migrations apply stackdash-db
```

## API Endpoints

### Issues
- `GET /api/issues` - Fetch all triaged issues with stats
- `GET /api/issues/:id` - Get single issue
- `GET /api/issues/assignees` - Get unique assignees
- `DELETE /api/issues/:id` - Delete issue

### Todos
- `POST /api/todos/generate` - Generate todo from issue

### Generation
- `POST /api/generate/prompt` - Generate Claude Code investigation prompt
- `POST /api/generate/response` - Generate customer response draft

### Meetings
- `POST /api/meetings/import-actions` - Import Fireflies action items

### Users
- `GET /api/users` - Fetch SE team members

### Webhooks
- `POST /api/pylon/webhook` - Receive Pylon issues

### Auth
- `GET /auth/login` - Initiate OAuth flow
- `GET /auth/callback` - OAuth redirect
- `GET /auth/logout` - Clear session

### Health
- `GET /health` - Health check

## Project Structure

```
stackdash/
├── src/
│   ├── index.ts              # Bun local dev entry
│   ├── worker.ts             # Cloudflare Workers entry
│   ├── frontend/             # React UI
│   │   ├── App.tsx
│   │   ├── components/       # Dashboard, IssueCard, TodoCard, etc.
│   │   └── hooks/            # useIssues, useTodos
│   ├── api/                  # API route handlers
│   ├── agent/                # Claude AI logic
│   ├── auth/                 # Google OAuth
│   ├── mcp/                  # StackOne MCP client
│   ├── pylon/                # Webhook handling
│   └── store/                # Data persistence (D1, KV)
├── migrations/               # D1 database migrations
├── wrangler.toml             # Cloudflare Workers config
└── package.json
```

## License

Proprietary - StackOne
