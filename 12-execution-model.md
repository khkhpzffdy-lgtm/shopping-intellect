# 12 — Execution Model (who builds, how the loop runs, how failures route)

> **Load when:** starting any implementation session; deciding which actor (Owner / Claude /
> Codex) a piece of work belongs to; writing or consuming a Slice; routing a failed slice; or
> onboarding a new collaborator to *how* this project is built (as opposed to *what* it is).
> **Depends on:** `decisions.md` (the canon — always loaded) · `CLAUDE.md` (the iron rules a
> Slice must quote) · `13-implementation-line.md` (the ordered list of Slices this model runs).
> **Standalone for:** the **operating process** — the division of labour between the three
> actors, the Slice artifact, the daily build loop, the escalation rules, and the fixed handoff
> templates. It decides **no product or architecture content**; for *what* to build → `00`–`11`
> and `decisions.md`. For the *order* to build it in → `13`.

-----

## 0. Why this document exists

`00`–`11` and `decisions.md` describe **what** Shopping Intellect is. They do not describe **how
two people and two AIs actually build it** under real constraints. This document does exactly that
one thing, and nothing else. It re-decides no schema, no endpoint, no UX rule.

The build has three actors with very different costs and capabilities. The entire process is
designed around a single principle:

> **Claude is the scarce, expensive, high-leverage brain. Codex is the abundant hands. The Owner
> is the eyes and the product authority. Every responsibility goes to the cheapest actor who can
> do it correctly.**

The concrete consequence — and the rule that governs everything below:

> **Claude does not touch the codebase during normal implementation.** Claude's output is *text
> artifacts* (Slices, builder prompts, acceptance criteria, diagnoses). Codex consumes those and
> produces code and tests. The Owner runs the result and judges behaviour. Claude only re-enters
> when the problem is **structural** (architecture, ambiguous spec, a genuinely stuck Codex), not
> mechanical.

-----

## 1. The three actors

### Human Owner

- **Can:** review product behaviour, click through completed screens/components, run the app,
  capture screenshots and error text, approve product decisions, decide priorities and what to
  build next, judge whether a result is "what I wanted."
- **Cannot:** write code, write tests, read code critically, debug, judge code quality.
- **Owns:** product decisions, priorities, the **behaviour** half of "done," and the routing of
  every failure (deciding *which template* to fill and *which actor* to send it to).

### Claude Pro (this assistant)

- **Constraint:** usage-limited. **Spend it on thinking, not typing.** Used mainly for planning,
  architecture, product decisions, **Slice design**, and **builder prompts**.
- **Owns:** architecture and the `decisions.md` canon; slicing the work into buildable units;
  writing the Slice (which *is* the builder prompt — see §2); defining each Slice's
  acceptance criteria and done-conditions; **diagnosing** a stuck Codex (returns a corrected
  Slice or a pointer, **never** hand-written feature code).
- **Does not:** write implementation code, write tests, or debug line-by-line during normal
  flow. If Claude is editing source files to make a feature work, the process has failed —
  stop and re-slice.

### GPT / Codex (in VS Code)

- **Strength:** abundant, lives in the codebase, fast at mechanical work.
- **Owns:** writing implementation code; writing tests (to the spec Claude gave); running and
  greening those tests; self-review; debugging; practical fixes. The whole "make it work" layer.
- **Consumes:** one Slice at a time. Produces code + passing tests that satisfy the Slice's
  acceptance criteria.

-----

## 2. The unit of work — the **Slice**

Everything flows through one artifact: the **Slice**. Per **D §15**, a Slice is **one combined
document** — the builder prompt *is* the Slice. There is no separate "spec for the human" plus
"prompt for Codex"; it is a single self-contained block the Owner pastes straight into Codex.

A Slice is the **smallest vertical that produces something the Owner can see and test.** It is
sized so Codex can build it in one or a few sessions **without needing Claude again.**

### Slice template (Claude → Codex, pasted by Owner)

