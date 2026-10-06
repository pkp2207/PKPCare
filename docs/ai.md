# AI-assisted intake (opt-in, safety-first)

> **Not a medical device. Not medical advice.** These features are assistive
> suggestions that a human confirms. They never diagnose, prescribe, dose,
> auto-book or decide anything. **Confirm a BAA (HIPAA) / DPA (DPDP, GDPR) with
> the model provider, and complete legal/clinical review, before enabling with
> real patient data.**

AI is **OFF by default**. Nothing in the UI renders and no network call is made
unless both `AI_ENABLED=true` and `ANTHROPIC_API_KEY` are set.

## Features

| Feature | Action (`lib/actions/ai.actions.ts`) | Component | Model used? |
|---|---|---|---|
| Symptom to specialty routing | `suggestSpecialty({ reason })` | `components/ai/SymptomRouter.tsx` | Only when no red flag matched |
| Emergency (red-flag) banner | same rules run client-side | `SymptomRouter` | **Never** |
| ID document prefill | `extractIdDetails(formData)` (`blobFile`, `fileName`) | `components/ai/IdPrefill.tsx` | Yes (vision), on user click |
| Pre-visit summary (staff) | `getPreVisitSummary(appointmentId)` | `components/ai/PreVisitSummary.tsx` | Optional; deterministic template otherwise |
| Status (cheap, model-free) | `getAiStatus()` | `useAiStatus` hook (cached per page) | No |

Component contracts (imported by other screens):

```ts
SymptomRouter(props: { reason: string; onSelectDoctor?: (doctorId: string) => void }): JSX.Element
IdPrefill(props: { file: File | null; onApply: (f: Partial<{ name; birthDate; identificationNumber; identificationType }>) => void }): JSX.Element
PreVisitSummary(props: { appointmentId: string }): JSX.Element
```

`birthDate` is `YYYY-MM-DD`. `identificationType` is always one of
`IdentificationTypes` from `constants`.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `AI_ENABLED` | off | Must be exactly `true` (case-insensitive) |
| `ANTHROPIC_API_KEY` | none | Required. Server only; never exposed to the client |
| `AI_MODEL` | `claude-opus-5-5` | Model id. Invalid-looking values fall back to the default |
| `AI_TIMEOUT_MS` | `15000` | Overall per-call deadline incl. the retry; clamped 2000..30000 |
| `EMERGENCY_NUMBER` | none | Shown in the red-flag message, e.g. `112`. No number is hard-coded |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | Optional https proxy/gateway |

The default model was confirmed from the Claude API model table on 2026-10-06.
Thinking cannot be disabled on `claude-opus-5-5`, so requests use
`output_config.effort: "low"` (sent only for model families that accept it) and
output caps of 2000-3000 tokens (thinking tokens count toward the cap). A faster
and cheaper model (for example `claude-sonnet-5-5`) can be set with `AI_MODEL`
after you evaluate it with the plan below. Requests use plain `fetch` (no SDK
dependency) against `POST /v1/messages` with JSON-schema structured output; the
model has **no tools**. The refusal-fallback beta is not used; a refusal simply
yields "AI unavailable" (or the template).

## Data flow and what leaves the system

```
browser --(reason text)--> server action --redactForModel--> Anthropic API
                                 |  red flags? -> answer locally, no model call
                                 |  audit: ai.<feature>, model, latency, tokens, outcome
browser --(ID image, on click)--> server action --(image bytes)--> Anthropic API
staff --(appointmentId)--> server action --(decrypt + redact)--> Anthropic API
```

Sent to the provider:

- **Triage**: the redacted reason text (max 800 chars) and the clinic's specialty
  list. No name, email, phone, ids, or user id.
- **ID prefill**: the ID **image itself** (contains name, DOB, ID number) plus a
  fixed instruction. The user is told this before clicking. Images only; PDFs are
  rejected. Same size limit as registration (5 MB), magic-byte checked.
- **Pre-visit summary**: visit type, age in years, reason, allergies, current
  medication, past and family history, each redacted (the patient's known name,
  email, phone, emergency contact, policy and ID numbers are also removed by
  value). No name, DOB, address or contact details.

Not stored anywhere by this code: prompts, images, model outputs, summaries. The
only record is the audit row (`ai.triage`, `ai.id_extract`, `ai.visit_summary`):
feature (in the action name), model id, latency, token counts and outcome, mapped
onto existing allow-listed `meta` keys (`step`=model, `durationMs`, `total`=input
tokens, `count`=output tokens, `status`=outcome). Follow-up: add dedicated keys to
`AUDIT_META_ALLOWED_KEYS` in `lib/compliance/audit.ts`. Console logs are single
content-free lines (`[ai] request failed feature=... code=...`).

Redaction (`lib/ai/redact.ts`) is best effort: emails, phone and 6+ digit runs,
mixed letter/digit ids, URLs, @handles, full dates, "my name is ..." phrases and
known identifiers; angle brackets and control/bidi characters are removed.
Names or details written in free prose can remain. It is **not anonymisation**.
Provider retention/training terms depend on your agreement; verify them.

## Consent and prerequisites

1. A signed BAA/DPA with the provider; confirm data residency and retention
   (some models require 30-day retention and are unavailable under zero data
   retention) and that the provider does not train on your data.
2. Update privacy notices/consent text to name the AI provider and the three
   uses above; the ID feature is opt-in per click and says what is sent.
