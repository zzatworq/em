import { createServerFn } from "@tanstack/react-start";

const METER_SYSTEM_PROMPT = `You inspect utility meter photographs. Return ONLY compact JSON:
{"meterDetected":true|false,"displayDetected":true|false,"digits":"digits only or null","label":"visible meter brand/model or null","confidence":"high|medium|low","crop":{"x":0,"y":0,"width":0,"height":0}|null}
Image coordinates are percentages (0-100) of the full image. crop must tightly cover the numeric reading display. If you cannot locate the display, crop is null. This meter's final two digits are decimal digits.`;

export type MeterReadingResult = {
  meterDetected: boolean;
  displayDetected: boolean;
  digits: string | null;
  label: string | null;
  confidence: "high" | "medium" | "low";
  value: number | null;
  crop: { x: number; y: number; width: number; height: number } | null;
};

function extractJson(text: string): unknown {
  const cleaned = text.replace(/\`\`\`json|\`\`\`/g, "").trim();
  try { return JSON.parse(cleaned); } catch { /* continue */ }
  const match = cleaned.match(/\{[\s\S]*\}/);
  try { return match ? JSON.parse(match[0]) : null; } catch { return null; }
}

function toDecimalValue(digits: string | null): number | null {
  if (!digits || !/^\d+$/.test(digits)) return null;
  if (digits.length <= 2) return Number(`0.${digits.padStart(2, "0")}`);
  return Number(`${digits.slice(0, -2)}.${digits.slice(-2)}`);
}

export const extractMeterReading = createServerFn({ method: "POST" })
  .validator((data: { imageBase64: string }) => data)
  .handler(async ({ data }): Promise<MeterReadingResult> => {
    const { env } = await import("@/lib/env.server");
    const apiKey = env("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("Meter scanning is not configured: ANTHROPIC_API_KEY is missing from the server.");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 350,
        system: METER_SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: data.imageBase64 } },
            { type: "text", text: "Detect the meter, locate its numeric reading display, and read all digits." },
          ],
        }],
      }),
    });

    const raw = await res.text();
    if (!res.ok) {
      let detail = raw.slice(0, 300);
      try {
        const body = JSON.parse(raw) as { error?: { message?: string } };
        detail = body.error?.message ?? detail;
      } catch { /* keep raw detail */ }
      throw new Error(`Meter scan service failed (${res.status}): ${detail}`);
    }

    const response = JSON.parse(raw) as { content?: Array<{ text?: string }> };
    const text = (response.content ?? []).map((b) => b.text ?? "").join("").trim();
    const result = extractJson(text) as Partial<MeterReadingResult> | null;
    if (!result) throw new Error("The scan service returned an unreadable response.");

    const digits = typeof result.digits === "string" && /^\d+$/.test(result.digits) ? result.digits : null;
    const rawCrop = result.crop;
    const crop = rawCrop && [rawCrop.x, rawCrop.y, rawCrop.width, rawCrop.height].every((n) => typeof n === "number")
      ? {
          x: Math.max(0, Math.min(100, rawCrop.x)),
          y: Math.max(0, Math.min(100, rawCrop.y)),
          width: Math.max(0, Math.min(100, rawCrop.width)),
          height: Math.max(0, Math.min(100, rawCrop.height)),
        }
      : null;

    return {
      meterDetected: result.meterDetected === true,
      displayDetected: result.displayDetected === true,
      digits,
      label: typeof result.label === "string" ? result.label : null,
      confidence: result.confidence === "high" || result.confidence === "low" ? result.confidence : "medium",
      value: toDecimalValue(digits),
      crop,
    };
  });
