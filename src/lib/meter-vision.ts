import { createServerFn } from "@tanstack/react-start";

const METER_SYSTEM_PROMPT = `You read digital/electromechanical utility meter displays from photos.
This meter's last TWO digits are decimal digits (e.g. a display showing
264435 means 2644.35 kWh). Respond with ONLY compact JSON, no markdown
fences, no commentary:
{"digits":"<all digits shown on the display, in order, no decimal point, no separators>","label":"<any visible brand/model/serial text near the display, or null>","confidence":"high|medium|low"}
If the display is unreadable, set digits to null and confidence to "low".`;

export type MeterReadingResult = {
  digits: string | null;
  label: string | null;
  confidence: "high" | "medium" | "low";
  value: number | null;
};

function extractJson(text: string): unknown {
  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // fall through
  }
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {
      // fall through
    }
  }
  return null;
}

/** Insert a decimal point before the last two digits — done in code, not
 * trusted to the model, since exact digit placement matters for billing. */
function toDecimalValue(digits: string | null): number | null {
  if (!digits || !/^\d+$/.test(digits)) return null;
  if (digits.length <= 2) return Number(`0.${digits.padStart(2, "0")}`);
  const whole = digits.slice(0, -2);
  const frac = digits.slice(-2);
  return Number(`${whole}.${frac}`);
}

export const extractMeterReading = createServerFn({ method: "POST" })
  .validator((data: { imageBase64: string }) => data)
  .handler(async ({ data }): Promise<MeterReadingResult> => {
    const { env } = await import("@/lib/env.server");
    const apiKey = env("ANTHROPIC_API_KEY");
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not configured on the server. Add it as a Cloudflare Worker secret.",
      );
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 300,
        system: METER_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: "image/jpeg", data: data.imageBase64 },
              },
              { type: "text", text: "Read the numeric value on this meter display." },
            ],
          },
        ],
      }),
    });

    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`Anthropic API error ${res.status}: ${raw.slice(0, 200)}`);
    }

    let parsedResponse: { content?: Array<{ text?: string }> };
    try {
      parsedResponse = JSON.parse(raw);
    } catch {
      throw new Error("Bad API response");
    }

    const text = (parsedResponse.content ?? []).map((b) => b.text ?? "").join("").trim();
    const result = extractJson(text) as
      | { digits?: string | null; label?: string | null; confidence?: string }
      | null;

    if (!result) {
      throw new Error("Could not parse a reading from the response");
    }

    const digits = result.digits ?? null;
    return {
      digits,
      label: result.label ?? null,
      confidence: (result.confidence as MeterReadingResult["confidence"]) ?? "medium",
      value: toDecimalValue(digits),
    };
  });
