# LifeOS — Personal Life Operating System (Phase 1 Foundation & Blueprint)

LifeOS is an offline-first, AI-assisted personal life manager unifying debts, smart reminders, to-do planning, notes, a secure document vault, habits, and personal finance under a single, privacy-hardened architecture. Phase 1 establishes the runnable, installable React Web/PWA foundation with an Expo-portable core, Firebase Auth & offline Firestore sync, hardened Security Rules, tri-lingual RTL support, and the provider-agnostic AI engine with its Privacy Gate.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> Before building Phase 1, please review your confirmed decisions below. Upon approval, Phase 1 will first request Firebase provisioning for Firestore & Google Sign-In, then deliver the complete, tested Phase 1 foundation before proceeding to Phase 2 (Debts Manager).

- **Confirmed Decision 1 — Runtime Delivery**: Live React Web/PWA in this workspace with an **Expo-portable core** (pure domain engines, Zod schemas, i18n dictionaries, E2E crypto helpers, and repository interfaces isolated from DOM/browser APIs).
- **Confirmed Decision 2 — Storage & Billing Posture**: **Firebase Spark free tier** with a **Local-Only Document Vault** (IndexedDB + WebCrypto) first, avoiding Blaze billing until you choose to enable Cloud Storage.
- **Confirmed Decision 3 — Localization & Currency**: **English UI** as the Stage 0 default with **IQD and USD** dual-currency formatting (plus EUR/custom), while shipping full runtime switching and logical RTL layout for **Arabic (`ar`)** and **Kurdish Sorani (`ckb`)**.
- **Confirmed Decision 4 — End-to-End Encryption**: **Opt-in per folder/note** AES-256-GCM encryption with user-held passphrase derivation and a printable/exportable **Recovery Key** flow.
- **Confirmed Decision 5 — Visual Direction**: **Calm Slate & Emerald** palette blending Material You tonal surfaces with iOS clarity across **Light, Dark, and pure-black AMOLED** themes.
- **Phased Execution Gate**: We will execute strictly in phases (Phase 1 -> Phase 7). After Phase 1 completes with unit tests, Security Rules validation, and live verification, we will pause for your review before starting Phase 2 (Debts Manager + AI).

---

## 1. Overview & Core Concept

- **What It Does**: Replaces fragmented personal apps with one calm, unified operating system covering seven life modules (Debts, Reminders, Planner, Notes, Document Vault, Habits, Finance) plus a confirmation-gated Global AI Assistant and Daily Briefing.
- **Target Audience / Persona**: Stage 0 serves a single power user managing multi-currency personal finances (IQD/USD), family/friend debts, recurring reminders, and sensitive identity documents across phone and desktop—designed from day one to scale cleanly to 100,000+ freemium users without an architectural rewrite.
- **Key Value**: Full offline usability with zero manual sync logic (powered by Firestore persistent local cache + PWA service worker), deterministic financial math separated cleanly from AI explanations, and privacy-first controls including a hard Privacy Gate while on free-tier AI.

---

## 2. User Experience & Visual Design

### Key User Flows (Phase 1 Foundation)
1. **Cold Boot & Authentication**: App opens cleanly offline or online. Users authenticate with **Google Sign-In** (via `AuthProvider` abstraction; Sign in with Apple sits behind feature flag `auth.apple.enabled = false` with an informational setup note). First boot initializes `users/{uid}` preferences and loads the server-managed `entitlements/current` snapshot.
2. **Responsive Workspace Shell**:
   - **Desktop / Tablet (`>= 1024px`)**: Fixed `260px` left/start sidebar (automatically mirrors in RTL) housing the LifeOS wordmark, module navigation (Home Briefing, Debts, Reminders, Planner, Notes, Vault, Habits, Finance, Settings & Security), offline connectivity indicator, and quick-capture trigger, paired with a clean 3-zone top bar (contextual breadcrumb, search/command trigger `Cmd/Ctrl+K`, primary quick-add action).
   - **Mobile (`< 768px`)**: Compact `56px` sticky top bar + fixed bottom navigation bar (5 thumb-reachable primary destinations with `>= 44px` hit targets and aggregate sticky chrome strictly `<= 15%` of viewport height) plus a bottom sheet drawer for secondary modules and quick actions.