```
SLICE <13-§n.m> — <one-line name>

GOAL
  <one sentence, product-level: what the user/operator can do after this slice that they
   couldn't before>

SCOPE
  - <in-scope item>
  - <in-scope item>
OUT OF SCOPE
  - <explicitly excluded — so Codex doesn't wander into the next slice>

RELEVANT CANON  (quoted, not just referenced — Codex does not load 00–11)
  - <verbatim rule / schema fragment / endpoint shape this slice must honour>
  - <…>

IRON RULES IN PLAY  (from CLAUDE.md §2 — breaking one is a bug)
  - <the specific non-negotiables this slice touches, e.g. "Money is integer euro cents,
     never float" / "only Repositories/Wpdb may touch $wpdb">

BUILD INSTRUCTIONS  (this is the prompt Codex acts on)
  <imperative, ordered. Names files/classes/namespaces per the canon. Tells Codex to write
   tests and green them. Tells it which existing slices it may rely on.>

TESTS  (Codex writes and greens these)
  - <unit/behaviour the tests must cover — Claude specifies WHAT to test, Codex writes them>

ACCEPTANCE CRITERIA  (the Owner verifies these by clicking/looking — no dev knowledge needed)
  [ ] <observable behaviour 1>
  [ ] <observable behaviour 2>

DONE =
  Codex's tests pass  AND  the Owner has confirmed every acceptance criterion on screen.
  (Both gates required — D §15.)
```

Two properties make the Slice cheap to run:

1. **Self-contained.** It quotes the canon it needs, so Codex never has to load the architecture
   docs and the Owner never has to assemble context. The Owner's job is *paste*, not *compile*.
2. **Behaviour-verifiable.** Acceptance criteria are written for a non-coder. The Owner can always
   tell whether a Slice passed by looking, never by reading code.