3. Add the provider to your sub-processor list and risk assessment (see
   `docs/compliance.md`: "What is NOT covered").
4. Run the evaluation below and have a clinician sign off the red-flag list.

## Safety design

- **Deterministic first.** `lib/ai/red-flags.ts` is pure and runs before the model.
  A match returns an unmistakable "call emergency services / go to the nearest
  emergency department" message and the model is never called. The same module runs
  in the browser, so the red-flag banner (`role="alert"`) is shown **even when AI is
  disabled**: it is a safety feature, not an AI feature. (The server action itself
  still answers "AI assistance is not enabled" when disabled.)
- **Biased to false positives.** Negation ("no chest pain", "history of seizures")
  only applies when the cue directly precedes the symptom in the same clause;
  "not sure if chest pain" and "not only chest pain" still flag. Self-harm and
  poisoning are never negated. A bare "stroke" is not a flag; stroke *signs* are.
  Known noisy cases: "heavy bleeding" in menstrual context, "seizure" in epilepsy
  follow-ups, "fainted" in history notes.
- **Multilingual** coverage is a starter set (Spanish, French, German, romanised and
  Devanagari Hindi). Extend and review with your population.
- **Misspellings** are enumerated per keyword plus a look-alike pass (`su1c1de`).
  Rules are a safety net, not a complete classifier.
- **Assistive only.** Suggestions are shown with "This is not medical advice";
  the user clicks Select / Apply. Nothing is auto-booked, auto-applied or decided.
  The model's free-text rationale is validated but deliberately not returned or
  shown.
- **Model output is untrusted.** Schema-constrained (`output_config.format`) and
  re-validated with strict zod: unknown keys, out-of-list specialties, oversized or
  markup-only strings are rejected; accepted text has tags, links and markdown
  stripped and is rendered as plain text (no `dangerouslySetInnerHTML`).
- **Prompt injection.** User text and image text are delimited (`<patient_text>`,
  `<intake>`), labelled as untrusted data, the model has no tools, and outputs are
  schema-bound, so a hijacked reply fails validation. Allergy/medication lines and
  flags in the summary are built from the record in code; the model only appends a
  labelled "AI overview".
- **Failure modes.** Timeout (15 s overall), one retry on 429/5xx/network with
  jitter (honouring `Retry-After` up to 2 s), hard `max_tokens`, no SDK retries.
  Triage/ID failures return `ok:false` (UI hides/explains); summary falls back to
  the template.
- **Abuse limits.** Per-user and per-IP fixed-window limits (triage 20/40, ID 5/10,
  summary 30/60 per 10 min), input size limits. **In-memory, per server instance**;
  use a shared store for multi-instance deployments. The IP is only as trustworthy
  as your proxy's forwarded headers.
- **Access control.** Summary is staff only (`requireRole("admin","frontdesk","doctor")`);
  a doctor is limited to appointments whose `doctorId` is their own doctors
  document. Triage and ID prefill work for signed-in or anonymous patients
  (consistent with `PATIENT_AUTH_ENFORCED` being off during rollout).

## Evaluation plan (before enabling)

1. **Red-flag recall (highest priority).** Have clinicians write 300+ realistic
   patient phrasings: emergencies in varied wording, slang, typos, other languages,
   and mixed with routine text, plus 300+ routine requests. Label each
   `emergency` / `not`. Run `detectRedFlags`. Track **false-negative rate on
   emergencies (target: zero on the held-out set; investigate every miss and add
   a rule + test)** and false-positive rate (acceptable if low enough that the
   banner is not ignored). Re-run on every rules change (`RED_FLAG_RULES_VERSION`).
   `tests/ai/red-flags.test.ts` is the seed corpus.
2. **Routing accuracy.** Take non-emergency labelled requests with the specialty a
   front-desk/clinician would choose. Measure top-1 agreement, the share returning
   "no suggestion", and wrong-high-confidence cases (the worst outcome). Report by
   confidence band and set the minimum shown confidence from the data.
3. **ID extraction.** Use consented or synthetic ID images (varied layouts, glare,
   rotation, non-Latin names). Measure per-field exact-match, confidence
   calibration (are "high" fields right?), and the share of wrong-but-plausible
   values. Keep the review step mandatory regardless of results.
4. **Summary fidelity.** Clinicians check 100+ summaries for omissions, invented
   facts and tone; confirm allergy/medication lines match the record 100%.
5. **Adversarial.** Prompt-injection, oversize, markup and multilingual inputs.
6. **Process.** Keep the set versioned and outside the repo if it holds PHI; split
   dev/test; freeze the test split; log model id with every run; repeat on each
   model change; monitor audit outcomes (`invalid_response`, `timeout`,
   `rate_limited`) in production.

## Limits

- Not clinically validated; no regulatory clearance. Not a medical device or
  clinical decision support. Do not use it for diagnosis, triage of urgency, or
  treatment decisions.
- Red-flag rules will miss some emergencies and raise some needless alarms.
- English-centric prompts; non-English free text works less reliably.
- Specialty list comes from `listDoctors()`; with only one specialty (for example
  the static fallback "General Medicine") there is nothing to route and no model
  call is made.
- PDFs are not supported for ID prefill (no first-page rendering).
- Rate limits are per instance; no shared counters.
- Server actions cannot be cancelled mid-flight; the UI debounces (800 ms, 15+
  characters) and ignores stale responses.
- No live API calls were made while building this; all tests use a fake transport.
