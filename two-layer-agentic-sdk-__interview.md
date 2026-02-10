# Interview Log: Two-Layer Agentic Planning and Execution SDK

**Topic:** Two-Layer Cake — Agentic Planning and Execution Architecture
**Date:** 2026-02-09
**Interviewer:** Claude
**Interviewee:** Project Owner

---

## Turn 1: Foundational Questions

### Q1: Primary Use Case
**Question:** What is the primary use case or product this architecture serves?
**Options:**
- Developer framework/SDK — A reusable library others integrate into their own applications
- Internal platform — A specific product that uses this architecture under the hood
- Reference architecture — A design document/blueprint to guide future implementation

**Selection:** Developer framework/SDK

### Q2: Target Runtime
**Question:** What is the target runtime environment?
**Options:**
- Python backend service
- TypeScript/Node backend
- Language-agnostic

**Selection:** TypeScript/Node backend

### Q3: LLM Integration Strategy
**Question:** Which LLM integration model are you targeting?
**Options:**
- Single LLM provider
- Multi-provider (different agents can use different LLM providers)
- Configurable per-agent

**Selection:** Multi-provider

---

## Turn 2: SDK API Surface and LLM Abstraction

### Q4: SDK API Design
**Question:** How should developers interact with the system?
**Options Presented with Analysis:**
- **High-level orchestrator** — Simplest adoption, SDK handles orchestration internally. Con: less flexibility. Mitigation: plugin hooks for customization. *(Recommended)*
- **Composable pipeline** — Developers wire Interpreter → Decomposer → Assigner → Executor. Higher learning curve.
- **Modular toolkit** — Each component independently importable. Maximum flexibility but less coherence.

**Selection:** High-level orchestrator

### Q5: LLM Abstraction Model
**Question:** How should multi-provider LLM support work?
**Options:**
- Built-in adapter layer — SDK ships adapters for major providers
- Bring-your-own client — SDK defines interface, developers implement it
- Both — Built-in adapters plus custom interface support

**Selection:** Both

---

## Turn 3: Concurrency, Communication, and Execution Scope

### Q6: Concurrency Model
**Question:** Should agents execute subtasks in parallel? How should parallelism be controlled?
**Options with Analysis:**
- **DAG-based parallel** — Planner produces dependency graph. Independent subtasks run concurrently. *(Recommended)*
- **Sequential by default** — One at a time, simpler but slower.
- **All-parallel by default** — Everything concurrent unless explicitly dependent. Fast but risky.

**Selection:** DAG-based parallel

### Q7: Agent-Planner Communication
**Question:** How should agents communicate with the planner during execution?
**Options with Analysis:**
- **Event-based + streaming** — EventEmitter for lifecycle events, async iterables for streaming. *(Recommended)*
- **Pure callbacks/events** — Simple EventEmitter, no streaming.
- **Message channels** — Structured async channels. More formal but heavier.

**Selection:** Event-based + streaming

### Q8: Execution Scope
**Question:** Should the SDK support cross-process agent execution?
**Options:**
- In-process only (v1) — All agents run in same Node.js process
- Worker thread support — Optional isolation
- Full distributed support — Across processes, machines, containers

**Selection:** In-process only (v1)

---

## Turn 4: Agent Model

### Q9: Built-in Agent Packaging
**Question:** How complete should built-in agents be? Heavy dependencies (Puppeteer, MCP) vs. lightweight core?
**Options with Analysis:**
- **Core + plugin packages** — Lightweight agents in core, heavy agents as separate npm packages. *(Recommended)*
- **All-in-one package** — Everything in one package with optional peer deps.
- **No built-in agents** — Framework only, all agents separate.

**Selection:** Core + plugin packages

### Q10: Custom Agent Definition API
**Question:** How should developers define custom agents — classes or configuration objects?
**Options with Analysis:**
- **Config-based primary** — `defineAgent()` as primary API, `BaseAgent` class for advanced use. *(Recommended)*
- **Class-based primary** — Extend `BaseAgent` consistently.
- **Config-only** — Declarative only, no class inheritance.

**Selection:** Config-based primary

---

## Turn 5: Planning and Tool System

### Q11: Planning LLM Call Strategy
**Question:** Should planning subcomponents (interpret, decompose, assign) be separate or single LLM calls?
**Options with Analysis:**
- **Single call (default)** — One LLM call for full plan. Optional stepwise mode for debugging. *(Recommended)*
- **Separate sequential calls** — Each subcomponent distinct. More controllable but 3-4x latency/cost.
- **Configurable per-plan** — Developer chooses per-invocation.