> **Slicing rules of thumb (Claude's discipline when authoring `13`):** a Slice should be
> demoable; should not depend on a slice that hasn't shipped; should touch one layer's worth of
> new surface where possible; and should be small enough that a Codex failure is *diagnosable*
> rather than a tangle. If a Slice can't be given Owner-checkable acceptance criteria, it is too
> infrastructural to be a Slice on its own — fold it into the first Slice whose behaviour it
> enables.

-----

## 3. Definition of "done" (two gates, both required)

Per **D §15**, a Slice closes only when **both** gates are green:

1. **Codex gate — tests pass.** Codex writes tests to the Slice's `TESTS` section, runs them,
   and greens them. This is Codex's own internal quality bar; the Owner never reads these tests.
   Their value is **regression protection between slices** — a later slice that breaks an earlier
   one trips a red test in Codex's session before it ever reaches the Owner.
2. **Owner gate — behaviour confirmed.** The Owner walks the `ACCEPTANCE CRITERIA` checklist
   against the running app and confirms each item.

Neither gate alone closes a Slice. Tests green but behaviour wrong → not done (Codex misread the
goal). Behaviour right but tests absent/red → not done (no regression net; the next slice is
unsafe). This costs the Owner one review pass per Slice; that pass is the point — it is the only
place a human judges the product, and it is judgement of *behaviour*, never of code.

-----

## 4. The daily loop

```
  ┌─ CLAUDE session (planning) ─────────────────────────────────┐
  │  Owner: "next I want <X>"  (or: "run the next Slice in 13")  │
  │  Claude: emits 1–3 Slices (combined docs, §2). Updates       │
  │          decisions.md FIRST if anything changed, then 13.    │
  └───────────────────────┬─────────────────────────────────────┘
                          │  Owner pastes a Slice's BUILD block
  ┌───────────────────────▼──── CODEX session (build) ──────────┐
  │  Codex: writes code + tests, runs them, self-reviews, fixes. │
  │         Loops on its own until tests pass and the BUILD       │
  │         instructions are satisfied. No Claude involved.       │
  └───────────────────────┬─────────────────────────────────────┘
                          │  Owner runs the app / looks
  ┌───────────────────────▼──── OWNER review ───────────────────┐
  │  Walks ACCEPTANCE CRITERIA. Two outcomes:                    │
  │    ✅ every box ticked      → Slice closed, next Slice        │
  │    ❌ a box fails / it broke → capture screenshot + error,    │
  │                               route per §5                    │
  └───────────────────────┬─────────────────────────────────────┘
                          │  route the failure ↓ (§5)
```

The Owner is the **conveyor belt** between Claude and Codex. The Owner never judges code — only
judges **behaviour** and **routes failures**. A "day" is one or more Slices through this loop. The
expensive Claude session at the top happens **once per batch of slices**, not once per slice — that
is how Claude usage stays low.

-----

## 5. Escalation rules (routing a failed Slice)

**The default is always Codex first.** A failure crosses to Claude only when the problem is
structural. Route by failure *type*:

| # | Failure looks like… | Goes to | The Owner sends… |
|---|---------------------|---------|------------------|
| 1 | Behaviour wrong, app runs (button does nothing, wrong text, layout off, wrong number) | **Codex** | Failure report (§6) — screenshot + expected/got |
| 2 | Error / crash / red test | **Codex** | Failure report (§6) — error text verbatim |
| 3 | Codex tried ~2–3 times and is going in circles | **Claude** | Escalation (§6) — Codex transcript + why-stuck |
| 4 | The Slice itself was wrong / ambiguous / contradicts canon | **Claude** | Escalation (§6) — this is a *slicing bug*, Claude's fault |
| 5 | A real architecture/product question surfaced ("the data model can't express this") | **Claude** | Escalation (§6) — `decisions.md` updates **before** more code |

When Claude is escalated (types 3–5) it returns **a corrected Slice or a pointer**, not
hand-written feature code (§1). For type 5, Claude updates `decisions.md` **first**, then `13`,
then re-issues the affected Slice — never patches code to dodge the decision.

> **The rule to memorize:** *Codex owns "make it work"; Claude owns "make it right"; the Owner owns
> "is it what I wanted."* Cross to Claude only when the question is structural, not mechanical.

-----

## 6. Fixed handoff templates

Three rigid shapes. They exist so the **Owner never has to think about what to include** and the
**receiving actor never burns a turn asking for missing context.** Fill the blanks; send.

### A — Slice (Claude → Codex)

The combined Slice document of §2. Pasted by the Owner straight into Codex.

### B — Failure report (Owner → Codex) — escalation types 1–2

```
SLICE: <13-§n.m — name>
EXPECTED: <what the acceptance criterion says should happen>
GOT: <what actually happened>
[screenshot]
[error text — verbatim, including stack trace if any]
```

### C — Escalation (Owner → Claude) — escalation types 3–5

```
SLICE: <13-§n.m — name>
TYPE: <3 stuck | 4 bad spec | 5 architecture/product question>
CODEX ATTEMPTS: <paste or short summary of what Codex tried and the outcomes>
WHY I THINK IT'S STUCK / WRONG: <Owner's read, in plain language>
```

The Owner only ever **fills a template**; never composes free-form developer prose. If a situation
doesn't fit a template, that itself is a signal it's an escalation (type 4 or 5) — send template C.

-----

## 7. How this keeps Claude usage low (the cost model, made explicit)

- **Batch the planning.** One Claude session emits several Slices at once (§4 top). Slices are
  self-contained, so the Owner can run them through Codex over days without returning to Claude.
- **Codex absorbs all mechanical failure.** Types 1–2 — the overwhelming majority — never reach
  Claude. They loop entirely inside Codex sessions.
- **Claude only sees structural problems.** Types 3–5 are rare by construction: good slicing makes
  type 4 rare; small slices make type 3 rare; a complete `00`–`11` makes type 5 rare.
- **Diagnosis, not labour.** When Claude is pulled in, it returns text (a fixed Slice, a pointer, a
  decision), which is cheap, not a coding session, which is not.

If Claude finds itself in long back-and-forth implementation debugging, the model has been
violated — the correct move is to **re-slice smaller** and hand back to Codex, not to keep typing
code.

-----

## 8. Guardrails (process invariants — breaking one means the process, not the code, is wrong)

1. **Claude writes text; Codex writes code.** Claude editing feature source during normal flow is
   a process bug. (§1, §7)
2. **The Owner judges behaviour, never code.** Every Slice must carry Owner-checkable acceptance
   criteria, or it isn't a valid Slice. (§2, §3)
3. **Both gates close a Slice.** Tests green *and* behaviour confirmed. (§3, D §15)
4. **Codex first.** A failure goes to Claude only when it is structural (types 3–5). (§5)
5. **`decisions.md` first, always.** Any change discovered mid-build updates the canon before any
   code, per `CLAUDE.md` §5. A Slice may **quote** canon but never **invent** it; an unknown
   defers to a `decisions.md` decision (`CLAUDE.md` §6) — Codex is told to stop and flag, not guess.
6. **Templates are mandatory.** Handoffs use §6's three shapes. (§6)

-----

*Last updated: June 2026 · canonical for the **build process**: three actors (Owner = eyes +
product authority; Claude = scarce architecting brain, text-only; Codex = abundant hands, owns the
codebase), the **Slice** as the single combined work unit (D §15), the **two-gate done** (tests
pass + Owner confirms behaviour), the **Codex-first escalation ladder**, and the **three fixed
handoff templates**. Decides no product/architecture content — `00`–`11` + `decisions.md` stay
canonical for *what*; `13-implementation-line.md` for the *order*. Table prefix not referenced
(process-level document).*