3. **Home Daily Briefing & Module Readiness**: Home screen displays the calm daily greeting, real live connectivity/sync state, active currency summary strip (IQD / USD), AI Daily Briefing card (respecting global AI toggle and daily quota), and interactive module entry points—showing real empty states and Phase 1 configuration readiness rather than fake dummy metrics.
4. **Settings, Privacy & Security Center**: Interactive controls to switch **Theme** (Light / Dark / AMOLED), **Language & RTL** (English / Arabic / Kurdish Sorani), **Primary Currencies** (IQD / USD / EUR), **AI Privacy Controls** (global disable toggle, per-module toggles, visible Free-Tier Privacy Gate notice, live daily quota bar), **PIN/Biometric App Lock & Auto-Lock timer**, **Opt-in E2E Vault Passphrase & Recovery Key generator**, **PWA Install Prompt**, and **Full JSON Data Export / Account Purge scaffolding**.
5. **Global AI Command Palette (Phase 1 Skeleton)**: Accessible via floating action button or `Cmd/Ctrl+K`. Demonstrates the real end-to-end AI pipeline (Quota check -> Privacy Gate check -> Cache -> Server-side Gemini Flash / Flash-Lite fallback -> Zod validation -> Confirmation Preview card before any state mutation).

### Visual Identity & Theme
- **Aesthetic Direction**: Calm utilitarian precision inspired by Material You tonal elevation and iOS spatial clarity—generous whitespace, single-elevation flat surfaces with crisp `1px` hairline borders, zero card-inside-card clutter, zero decorative pill badge sandwiches, and zero fake telemetry tickers.
- **Color Palette & Mood (60-30-10 Discipline)**:
  - **Light Mode**: `--background: #F8FAFC` (60% cool slate-white canvas), `--surface: #FFFFFF` (30% clean container surfaces, hairline `#E2E8F0` borders), `--foreground: #0F172A`, `--muted: #64748B`, `--primary: #059669` (10% calm emerald accent for primary CTAs and active states).
  - **Dark Mode**: `--background: #0B1120` (deep slate), `--surface: #131C31`, hairline `#1E293B` borders, `--foreground: #F1F5F9` (with slight optical tracking compensation), `--primary: #10B981`.
  - **AMOLED Mode**: `--background: #000000` (true black), `--surface: #0A0F1A`, hairline `#1E293B` borders, `--primary: #10B981`.
  - **Semantic Status (Paired with Text/Icon, Never Hue-Only)**: Nominal/Settled `#16A34A`, Approaching/Warning `#D97706`, Overdue/Critical `#DC2626`.
- **Typography & Hierarchy (2+1 Font Rule)**:
  - *Display & Navigation*: `Plus Jakarta Sans` (SemiBold 600 / Bold 700, `text-wrap: balance`, Arabic/Kurdish fallback via `IBM Plex Sans Arabic` / `Noto Naskh Arabic` for crisp RTL legibility).
  - *Body & Dense Lists*: `DM Sans` (Regular 400 / Medium 500, 14px–16px, generous line-height).
  - *Financial Figures, Dates & Counters*: `JetBrains Mono` with strict `font-variant-numeric: tabular-nums` so IQD and USD columns align cleanly.
- **Component Styling & Layout**:
  - Tailwind CSS v4 with explicit `@custom-variant dark` and `.amoled` theme tokens so Light, Dark, and AMOLED switch seamlessly with zero contrast leaks.
  - Logical CSS spacing (`ps-*`, `pe-*`, `ms-*`, `me-*`, `text-start`, `border-s`) so toggling English -> Arabic -> Kurdish Sorani flips the entire layout natively without broken alignment.
  - Unboxed metadata rendered with subtle typographic separators (`·` / `/`), reserving styled segmented buttons strictly for interactive filters and mode selectors.
