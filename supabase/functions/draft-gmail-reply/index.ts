import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v.trim() : fallback;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const startTime = Date.now();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  // --- Tolerant extraction with safe defaults ---
  const subject = str(body.subject, "(No subject)");
  const senderName = str(body.senderName);
  const senderEmail = str(body.senderEmail);
  const latestMessage = str(body.latestMessage);
  const sourceUrl = str(body.sourceUrl);
  const identity = str(body.identity);
  const replyStyle = str(body.replyStyle, "professional");
  const knowledge = str(body.knowledge);
  const signature = str(body.signature);
  const extraInstructions = str(body.extraInstructions);

  // threadMessages: accept array of strings, silently drop non-strings
  const threadMessages: string[] = Array.isArray(body.threadMessages)
    ? body.threadMessages.filter((m: unknown) => typeof m === "string").map((m: string) => m.trim()).filter(Boolean)
    : [];

  // --- Must have SOME content to draft from ---
  if (!latestMessage && threadMessages.length === 0) {
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
    console.error("ANTHROPIC_API_KEY is not configured");
    return jsonResponse({ error: "Server configuration error." }, 500);
  }

  const model = "claude-sonnet-4-20250514";

  try {
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
    });

    if (!anthropicRes.ok) {
      const errBody = await anthropicRes.text();
      console.error(`Anthropic API error status=${anthropicRes.status} body=${errBody}`);

      if (anthropicRes.status === 429) {
        return jsonResponse({ error: "Rate limited. Try again shortly." }, 429);
      }
      return jsonResponse({ error: "AI generation failed." }, 502);
    }

    const anthropicData = await anthropicRes.json();
    const draft = anthropicData.content?.[0]?.text ?? "";

    if (!draft) {
      console.error("Anthropic returned empty content", JSON.stringify(anthropicData));
      return jsonResponse({ error: "AI returned an empty response." }, 502);
    }

    const elapsed = Date.now() - startTime;
    console.log(`OK ${elapsed}ms subject="${subject}" sender="${senderEmail}" chars=${draft.length}`);

    return jsonResponse({ draft, model });
  } catch (err) {
    console.error("Anthropic request failed:", err);
    return jsonResponse({ error: "Failed to reach AI service." }, 502);
  }
});