**Selection:** Single call (default)

### Q12: Tool Registration Model
**Question:** How should tools be made available to agents?
**Options with Analysis:**
- **Registry with scoping** — Central ToolRegistry, each agent gets scoped subset. *(Recommended)*
- **Agent-local tools** — Each agent defines own tools inline.
- **Global tool pool** — All tools available to all agents.

**Selection:** Registry with scoping

---

## Turn 6: State Management and Error Handling

### Q13: State Storage
**Question:** Where is plan/execution state stored?
**Options with Analysis:**
- **In-memory + adapter** — Default in-memory with PlanStore interface for custom persistence. *(Recommended)*
- **In-memory only** — No persistence abstraction.
- **Built-in file persistence** — JSON file-based persistence included.

**Selection:** In-memory + adapter

### Q14: Error Handling Policy
**Question:** How should error handling work?
**Options with Analysis:**
- **Rule-based + LLM escalation** — Configurable retry/backoff for transient errors, LLM escalation for complex failures. *(Recommended)*
- **Fully LLM-driven** — Every error goes to LLM. Flexible but expensive.
- **Fully rule-based** — All rules, no LLM. Predictable but rigid.

**Selection:** Rule-based + LLM escalation

### Q15: Partial Results
**Question:** Should agents support partial results?
**Options:**
- Yes, partial results — Agents return what succeeded with failure metadata.
- No, all-or-nothing — Full success or full failure.

**Selection:** Yes, partial results

---

## Turn 7: Data Model Refinements

### Q16: State Machine Simplification
**Question:** Should we simplify the original 9-state model?
**Options:**
- **Simplified** — Plan: 5 states, Subtask: 6 states. *(Recommended)*
- **Keep original 9** — Retain all original states.
- **Even simpler** — Plan: 3 states, Subtask: 4 states.

**Selection:** Simplified

### Q17: Result Type System
**Question:** How should result data be typed?
**Options:**
- **Generics** — `SubtaskResult<T>`. Type-safe, agents declare return type.
- **Unknown + runtime** — `data: unknown` with Zod validation.
- **Discriminated union** — Union of all known result shapes.

**Selection:** Generics

---

## Turn 8: Hooks and Answer Generator

### Q18: Lifecycle Hook Points
**Question:** Are these 6 hooks sufficient? (beforePlan, afterPlan, beforeAgentExecute, afterAgentExecute, onError, onPlanComplete)
**Options:**
- These 6 are good
- Add more hooks
- Fewer hooks for v1

**Selection:** These 6 are good

### Q19: Answer Generator
**Question:** How should the Answer Generator work?
**Options with Analysis:**
- **Optional built-in** — Default LLM aggregator, replaceable via hook or custom agent. *(Recommended)*
- **No default** — Developer always handles aggregation.
- **Required built-in** — Always use LLM aggregator.

**Selection:** Optional built-in

---

## Turn 9: Operational Concerns

### Q20: Cost Control
**Question:** Should there be built-in token/cost guardrails?
**Options with Analysis:**
- **Configurable limits** — Per-plan and per-agent budgets with configurable behavior on exceed. *(Recommended)*
- **Reporting only** — Track but don't enforce.
- **No built-in tracking** — Leave to LLM adapter layer.

**Selection:** Configurable limits

### Q21: Timeouts and Cancellation
**Question:** What timeout behavior should exist?
**Options with Analysis:**
- **AbortController-based** — Per-subtask and per-plan timeouts, developer cancellation. Idiomatic Node.js. *(Recommended)*
- **Simple timeout only** — Per-plan timeout, no per-subtask.
- **No built-in timeouts** — Developer handles externally.

**Selection:** AbortController-based

### Q22: DAG Validation Timing
**Question:** When should circular dependency detection occur?
**Options:**
- **Validate at both points** — After plan generation AND after afterPlan hook.
- **Validate at execution only** — Single pass at execution start.

**Selection:** Validate at both points

---

## Turn 10: Observability, Security, and MCP

### Q23: Observability
**Question:** What level of observability should be built in?
**Options with Analysis:**
- **Structured events + OTel** — Emit structured events, expose OTel-compatible trace context. OTel as optional peer dep. *(Recommended)*
- **Simple event logging** — EventEmitter only.
- **Full OTel built-in** — OTel as core dependency.