- **Interactive Feedback & Motion**:
  - Compositor-only transitions (`transform`, `opacity`) settling in `<= 200ms` with `prefers-reduced-motion` support.
  - Tactile micro-feedback (`navigator.vibrate` haptic fallback on supported mobile browsers), skeleton loaders matching content geometry, non-intrusive offline indicator banner, and undo toasts for destructive actions.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1 — Expo-Portable Clean Core inside a Live Vite Web/PWA App**
  - *Chosen Approach*: Build a full installable PWA (`vite-plugin-pwa`, manifest, maskable + iOS PNG icons, offline shell, in-app install button) while strictly isolating pure business logic, Zod schemas, cryptographic primitives, i18n bundles, and repository interfaces from React DOM or browser globals.
  - *Why*: Delivers a genuinely testable, installable app today in this workspace while allowing the exact `domain/`, `schemas/`, and `repositories/` contracts to drop directly into an Expo SDK + EAS Dev Build repository when you build native Android/iOS binaries.
  - *Alternatives Considered*: Authoring raw Expo/React Native native files here would fail to run in the browser preview and block live visual verification.

- **Decision 2 — Spark Free Tier + Local-Only Document Vault First**
  - *Chosen Approach*: Use Cloud Firestore (with IndexedDB multi-tab offline persistence) for structured metadata and real-time cross-device sync, paired with a Local-Only Document Vault adapter backed by browser IndexedDB (and `expo-file-system` on native) behind a unified `VaultStorageAdapter` interface.
  - *Why*: Cloud Storage for Firebase requires the Blaze billing plan. Starting with Local-Only Vault keeps Stage 0 strictly at $0 with zero billing risk while preserving a 1-line adapter swap to Cloud Storage when you enable Blaze later.
  - *Alternatives Considered*: Requiring Blaze immediately adds billing setup friction before personal testing.

- **Decision 3 — Server-Side Gemini Proxy Behind `LLMProvider` + Hard Privacy Gate**
  - *Chosen Approach*: All AI calls route through a provider-agnostic `LLMProvider` interface to an Express server endpoint (`/api/ai/complete`) backed by the official `@google/genai` SDK (`gemini-4-hydrogen` primary, `gemini-3.1-flash-lite` lightweight/fallback, driven by configuration—never hardcoded in UI). No API key ever reaches the browser. A strict client + server **Privacy Gate** blocks sensitive payloads (Vault files, IDs/passports, locked/E2E notes) whenever `free_tier = true`.
  - *Why*: Guarantees zero secret exposure, supports future drop-in migration to a Firebase Cloud Function proxy (Vertex AI / Claude / OpenAI), enforces daily per-user quotas + response caching, and protects sensitive documents from free-tier data retention.
  - *Alternatives Considered*: Direct client-side AI calls without a server proxy expose keys or tie the app rigidly to a single SDK.

- **Decision 4 — Opt-In Client-Side E2E Encryption (AES-256-GCM + Recovery Key)**
  - *Chosen Approach*: Use standard Web Crypto API (`PBKDF2-SHA256` key derivation + `AES-256-GCM` authenticated encryption with per-item random 96-bit IVs) for opted-in Vault folders and locked notes, generating a human-readable Recovery Key stored only by the user.
  - *Why*: Gives true zero-knowledge protection for passports, IDs, and private notes while keeping regular notes/tasks fast, searchable, and AI-compatible by default.
  - *Alternatives Considered*: Always-on E2E breaks search and AI assistance across non-sensitive daily items and increases accidental data-loss risk if a user loses their passphrase.

