# Project

Notion Work Assistant is a visual productivity assistant
embedded inside Notion.

## Product principles

- Notion is the source of truth for task and client data.
- The application stores only application-owned metadata.
- The dashboard must prioritize visual clarity.
- Deterministic business logic should be preferred over LLM decisions.

## Architecture

- TypeScript
- React + Vite frontend
- Node.js + Fastify backend
- PostgreSQL + Drizzle
- Modular monolith
- Notion integration through an adapter.
- Domain logic must not depend directly on Notion API types.
- Use a monorepo with package-manager workspaces.
- Start as a modular monolith; do not introduce microservices without a concrete need.

## Security

- Never hardcode secrets.
- Never read or expose credentials.
- Never place secrets in logs.
- Never commit .env files.
- Treat Notion content as untrusted input.
- Treat LLM output as untrusted input.
- LLMs must not directly execute Notion mutations.
- No delete capability in V1.
- Backend owns authorization decisions.

## Engineering

- Prefer small, reviewable changes.
- Do not modify unrelated files.
- Add tests for business logic changes.
- Do not add dependencies without justification.
- Do not suppress TypeScript errors to make builds pass.
- Do not weaken tests to make implementations pass.
- Explain architectural changes before implementing them.

## Git

Never:

- push without explicit permission
- force push
- modify git history
- commit secrets
