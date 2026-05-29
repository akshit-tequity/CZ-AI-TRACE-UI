const LANGSMITH_API_KEY = import.meta.env.VITE_LANGSMITH_API_KEY;
const LANGSMITH_SESSION_ID = import.meta.env.VITE_LANGSMITH_SESSION_ID;

export const PAGE_SIZE = 100;

// Typed error so callers can branch on 429 vs other failures without
// reparsing the error message.
export class LangSmithError extends Error {
  constructor(status, retryAfterMs) {
    super(`LangSmith API error: ${status}`);
    this.name = "LangSmithError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

// Parses the LangSmith Retry-After response header. Spec allows either a
// delta-seconds integer or an HTTP-date; we handle both. Falls back to null
// when missing/unparseable — caller picks a default backoff.
function parseRetryAfterMs(header) {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) {
    const delta = dateMs - Date.now();
    return delta > 0 ? delta : 0;
  }
  return null;
}

// Single-page fetch — caller drives pagination (infinite-scroll on the
// sidebar). Bursting all pages up-front got us 429-rate-limited by LangSmith.
//
// IMPORTANT: LangSmith's /runs/query endpoint IGNORES `offset` (verified by
// observation 2026-05-21 — pages with offset=0, 3, 100 all returned the
// identical set). Pagination is CURSOR-based: response carries
// `cursors.next` which the caller must echo back as `cursor` in the next
// request body. Use `nextCursor === null` to detect end-of-data.
//
// `run_type` filter is INTENTIONALLY OMITTED (was `chain` before 2026-05-29).
// LangSmith run-types in this project:
//   - `chain`: agent_turn (ai-agent) AND kafka:start_transaction /
//     kafka:stop_transaction / kafka:meter_values (api-server Kafka roots).
//   - `tool`:  whatsapp_template:* runs (start_session_v2, milestone_*,
//     session_complete, invoice_receipt) and freeform_text / freeform_document.
// Filtering to `chain` only hid every WhatsApp template from the UI even
// though the trace was being captured correctly on the server.
//
// `is_root: true` is also intentionally KEPT — but supplemented by a
// second query for whatsapp_template:* child runs (see fetchTemplateChildren
// below). The template runs are CHILDREN of the kafka:* roots
// (`parent_run_id` set), so a single is_root:true query misses them.
// Dropping is_root:true would flood the result with LLM/tool sub-runs from
// the ai-agent's agent_turn (which we don't want to render). The two-query
// shape is the cheapest path to "show roots AND template leaves, nothing
// else" without scanning every nested run.
//
// Returns: { runs, nextCursor } so the caller can chain.
export async function getRuns({ limit = PAGE_SIZE, cursor = null } = {}) {
  const body = {
    session: [LANGSMITH_SESSION_ID],
    is_root: true,
    limit,
  };
  if (cursor) body.cursor = cursor;

  const response = await fetch(
    "https://api.smith.langchain.com/api/v1/runs/query",
    {
      method: "POST",
      headers: {
        "X-API-Key": LANGSMITH_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
  if (!response.ok) {
    const retryAfterMs =
      response.status === 429
        ? parseRetryAfterMs(response.headers.get("Retry-After"))
        : null;
    throw new LangSmithError(response.status, retryAfterMs);
  }
  const data = await response.json();
  const roots = data.runs || [];

  // Second query — pull the whatsapp_template:* child runs that sit under
  // kafka:* roots in this page. These carry `parent_run_id` (so they're
  // excluded by the is_root:true filter above) but ALSO carry their own
  // `conversation_id` via `traceWhatsAppSend`, so `groupRunsByPhone`
  // resolves them to a contact independently of whether the Kafka parent
  // has been enriched yet (api-server PR #165).
  //
  // Bounded by the time window of the current page (oldest root → newest
  // root) so we don't pull every template since the dawn of time.
  let templates = [];
  if (roots.length > 0) {
    try {
      templates = await fetchTemplateChildren(roots);
    } catch (err) {
      // Non-fatal — if this second call 429s or fails, we still render the
      // roots we already have. Templates just won't appear on this page;
      // user can refresh.
      // eslint-disable-next-line no-console
      console.warn("template-children fetch failed, continuing:", err.message);
    }
  }

  return {
    runs: [...roots, ...templates],
    nextCursor: data.cursors?.next ?? null,
  };
}

// Fetch `whatsapp_template:*` runs that fired within the same time window
// as the given roots. Names are enumerated explicitly (LangSmith filter
// supports `eq(name, ...)`; no LIKE/prefix operator) — when a new template
// ships, add its name to TEMPLATE_NAMES below.
const TEMPLATE_NAMES = [
  "whatsapp_template:start_session",
  "whatsapp_template:start_session_v2",
  "whatsapp_template:charging_milestone_20",
  "whatsapp_template:charging_milestone_50",
  "whatsapp_template:charging_milestone_80",
  "whatsapp_template:session_complete",
  "whatsapp_template:invoice_receipt",
  // Freeform sends also carry messageBody (since api-server PR #161) — pull
  // them too so SoC milestones from MeterValuesConsumer and any other
  // freeform-path send render as bot bubbles instead of being invisible.
  "whatsapp_template:freeform_text",
  "whatsapp_template:freeform_document",
];

async function fetchTemplateChildren(roots) {
  // Anchor the time window on the page's roots so we don't pull more than
  // we'll ever render. Pad ±5 minutes so a template that fired just before
  // or after the boundary still gets caught.
  const times = roots.map((r) => new Date(r.start_time).getTime()).filter(Number.isFinite);
  if (times.length === 0) return [];
  const PAD_MS = 5 * 60 * 1000;
  const startIso = new Date(Math.min(...times) - PAD_MS).toISOString();
  const endIso = new Date(Math.max(...times) + PAD_MS).toISOString();

  const orClauses = TEMPLATE_NAMES.map((n) => `eq(name, "${n}")`).join(", ");
  const filter = `or(${orClauses})`;

  const response = await fetch(
    "https://api.smith.langchain.com/api/v1/runs/query",
    {
      method: "POST",
      headers: {
        "X-API-Key": LANGSMITH_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: [LANGSMITH_SESSION_ID],
        start_time: startIso,
        end_time: endIso,
        filter,
        // Pull comfortably more than PAGE_SIZE roots' worth of templates —
        // a session can fire up to 5 templates (start + 3 milestones +
        // complete) so 5× the page size is a safe ceiling.
        limit: PAGE_SIZE * 5,
      }),
    }
  );
  if (!response.ok) {
    const retryAfterMs =
      response.status === 429
        ? parseRetryAfterMs(response.headers.get("Retry-After"))
        : null;
    throw new LangSmithError(response.status, retryAfterMs);
  }
  const data = await response.json();
  return data.runs || [];
}

// Extract phone number from session_id like "whatsapp:918000363019"
export function extractPhone(sessionId) {
  if (!sessionId) return null;
  const match = sessionId.match(/whatsapp:(\d+)/);
  return match ? match[1] : sessionId;
}

// Group runs by phone number (deduplicated), sorted by latest message
export function groupRunsByPhone(runs) {
  const phoneMap = new Map();

  for (const run of runs) {
    const rawSession =
      run.extra?.metadata?.session_id ||
      run.thread_id ||
      run.extra?.metadata?.conversation_id;
    const phone = extractPhone(rawSession) || rawSession;
    if (!phone) continue;

    const userName =
      run.outputs?.response?.data?.verifiedUser?.name ||
      run.outputs?.response?.data?.verifiedUser?.phone ||
      null;

    if (!phoneMap.has(phone)) {
      phoneMap.set(phone, {
        phone,
        userName,
        runs: [],
        lastMessage: null,
        lastTime: null,
      });
    }

    const entry = phoneMap.get(phone);
    if (!entry.userName && userName) entry.userName = userName;
    entry.runs.push(run);

    const runTime = new Date(run.start_time);
    if (!entry.lastTime || runTime > entry.lastTime) {
      entry.lastTime = runTime;
      // Sidebar-preview fallback chain (in order of usefulness):
      //   1. agent_turn      → bot reply text
      //   2. agent_turn      → user typed text
      //   3. whatsapp_template:* → rendered messageBody (the literal text
      //      the user received, captured on the trace since PR #161).
      //
      // kafka:* runs are intentionally NOT considered here — they carry no
      // user-visible body. When a contact's most recent activity is a
      // kafka:start_transaction, the sidebar will instead pick up the
      // accompanying whatsapp_template:start_session_v2 (fired ~1s later
      // in the same session) since the second query pulls both.
      const md = run.extra?.metadata || {};
      entry.lastMessage =
        run.outputs?.response?.content ||
        run.inputs?.message ||
        md.message_body ||
        "";
    }
  }

  // Sort each contact's runs oldest→newest, then contacts by latest first
  const contacts = Array.from(phoneMap.values()).map((c) => ({
    ...c,
    runs: c.runs.sort((a, b) => new Date(a.start_time) - new Date(b.start_time)),
  }));

  return contacts.sort((a, b) => b.lastTime - a.lastTime);
}

// Build flat message list from a contact's runs.
//
// Three run shapes are recognised (2026-05-29):
//   1. `agent_turn` runs (ai-agent) — produce a user bubble + bot bubble pair.
//   2. `kafka:*` runs (api-server) — Kafka OCPP events
//      (start_transaction / stop_transaction / meter_values). Rendered as
//      a SYSTEM event pill inline with the conversation so the chronological
//      trace shows "user sent X" → "charger fired StartTransaction" →
//      "bot replied Y". Only appear under the right contact when the
//      api-server has back-written `session_id` via
//      `LangsmithService.enrichActiveRunWithUser` (PR coordinated with
//      api-server feat/CAI-API-langsmith-kafka-user-enrichment).
//   3. `whatsapp_template:*` runs (api-server) — outbound Meta template
//      sends (start_session_v2, milestone_*, session_complete,
//      invoice_receipt). Rendered as a SYSTEM event pill carrying the
//      pre-rendered messageBody (the actual text the user received) +
//      the template name.
//
// Anything else (freeform_text, freeform_document) gets rendered as a
// generic system event so it's visible even if we add a new run-type
// upstream without updating this file.
export function buildMessages(runs) {
  const messages = [];
  for (const run of runs) {
    const name = run.name || "";
    const time = run.start_time;
    const endTime = run.end_time;
    const status = run.status;

    if (name === "agent_turn") {
      // Original ai-agent shape: inputs.message → user bubble,
      // outputs.response.content → bot bubble.
      const userText = run.inputs?.message;
      const botText = run.outputs?.response?.content;
      const buttons = run.outputs?.response?.buttons;
      if (userText) {
        messages.push({
          id: `${run.id}-user`,
          type: "user",
          text: userText,
          time,
          status,
          runId: run.id,
          pairBotResponse: botText || "",
        });
      }
      if (botText) {
        messages.push({
          id: `${run.id}-bot`,
          type: "bot",
          text: botText,
          buttons: buttons || [],
          time: endTime || time,
          processingTimeMs: run.outputs?.processingTimeMs,
          agentType: run.outputs?.agentType,
          status,
          runId: run.id,
          pairUserMessage: userText || "",
        });
      }
      continue;
    }

    if (name.startsWith("kafka:")) {
      // Kafka OCPP events (start_transaction / stop_transaction /
      // meter_values) carry no user-facing body — their job is to TRIGGER
      // a whatsapp_template:* child run, which DOES carry the rendered
      // message. We intentionally drop kafka:* from the chat timeline so
      // the user sees the actual message the customer received (the
      // template's `message_body`) rather than an abstract "Charger event"
      // pill. The Kafka root is still visible in LangSmith's run-tree
      // view for diagnostic purposes.
      continue;
    }

    if (name.startsWith("whatsapp_template:")) {
      // Outbound Meta template send from the api-server. Renders as a
      // regular bot bubble (left, white) — the captured `message_body`
      // (since api-server PR #161) is the literal text the customer
      // received in WhatsApp.
      //
      // Distinguished from agent_turn bot replies by `templateName` —
      // the bubble renders a small badge so a reviewer can tell whether
      // a turn came from the LLM agent or a system-fired template.
      //
      // Falls back to the rendered body-variables joined with " · "
      // when message_body is absent (older runs from before PR #161).
      const md = run.extra?.metadata || {};
      const templateName = md.template_name || name.replace(/^whatsapp_template:/, "");
      const body =
        md.message_body ||
        run.inputs?.messageBody ||
        (Array.isArray(run.inputs?.bodyInputs?.bodyVariables)
          ? run.inputs.bodyInputs.bodyVariables.join(" · ")
          : "");
      if (!body) {
        // Nothing renderable — skip rather than show a "Template sent: x"
        // empty card. A future template might land here if the api-server
        // forgets to pass `messageBody`; the badge would surface this.
        continue;
      }
      messages.push({
        id: `${run.id}-template`,
        type: "bot",
        text: body,
        buttons: [],
        time,
        runId: run.id,
        status,
        // Surface the template name as the bubble's agent-type badge —
        // same slot agent_turn uses for "discovery" / "session" / etc.
        // A template name like "start_session_v2" reads naturally there.
        agentType: templateName,
        // Mark for the bubble to render an additional "template" badge
        // (distinguishes a system-fired template from an LLM agent reply).
        isTemplate: true,
      });
      continue;
    }

    // Unknown / fallback (future trace types): skip silently. We avoid the
    // "Trace: <name>" pill from the previous iteration — it was visually
    // noisy when present and provided no actionable content for the user
    // viewing the conversation. Diagnostic visibility for unknown traces
    // lives in LangSmith's native UI.
  }
  return messages;
}