- **Decision 5 — Eight-Pillar Hardened Firestore Security Rules + Emulator TDD**
  - *Chosen Approach*: Author `firebase-blueprint.json`, `security_spec.md` (with Dirty Dozen adversarial payloads), `firestore.rules` (default deny, strict `uid == request.auth.uid`, `email_verified`, `isValidId()`, per-entity `isValid*()` helpers, immutable `createdAt`/`ownerId`, server-only lock on `entitlements/current`, monotonic daily `aiUsage`), lint with `@firebase/eslint-plugin-security-rules`, and ship automated unit tests verifying cross-user and schema-poisoning rejections.
  - *Why*: Financial and identity metadata require verifiable, zero-trust enforcement at the database boundary rather than client-side filtering.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### System & Component Architecture

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                        LifeOS Client (React Web / PWA)                       │
│                                                                              │
│  ┌──────────────────────┐   ┌─────────────────────┐   ┌───────────────────┐  │
│  │  Responsive App Shell│   │   Feature Modules   │   │  Global Overlays  │  │
│  │  • Desktop Sidebar   │   │  (Phase 1 Ready +   │   │  • Cmd+K AI Chat  │  │
│  │  • Mobile Bottom Tabs│   │   Phases 2-7 Slots) │   │  • Privacy Gate   │  │
│  │  • RTL & Theme Switch│   │  • Home Briefing    │   │  • App Lock Gate  │  │
│  │  • PWA Install & Sync│   │  • Settings/Security│   │  • Confirm Sheet  │  │
│  └──────────┬───────────┘   └──────────┬──────────┘   └─────────┬─────────┘  │
│             └──────────────────────────┼────────────────────────┘            │
│                                        ▼                                     │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │          Expo-Portable Core (Zero DOM / Zero Firebase Imports)         │  │
│  │  • Zustand UI Store (ephemeral UI, lock state, undo queue, filters)    │  │
│  │  • Pure Domain Engines (Currency/Minor-Units, Privacy Gate, Quota,     │  │
│  │    Entitlement Evaluator, AES-256-GCM E2E Crypto, Prompt Guard, Zod)   │  │
│  │  • Repository & Provider Interfaces (Auth, UserPrefs, AI, LocalVault)  │  │
│  └──────────────────────────┬──────────────────────────┬──────────────────┘  │
└─────────────────────────────┼──────────────────────────┼─────────────────────┘
                              │                          │
          ┌───────────────────▼──────────┐    ┌──────────▼────────────────────┐
          │   Firebase Web Adapter       │    │   Server-Side AI Proxy        │
          │  • Google Sign-In Auth       │    │   (Express /api/ai/*)         │
          │  • Firestore + Persistent    │    │  • @google/genai SDK          │
          │    Local Cache (IndexedDB)   │    │  • Model Config (Flash/Lite)  │
          │  • Structured Error Handler  │    │  • Privacy Gate Enforcement   │
          │  • Local-Only IndexedDB Vault│    │  • Zod Output Validation      │
          └───────────────────┬──────────┘    └──────────┬────────────────────┘
                              │                          │
                              ▼                          ▼
          ┌──────────────────────────────┐    ┌───────────────────────────────┐
          │   Firebase Platform          │    │   Gemini Developer API        │
          │  • Auth (Google; Apple Flag) │    │  • Primary: gemini-4-hydrogen │
          │  • Cloud Firestore + Rules   │    │  • Lite: gemini-3.1-flash-lite│
          │  • Per-user users/{uid}/...  │    │  • No API key in client bundle│
          └──────────────────────────────┘    └───────────────────────────────┘
```

### Data Model & State (Phase 1 Core + Blueprinted Module Paths)
- **Root User Profile (`users/{uid}`)**: Display identity, locale (`en` | `ar` | `ckb`), theme (`light` | `dark` | `amoled`), default currencies (`IQD`, `USD`, `EUR`), global & per-module AI consent toggles, quiet hours, E2E vault salt/verifier metadata (never the raw key), `createdAt`, `updatedAt`, `version`.
- **Entitlements (`users/{uid}/entitlements/current`)**: Server-managed plan tier (`free` | `pro` | `family`), daily AI quota limit, vault limits, E2E entitlement flag. Client has read-only access; writes are strictly denied by Security Rules.
- **AI Quota & Cache (`users/{uid}/aiUsage/{yyyy_mm_dd}`, `users/{uid}/aiCache/{hashKey}`)**: Daily request counter + token metadata (never logs prompt content) and deterministic hash cache to reduce latency and quota burn.
- **Module Subcollections (Blueprinted & Rule-Protected from Phase 1)**: `debts`, `debtLedgers`, `reminders`, `taskLists`, `tasks`, `noteFolders`, `notes`, `vaultFolders`, `documents`, `habits`, `habitLogs`, `transactions`, `subscriptions` — all strictly scoped under `users/{uid}/...` with soft-delete tombstones (`deletedAt`).

### Interactive Component & State Mapping (Phase 1)
- **Authentication Gate & Session Manager**: Signs in via Google popup, observes `onAuthStateChanged`, validates Firestore connectivity on boot, provisions default `users/{uid}` document on first sign-in, supports clean sign-out and session lock without losing cached offline preferences.
- **Theme & RTL Controller**: Mutates root `<html>` class (`light` / `dark` / `amoled`) and `dir` (`ltr` / `rtl`) + `lang` attribute instantaneously, persisting selections both locally (instant zero-flash boot) and to `users/{uid}` in Firestore.
- **App Lock & Opt-In E2E Setup Modal**: Lets user configure a local PIN lock with auto-lock timer, and test/initialize their opt-in AES-256-GCM Vault passphrase with deterministic Recovery Key generation and verification check.
- **AI Command Palette & Privacy Gate Inspector**: Accepts natural-language test queries, displays exact text about to be sent, enforces the `free_tier = true` sensitivity filter (blocking simulated/marked vault or locked payloads with an actionable notice), tracks remaining daily quota, calls `/api/ai/complete` with Flash -> Flash-Lite fallback, validates structured JSON via Zod, and requires explicit user confirmation before applying any mutating suggestion.
- **PWA Install & Offline Banner**: Captures `beforeinstallprompt` (and shows iOS Safari "Add to Home Screen" instructions on iOS), hides when already `standalone`, and reacts to `online`/`offline` events cleanly.

### Key Sequences & Phased Verification Plan
- **Phase 1 Acceptance & Unit Tests (`node:test` via `tsx`)**:
  1. Pure currency minor-unit math & IQD/USD formatting tests.
  2. AI Privacy Gate tests (proving `free_tier = true` blocks vault images, IDs, passports, locked/E2E items while allowing minimal explicit text).
  3. AES-256-GCM E2E encrypt/decrypt + recovery key round-trip tests.
  4. Entitlement & daily quota evaluator tests.
  5. Hardened `firestore.rules` ESLint check (`@firebase/eslint-plugin-security-rules`) + Dirty Dozen security test spec.
  6. Live browser verification across Desktop (`1440x900`) and Mobile (`390x844`), covering Light/Dark/AMOLED switching, EN/AR/KU RTL mirroring, Privacy Gate enforcement, and PWA manifest/installability.
- **Subsequent Phases (Paused for Approval After Each Phase)**:
  - **Phase 2**: Debts Manager (+ deterministic repayment probability, snowball/avalanche planner, cash-flow forecast, multilingual AI reminder drafter & NL entry).
  - **Phase 3**: Smart Reminders (+ RRULE engine, 8 categories, quiet hours, unit-tested rolling 64-notification scheduler & AI NL scheduling).
  - **Phase 4**: To-Do/Planner (fractional-index drag-and-drop, unified calendar) & Rich Markdown Notes (+ E2E locked notes, versions, AI rewrite/extract).
  - **Phase 5**: Document Vault (camera/file capture, crop/enhance/PDF pipeline, nested folders, expiry reminders, Local-Only & E2E encryption, on-device OCR, gated Document AI).
  - **Phase 6**: Habits (monthly bucketed logs, streaks, heatmaps), Finance (transactions, budgets, subscriptions, CSV import/export), Global AI Tool-Calling Assistant & Search.
  - **Phase 7**: Monetization/Paywall scaffolding, GDPR ZIP export & account purge, accessibility/performance hardening & Upgrade AI Provider runbook.
