import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

// --- Truncation limits (characters) ---
const LIMITS = {
  subject: 300,
  senderName: 200,
  senderEmail: 320,
  latestMessage: 12000,
  threadMessage: 8000,
  threadMaxCount: 10,
  identity: 500,
  replyStyle: 100,
  knowledge: 4000,
  signature: 1000,
  extraInstructions: 2000,
  sourceUrl: 2000,
};

const ANTHROPIC_TIMEOUT_MS = 30_000;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v.trim() : fallback;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function cleanDraft(raw: string): string {
  let text = raw.trim();
  // Remove markdown code fences
  text = text.replace(/^```[\s\S]*?\n([\s\S]*?)```$/gm, "$1").trim();
  if (text.startsWith("```") && text.endsWith("```")) {
    text = text.slice(3, -3).trim();
  }
  // Remove leading "Subject: ..." line
  text = text.replace(/^Subject:\s*[^\n]*\n*/i, "").trim();
  // Collapse runs of 3+ newlines
  text = text.replace(/\n{3,}/g, "\n\n");
  return text;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const startTime = Date.now();

  // --- Parse body ---
  let body: Record<string, unknown>;
  try {
    const raw = await req.json();
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return jsonResponse({ error: "Invalid JSON body." }, 400);
    }
    body = raw as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  // --- Extract & normalize ---
  const subject = truncate(str(body.subject, "(No subject)"), LIMITS.subject);
  const senderName = truncate(str(body.senderName), LIMITS.senderName);
  const senderEmail = truncate(str(body.senderEmail), LIMITS.senderEmail);
  const latestMessage = truncate(str(body.latestMessage), LIMITS.latestMessage);
  const sourceUrl = truncate(str(body.sourceUrl), LIMITS.sourceUrl);
  const identity = truncate(str(body.identity), LIMITS.identity);
  const replyStyle = truncate(str(body.replyStyle, "professional"), LIMITS.replyStyle);
  const knowledge = truncate(str(body.knowledge), LIMITS.knowledge);
  const signature = truncate(str(body.signature), LIMITS.signature);
  const extraInstructions = truncate(str(body.extraInstructions), LIMITS.extraInstructions);

  const threadMessages: string[] = (
    Array.isArray(body.threadMessages)
      ? body.threadMessages
          .filter((m: unknown) => typeof m === "string")
          .map((m: string) => m.trim())
          .filter(Boolean)
          .slice(0, LIMITS.threadMaxCount)
          .map((m: string) => truncate(m, LIMITS.threadMessage))
      : []
  );

  // --- Must have content ---
  if (!latestMessage && threadMessages.length === 0) {
    console.log("Rejected: no content provided");
    return jsonResponse({ error: "Not enough content: provide \"latestMessage\" or at least one non-empty entry in \"threadMessages\"." }, 400);
  }

  // --- Build prompt ---
  const threadContext =
    threadMessages.length > 0
      ? `\n\nPrevious messages in the thread (oldest first):\n${threadMessages.map((m, i) => `--- Message ${i + 1} ---\n${m}`).join("\n\n")}`
      : "";

  const fromLine = senderName && senderEmail
    ? `From: ${senderName} <${senderEmail}>`
    : senderName ? `From: ${senderName}` : senderEmail ? `From: ${senderEmail}` : "";

  const identityBlock = identity ? `\nYou are replying as: ${identity}` : "";
  const knowledgeBlock = knowledge ? `\nRelevant background knowledge:\n${knowledge}` : "";
  const styleBlock = `\nReply style: ${replyStyle}`;
  const extraBlock = extraInstructions ? `\nAdditional instructions: ${extraInstructions}` : "";
  const signatureBlock = signature ? `\nAppend this signature at the end of the reply, separated by a blank line:\n${signature}` : "";

  const systemPrompt = `You are a professional email assistant. Your job is to draft a reply to an email.

Rules:
- Return ONLY the email body text. No subject line, no greeting prefix like "Subject:", no markdown, no code fences, no disclaimers.
- Preserve all facts from the original email. Do not invent commitments or promises the sender did not make.
- Be concise, clear, and natural.
- Match the tone indicated by the reply style.
- If a signature is provided, append it naturally at the end after a blank line.${identityBlock}${styleBlock}${knowledgeBlock}${extraBlock}${signatureBlock}`;

  const userPrompt = `Email subject: ${subject}
${fromLine ? fromLine + "\n" : ""}${sourceUrl ? `Source: ${sourceUrl}\n` : ""}${threadContext}
${latestMessage ? `\nLatest message to reply to:\n${latestMessage}` : "\nDraft a reply based on the thread messages above."}

Draft a reply now.`;

  // --- Call Anthropic ---
  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!ANTHROPIC_API_KEY) {
    console.error("Missing ANTHROPIC_API_KEY secret");
    return jsonResponse({ error: "Server configuration error." }, 500);
  }

  const model = "claude-sonnet-4-20250514";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT_MS);

  try {
    console.log(`Request: subject_len=${subject.length} latest_len=${latestMessage.length} thread_count=${threadMessages.length} style="${replyStyle}"`);

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!anthropicRes.ok) {
      const status = anthropicRes.status;
      const errSnippet = (await anthropicRes.text()).slice(0, 200);
      console.error(`Anthropic error status=${status} snippet=${errSnippet}`);

      if (status === 429) return jsonResponse({ error: "Rate limited. Try again shortly." }, 429);
      if (status === 401) return jsonResponse({ error: "Server configuration error." }, 500);
      if (status >= 500) return jsonResponse({ error: "AI service temporarily unavailable." }, 502);
      return jsonResponse({ error: "AI generation failed." }, 502);
    }

    const anthropicData = await anthropicRes.json();
    const rawDraft = anthropicData.content?.[0]?.text ?? "";
    const draft = cleanDraft(rawDraft);

    if (!draft) {
      console.error(`Empty draft after cleanup, raw_len=${rawDraft.length} stop_reason=${anthropicData.stop_reason ?? "unknown"}`);
      return jsonResponse({ error: "AI returned an empty response." }, 502);
    }

    const elapsed = Date.now() - startTime;
    console.log(`OK ${elapsed}ms draft_len=${draft.length}`);

    return jsonResponse({ draft, model });
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof DOMException && err.name === "AbortError") {
      console.error(`Anthropic timeout after ${ANTHROPIC_TIMEOUT_MS}ms`);
      return jsonResponse({ error: "AI request timed out. Try again." }, 504);
    }
    console.error("Anthropic request failed:", (err as Error).message);
    return jsonResponse({ error: "Failed to reach AI service." }, 502);
  }
});
