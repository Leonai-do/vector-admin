# Migration Plan: VectorAdmin Dependency Modernization

**Date:** 2025-12-14
**Goal:** Upgrade core dependencies (Pinecone, OpenAI, LangChain, etc.) to 2025 stable versions.
**Strategy:** Refactor one provider at a time to maintain stability, starting with the most critical (OpenAI & Pinecone).

## Phase 1: Core Utilities Refactor (OpenAI & LangChain)

Before touching vector DBs, we must fix the underlying text processing and embedding generation tools.

### Task 1.1: Upgrade OpenAI SDK

- **Target:** Upgrade `openai` from v3.3.0 to latest v4.x.
- **Action Items:**
  - Uninstall `openai` v3.
  - Install `openai@latest`.
  - Refactor `backend/utils/openAi/index.js` (or similar wrapper).
  - **Code Change:**
    - **Before:** `new OpenAIApi(new Configuration({ apiKey }))`
    - **After:** `new OpenAI({ apiKey })`
    - **Before:** `createEmbedding({ model, input })` -> `data.data[0].embedding`
    - **After:** `embeddings.create({ model, input })` -> `data[0].embedding`

### Task 1.2: Upgrade LangChain

- **Target:** Upgrade `langchain` from v0.0.107 to latest stable (v0.3.x).
- **Action Items:**
  - Install `@langchain/textsplitters` (splitting logic moved here).
  - Update `RecursiveCharacterTextSplitter` imports.
  - **Code Change:**
    - **Before:** `import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";`
    - **After:** `import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";`

---

## Phase 2: Pinecone Modernization (The "Big One")

Pinecone v0.1.6 -> v5.x is a complete rewrite.

### Task 2.1: Dependencies

- **Action:** Uninstall `@pinecone-database/pinecone` (v0.1.6).
- **Action:** Install `@pinecone-database/pinecone@latest` (v5+).

### Task 2.2: Refactor Connection & Indexing

- **Locations to Refactor:** `backend/utils/vectordatabases/providers/pinecone/index.js`.
- **Breaking Changes to Fix:**
  1.  **Init:** Remove `client.init()`. Use `new Pinecone({ apiKey })`.
  2.  **Controller:** Remove manual `fetch` to `controller.{env}.pinecone.io`. Use `pc.listIndexes()` and `pc.describeIndex(name)`.
  3.  **Targeting:** Change `client.Index(name)` to `pc.index(name)`.
  4.  **Upsert:** Update property names if changed (v5 is mostly `upsert([{ id, values, metadata }])`).
  5.  **Environment:** Remove "environment" from config UI validation (it is now auto-handled or part of the host url).

---

## Phase 3: Other Providers (Chroma, Qdrant, Weaviate)

### Task 3.1: ChromaDB

- **Upgrade:** `chromadb` v1.5.3 -> latest.
- **Changes:**
  - Verify `new ChromaClient()` auth header structure.
  - Use `getCollection` and `add` patterns compatible with latest server.

### Task 3.2: Qdrant

- **Upgrade:** `@qdrant/js-client-rest` -> latest.
- **Changes:**
  - Ensure `QdrantClient` constructor works with latest syntax.

---

## Phase 4: Validation

- **Action:** Create a script `scripts/test-connections.js`.
- **Logic:**
  - Load `.env`.
  - Attempt to split text (LangChain).
  - Attempt to embed text (OpenAI).
  - Attempt a dry-run connect to each configured DB.

## Execution Order

1.  **Execute Phase 1** (OpenAI + LangChain) -> Commit.
2.  **Execute Phase 2** (Pinecone) -> Commit.
3.  **Execute Phase 3** (Others) -> Commit.
4.  **Execute Phase 4** (Validation).