**Selection:** Structured events + OTel

### Q24: Tool Security
**Question:** What security boundaries for tool execution?
**Options with Analysis:**
- **Permission + confirmation** — Tools declare risk levels, developers configure confirmation requirements. *(Recommended)*
- **All tools auto-approved** — No permission system.
- **Strict sandboxing** — Isolated execution contexts.

**Selection:** Permission + confirmation

### Q25: MCP Integration Scope
**Question:** What should the MCP plugin support?
**Options:**
- **Client + server in plugin** — Full bidirectional MCP interoperability.
- **Client-only in plugin** — Consume MCP tools only.
- **Client-only, server later** — Client for v1, server for v2.

**Selection:** Client + server in plugin

---

## Turn 11: API Shape and Package Structure

### Q26: API Shape Validation
**Question:** Does the proposed Orchestrator API feel right?
**Options:**
- Looks good
- Needs changes

**Selection:** Looks good

### Q27: Package Naming
**Question:** Should the npm package be `two-layer-cake`?
**Options:**
- two-layer-cake
- Different name

**Selection:** two-layer-cake

---

## Turn 12: LLM Interface, Testing, and Scope

### Q28: LLM Adapter Interface
**Question:** Does the proposed LLMAdapter interface (complete, stream, completeStructured, countTokens) cover v1 needs?
**Options:**
- This covers v1
- Add function calling
- Add embeddings too

**Selection:** This covers v1

### Q29: Testing Utilities
**Question:** Should the SDK ship testing utilities?
**Options with Analysis:**
- **Mock adapters + harness** — MockLLMAdapter, TestOrchestrator, assertion utilities. *(Recommended)*
- **Mock adapter only** — Just MockLLMAdapter.
- **No test utilities** — Developer mocks themselves.

**Selection:** Mock adapters + harness

### Q30: v1 Scope Boundaries
**Question:** Are the in-scope and out-of-scope lists correct?
**Options:**
- Scope looks right
- Move items to v1
- Move items out of v1

**Selection:** Scope looks right

---

## Turn 13: Tools, Recursion, and Plan Schema

### Q31: Tool Definition API
**Question:** Does the proposed defineTool() API feel right?
**Options:**
- Looks good
- Needs changes

**Selection:** Looks good

### Q32: Recursive Planning ⚠️ DEVIATION
**Question:** Should agents be able to spawn sub-plans?
**Options with Analysis:**
- **No recursion (v1)** — Agents execute directly, flag complex subtasks for top-level re-planning. *(Recommended)*
- **Allow with depth limit** — Configurable max depth, more powerful but complex.
- **Full recursion** — No limits, maximum flexibility.

**Selection:** Allow with depth limit *(Deviated from recommendation)*

**Rationale:** The owner wanted recursive planning capability despite the added complexity, accepting the depth limit as a sufficient safeguard.

### Q33: Plan Output Schema
**Question:** Does the proposed PlanSchema capture what's needed?
**Options:**
- Schema looks right
- Needs additions

**Selection:** Schema looks right

---

## Turn 14: Recursion Details and Prompt Customization

### Q34: Recursive Planning Configuration
**Question:** What defaults for recursive planning?
**Options:**
- **Depth 2, shared budget** — Default max depth 2, sub-plans share parent's token budget. *(Recommended)*
- **Depth 3, shared budget** — Higher depth limit.
- **Depth 2, independent budgets** — Separate budgets per level.

**Selection:** Depth 2, shared budget

### Q35: Planner Prompt Customization
**Question:** How should the planner prompt be customizable?
**Options with Analysis:**
- **Template sections** — Prompt built from composable sections, developers override specific ones. *(Recommended)*
- **Fully replaceable** — Developer provides entire prompt.
- **Hardcoded default** — No customization.

**Selection:** Template sections

---

## Turn 15: Agent Tools, Concurrency, and Error Schema

### Q36: Built-in Researcher Tools ⚠️ DEVIATION
**Question:** Should the core SDK ship tools for the Researcher?
**Options:**
- **No built-in tools** — Researcher uses whatever developers register. *(Recommended)*
- **Ship basic tools** — Include HTTP fetch and text extraction.
- **Ship web search tool** — Include configurable web search.

**Selection:** Both options 2 and 3 *(Deviated from recommendation — selected both basic tools AND web search)*

**Rationale:** The owner wanted the Researcher to have useful tools out of the box, not just be an empty orchestration shell. This improves the getting-started experience.

