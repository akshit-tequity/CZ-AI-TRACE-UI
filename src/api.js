const LANGSMITH_API_KEY = import.meta.env.VITE_LANGSMITH_API_KEY;
const LANGSMITH_SESSION_ID = import.meta.env.VITE_LANGSMITH_SESSION_ID;

export async function getRuns(limit = 100, offset = 0) {
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
        is_root: true,
        run_type: "chain",
        limit,
        offset,
      }),
    }
  );
  if (!response.ok) throw new Error(`LangSmith API error: ${response.status}`);
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
      entry.lastMessage =
        run.outputs?.response?.content || run.inputs?.message || "";
    }
  }

  // Sort each contact's runs oldest→newest, then contacts by latest first
  const contacts = Array.from(phoneMap.values()).map((c) => ({
    ...c,
    runs: c.runs.sort((a, b) => new Date(a.start_time) - new Date(b.start_time)),
  }));

  return contacts.sort((a, b) => b.lastTime - a.lastTime);
}

// Build flat message list from a contact's runs
export function buildMessages(runs) {
  const messages = [];
  for (const run of runs) {
    const userText = run.inputs?.message;
    const botText = run.outputs?.response?.content;
    const buttons = run.outputs?.response?.buttons;
    const time = run.start_time;
    const endTime = run.end_time;
    const status = run.status;

    if (userText) {
      messages.push({ id: `${run.id}-user`, type: "user", text: userText, time, status });
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
      });
    }
  }
  return messages;
}
