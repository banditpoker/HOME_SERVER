# HOME_SERVER Implementation Tracker

This checklist is the working source for the initial platform foundation. Items are
checked only after the corresponding file or behavior exists and has been verified.

## Decisions locked

- [x] Use one HOME_SERVER monorepo for shared platform and application services.
- [x] Use Docker Compose as the initial deployment model.
- [x] Support multiple agent clients through repository-shared context.
- [x] Keep canonical context in Git-tracked Markdown/YAML/JSON.
- [x] Keep vector databases and search indexes as rebuildable derived data.
- [x] Exclude secrets, raw runtime data, and unredacted logs from canonical context.
- [x] Use curated memory rather than automatically promoting every conversation.
- [x] Use Ponytail as a minimal-code engineering principle, not as the whole platform policy.
- [x] Block HIGH and CRITICAL review findings before merge or deployment.

## Phase 1 - Context foundation

- [x] Define repository conventions and service boundary rules.
- [x] Create the project-wide `agent-instructions` file instructions.
- [x] Create the service catalog.
- [x] Create the dependency and data-flow maps.
- [x] Create the canonical memory index and templates.
- [x] Create review finding and review summary schemas.
- [x] Add generated-context and secret exclusions to `.gitignore`.
- [x] Add a validation command for context links and YAML/JSON structure.
- [x] Add the context-maintenance skill and context-impact checklist.
- [x] Survey external skill repositories and create an integration catalog.
- [x] Create adapted PostgreSQL, test, TDD, codebase-knowledge, and Docker-foundation skills.
- [x] Create adapted context-map, backend-patterns, Docker guardrail/build/Compose, verification, and memory-promotion skills.
- [x] Create review routing by change surface.
- [x] Inspect local agent-skills and add detailed React skill rules for future frontend services.
- [x] Add responsive web/mobile acceptance and frontend review routing.
- [x] Import detailed Docker skill references, checks, assets, and verification scripts.
- [x] Consolidate Docker skills under the `docker-master` router while preserving module resources.
- [x] Add Docker deploy, troubleshoot, and operations modules to cover the container lifecycle.
- [x] Consolidate context and memory skills under the `context-master` router while preserving module resources.
- [x] Consolidate PR/code review routing under the `review-master` router with diff-based specialist selection.
- [x] Move review specialist skills under `review-master/modules/` while preserving Docker and context routers.
- [x] Promote `verification-loop` to an independent top-level skill.
- [x] Add immutable review records and an aggregate finding registry with PR occurrence counts.
- [x] Add targeted historical finding retrieval before feature implementation.
- [x] Add portable agent onboarding and cross-provider skill entry points.
- [x] Add a reusable feature development workflow guide with prompts.
- [x] Adapt Ponytail engineering rules and lean review into `review-master`.

## Phase 2 - Telegram gateway

### Design and acceptance

- [x] Define the Telegram gateway v1 contract and versioning policy.
- [x] Define normalized incoming event fields and duplicate-update behavior.
- [x] Define outbound message request, response, and error formats.
- [x] Define authorization rules for users, chats, and commands.
- [x] Define retry, timeout, idempotency, and delivery-status semantics.
- [x] Define health/readiness and observability requirements.
- [x] Record design choices and assumptions in an ADR.

### Scaffold and configuration

- [x] Create `apps/telegram-gateway/` with TypeScript/Node.js structure.
- [x] Add package scripts for lint, typecheck, build, test, and integration test.
- [x] Add strict TypeScript configuration and formatting/lint configuration.
- [x] Add Dockerfile using a non-root runtime image.
- [x] Add `.env.example` without real credentials.
- [ ] Add local Compose wiring for gateway and PostgreSQL.
- [x] Add configuration validation with explicit startup errors.

### Core implementation

- [x] Add Telegram webhook route and secret-token verification.
- [x] Validate and normalize incoming Telegram text updates.
- [x] Persist accepted events with duplicate protection.
- [x] Add user/chat authorization backed by PostgreSQL.
- [ ] Add command routing with an explicit command allowlist.
- [ ] Add outbound text-message adapter.
- [ ] Add delivery outbox, timeout, retry, and idempotency handling.
- [ ] Add stable internal adapter API for future services.

### Reliability and operations

- [x] Add `/health` and `/ready` endpoints.
- [x] Add structured logs with token and payload redaction.
- [x] Record the v1 decision to use persisted delivery state and structured logs without a Prometheus endpoint.
- [ ] Add PostgreSQL migrations and rollback/recovery notes.
- [ ] Complete the Telegram gateway runbook with deploy, rollback, and incident steps.

### Verification and closure

- [ ] Add unit tests for validation, authorization, commands, and retry logic.
- [ ] Add integration tests for PostgreSQL persistence and outbox behavior.
- [ ] Add contract tests for inbound events and outbound adapter responses.
- [ ] Run code, security, test, Docker, and PR reviews.
- [ ] Fix or explicitly acknowledge all HIGH/CRITICAL findings.
- [ ] Re-run reviews after fixes.
- [ ] Create Markdown review summary and JSON findings.
- [ ] Create factual implementation summary.
- [ ] Update service catalog, dependency graph, data flow, runbook, and memory as applicable.
- [ ] Run `node scripts/validate-context.mjs`.
- [ ] Mark completed items only after code, tests, review, and documentation pass.

## Phase 3 - Review and memory workflow

- [x] Add reusable code, PR, architecture, Docker, security, and test review skill framework.
- [x] Add a `review-master` workflow that detects changed surfaces and emits one consolidated review.
- [ ] Add a review workflow that emits Markdown and JSON findings.
- [ ] Add a fix-and-re-review workflow.
- [ ] Add a factual implementation summary workflow.
- [ ] Add curated memory entries for confirmed findings and decisions.
- [ ] Add a rebuildable local search/index command.

## Phase 4 - Future services

- [x] Add the initial ESP8266 firmware service under `apps/Esp32/` and document its boundaries.
- [ ] Define the IoT water-quality event contract.
- [ ] Add the IoT service using the Telegram gateway adapter.
- [ ] Document monitoring, backup, media, ecommerce, and automation boundaries.
- [ ] Re-evaluate PostgreSQL `pgvector` or ChromaDB only when canonical memory volume requires semantic search.