### Q37: DAG Executor Concurrency Limit
**Question:** Should there be a max concurrency for parallel subtasks?
**Options:**
- **Configurable (default 5)** *(Recommended)*
- **Unlimited by default**
- **Configurable (default 3)**

**Selection:** Configurable (default 5)

### Q38: Error Detail Structure
**Question:** Does the proposed ErrorDetail interface cover error handling needs?
**Options:**
- Looks complete
- Needs additions

**Selection:** Looks complete

---

## Turn 16: Search API and Agent Discovery

### Q39: Web Search Tool API
**Question:** Which search API should the built-in web search tool target?
**Options:**
- **Configurable wrapper** — Developers plug in their preferred search API.
- **Tavily default** — Tavily as default, allow override.
- **Brave default** — Brave Search as default, allow override.

**Selection:** Configurable wrapper

### Q40: Agent Capability Discovery
**Question:** How should the planner know what agents are available?
**Options:**
- **Auto-inject from registry** — Agent descriptions auto-populate planner prompt. *(Recommended)*
- **Manual prompt config** — Developer manually specifies.
- **Both** — Auto-inject with manual override.

**Selection:** Auto-inject from registry

### Q41: API Versioning
**Question:** How should the SDK handle versioning?
**Options:**
- **Semver + stability tiers** — Strict semver, APIs marked stable/beta/experimental.
- **Semver only** — All public APIs stable once released.
- **Pre-1.0 flexibility** — Start at 0.x.x with flexibility.

**Selection:** Semver + stability tiers

---

## Turn 17: Wrap-Up

### Q42: Coverage Confirmation
**Question:** Have all areas been thoroughly covered?
**Options:**
- All covered, write spec
- More questions needed

**Selection:** All covered, write spec

---

## Summary of Significant Deviations from Original Spec

### 1. Product Reframing: Spec → SDK
**Original:** The spec described an abstract architecture with internal components.
**Final:** Reframed as a TypeScript/Node.js SDK with a concrete public API, package structure, and developer experience considerations.
**Reasoning:** The architecture needs to be consumable by developers, requiring explicit API design, packaging decisions, and testing support.

### 2. Recursive Planning Added (Deviation from Interviewer Recommendation)
**Original spec:** Did not address recursive planning.
**Interviewer recommended:** No recursion for v1.
**Final:** Recursive planning with configurable depth limit (default 2) and shared token budget.
**Reasoning:** Owner wanted the capability for complex task decomposition. Depth limits and shared budgets mitigate the cost/complexity risks.

### 3. Built-in Tools Added (Deviation from Interviewer Recommendation)
**Original spec:** Described agent functions abstractly (query, extract, etc.).
**Interviewer recommended:** No built-in tools; agents use developer-registered tools only.
**Final:** Ship HTTP Fetch, Text Extraction, and a configurable Web Search wrapper in the core package.
**Reasoning:** Owner wanted a better out-of-box experience where the Researcher agent can do useful work without requiring developers to implement basic tools.

### 4. State Machine Simplified
**Original:** 9 plan states (CREATED, DECOMPOSED, ASSIGNED, IN_PROGRESS, PARTIALLY_COMPLETED, COMPLETED, FAILED, UPDATED, TERMINATED).
**Final:** 5 plan states + 6 subtask states with distinct state machines for plans vs. subtasks.
**Reasoning:** The original states conflated plan-level and subtask-level concerns. Separating them eliminates ambiguity.

### 5. DAG Dependencies Added to Subtask Model
**Original:** Flat subtask list within a task.
**Final:** Subtasks have `dependsOn: string[]` forming a DAG, with cycle validation at two points.
**Reasoning:** Required by the DAG-based parallel execution model.

### 6. Numerous New Concerns Not in Original Spec
The following areas were entirely absent from the original spec and were defined during the interview:
- SDK public API shape and developer experience
- Monorepo package structure
- LLM adapter interface contract
- Tool definition API with Zod schemas
- Lifecycle hook system (6 hooks)
- Token budget and cost control
- Timeout and cancellation via AbortController
- Max concurrency limits
- Planner prompt customization (template sections)
- Agent capability auto-injection into planner prompt
- Security permission model for tools
- Observability with OpenTelemetry compatibility
- Testing utilities (MockLLMAdapter, TestOrchestrator)
- Versioning strategy (semver + stability tiers)
- Session model (stateless by default)
- Context sharing model (planner-mediated only)

---

*End of Interview Log*
