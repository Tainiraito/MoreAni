# AGENTS.md — MoreAni Project Rules

> **For AI agents (Hermes/Claude)**: project-level rules for MoreAni codebase.

## Project Overview

- **Name**: MoreAni（又看一集）
- **Type**: Internal content sharing tool for friends
- **Stack**: React 18 + TypeScript + Tailwind + shadcn/ui + FastAPI + SQLite
- **Dev env**: Windows local (WSL2)
- **Prod env**: NAS (192.168.31.26)
- **Domain**: moreani.lovelysia.top

## Code Style Principles

### LLM-Friendly Code

| Principle | Rule |
|-----------|------|
| Single Responsibility | Each file does ONE thing |
| Small Files | Max 300 lines Python, 200 lines TSX/TS |
| Explicit Types | Full type annotations everywhere |
| Self-Documenting | Clear names + docstrings, no cryptic abbreviations |
| Consistent Patterns | Same feature = same code structure |
| Flat Imports | No deep nesting, max 2 levels |

### React + TypeScript

```tsx
// DO: Functional component + types + clear naming
interface ContentCardProps {
  content: ContentItem
  onSelect: (id: number) => void
}

export function ContentCard({ content, onSelect }: ContentCardProps) {
  return (
    <div onClick={() => onSelect(content.id)}>
      <h3>{content.title}</h3>
    </div>
  )
}

// DON'T: No types, barrel exports, default exports
export default (props) => <div onClick={props.onSelect}>{props.content.title}</div>
```

### Python (FastAPI)

```python
# DO: Type hints + docstring
def get_content_by_id(content_id: int, db: Session) -> ContentItem:
    """Get a single content item by ID."""
    return db.query(ContentItem).filter(ContentItem.id == content_id).first()

# DON'T: No types, no docs
def get_c(cid, db):
    return db.query(ContentItem).filter(ContentItem.id == cid).first()
```

## File Structure Rules

### Backend

```
backend/
├── main.py           # Entry point ONLY, no business logic
├── database.py       # DB connection ONLY
├── models.py         # SQLAlchemy models ONLY
├── schemas.py        # Pydantic schemas ONLY
├── auth.py           # JWT utilities ONLY
├── deps.py           # FastAPI dependencies ONLY
├── services/         # Business logic
│   ├── __init__.py
│   ├── content.py    # Content CRUD + search
│   ├── rating.py     # Rating CRUD + stats
│   ├── user.py       # User management
│   ├── tag.py        # Tag management
│   └── bangumi.py    # Bangumi API client
├── routers/          # HTTP layer (thin, delegates to services)
│   └── v1/
│       ├── auth.py
│       ├── content.py
│       ├── rating.py
│       ├── user.py
│       ├── tag.py
│       ├── bangumi.py
│       └── proxy.py      # Image proxy (bypass CORP/CORS)
├── middleware/        # Cross-cutting concerns
│   ├── rate_limit.py
│   └── security.py
└── scripts/          # CLI tools
```

### Frontend (React + TypeScript)

```
frontend/src/
├── main.tsx              # Entry point
├── App.tsx               # Root component + providers
├── router.tsx            # React Router config
├── types/                # TypeScript interfaces
│   ├── content.ts
│   ├── rating.ts
│   ├── user.ts
│   └── api.ts
├── stores/               # Zustand stores
│   ├── auth-store.ts
│   ├── content-store.ts
│   └── ui-store.ts
├── pages/                # Route pages (one per route)
│   ├── HomePage.tsx
│   ├── ExplorePage.tsx
│   ├── DetailPage.tsx
│   ├── ProfilePage.tsx
│   ├── SettingsPage.tsx
│   ├── LoginPage.tsx
│   ├── RegisterPage.tsx
│   └── GuestPage.tsx
├── components/           # Reusable components
│   ├── layout/           # AppHeader, AppFooter
│   ├── content/          # ContentCard, ContentGrid
│   ├── rating/           # RatingStars, RatingForm
│   ├── auth/             # LoginForm, RegisterForm
│   └── ui/               # shadcn/ui components
├── hooks/                # Custom hooks
│   ├── use-api.ts
│   ├── use-auth.ts
│   └── use-content.ts
├── lib/                  # Utilities
│   ├── api.ts            # API client (fetch wrapper)
│   └── utils.ts          # Helper functions
└── styles/
    └── globals.css       # Tailwind imports + custom styles
```

## Git Rules

- **Local commits**: OK to do automatically
- **Push to remote**: MUST have user confirmation first
- Never `git push` without explicit user approval

## Commit Convention

```
feat: add feature X
fix: resolve bug in Y
refactor: restructure Z (no behavior change)
docs: update documentation
style: formatting, no logic change
test: add/modify tests
chore: build, CI, dependencies
```

Each commit should be:
- Atomic (one logical change)
- Descriptive (what changed and why)
- Tested (if applicable)

## Branch Strategy

```
main          ← stable releases, PR only
  └── dev     ← development mainline
       ├── feat/xxx
       ├── fix/xxx
       └── refactor/xxx
```

## Testing Requirements

### Backend

- Unit tests for services: `pytest tests/unit/`
- API tests for routers: `pytest tests/api/`
- Run before commit: `pytest tests/ -v`

### Frontend

- Component tests: Vitest
- Run before commit: `npm run test`

## Database Migration

When modifying models:
1. Update `models.py`
2. Create migration in `migrations/`
3. Test on dev data
4. Backup production DB before applying

## API Design Rules

- All APIs under `/api/v1/`
- RESTful naming: nouns, not verbs
- Consistent response format
- Pagination: `?page=1&size=20`
- Error responses: `{"detail": "message"}`
- Auth: JWT in httpOnly cookie
- Image proxy: `/api/v1/proxy/image?url=<encoded_url>` (bypass CORP/CORS for Bangumi CDN)

## Security Rules

- Never store secrets in code (use .env)
- All user input is validated (Pydantic)
- SQL injection prevented by ORM
- Rate limiting on all endpoints
- Share links use cryptographically random tokens
- Image proxy restricts to allowed domains only (bgm.tv, wikimedia, etc.)

## Vite Proxy Configuration

Frontend dev server proxies `/api/*` to backend. **Critical**: ensure `vite.config.ts` points to correct port:

```ts
// vite.config.ts
server: {
  proxy: {
    '/api': 'http://localhost:8080',  // Must match backend port
  },
},
```

## Image URL Handling (CORP/CORS)

Bangumi CDN (`lain.bgm.tv`) sets `Cross-Origin-Resource-Policy` header, blocking direct browser access.

**Solution**: Frontend components use `secureUrl()` helper to proxy external images:

```tsx
function secureUrl(url: string): string {
  if (!url) return url
  // Proxy Bangumi CDN images
  if (url.includes('lain.bgm.tv') || url.includes('bgm.tv')) {
    return `/api/v1/proxy/image?url=${encodeURIComponent(url)}`
  }
  return url.replace(/^http:\/\//, 'https://')
}
```

This applies to: `ContentCard`, `HeroSection`, `ContentDetailDialog`.

## Layout System (Gleamory Style)

All pages must use `PageContainer` or `PageMain` for consistent centering:

```tsx
import { PageContainer, PageMain } from '@/components/layout/PageContainer'

// For page content (uses <main> element)
<PageMain className="py-20 sm:py-24">
  {/* Content here */}
</PageMain>

// For other containers (uses <div> element)
<PageContainer>
  {/* Content here */}
</PageContainer>
```

**Width modes**:
- `standard` (default): `px-6 sm:px-[5.5%]` + `max-w-[90rem]` — for most pages
- `wide`: `px-4 sm:px-6 lg:px-8` + `max-w-[100rem]` — for wide workspaces

**Critical rules**:
- `AppHeader` must use same width mode as page content
- Never use custom `max-w-*` or `mx-auto` on page-level containers
- Background color: `var(--bg-page, #f5f3ef)`

## What NOT to Do

- ❌ Don't put business logic in routers
- ❌ Don't put UI logic in stores
- ❌ Don't use `any` type in TypeScript
- ❌ Don't create files > 300 lines
- ❌ Don't skip type annotations
- ❌ Don't hardcode values (use config/env)
- ❌ Don't mix concerns (DB + HTTP + Business)
- ❌ Don't use default exports (prefer named exports)
- ❌ Don't use class components (functional only)
