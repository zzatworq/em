import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";

const METER_SYSTEM_PROMPT = `You inspect utility meter photographs. Respond with ONLY compact JSON, with no markdown fences or commentary:
{"meterDetected":true|false,"displayDetected":true|false,"digits":"digits only or null","label":"visible meter brand/model or null","confidence":"high|medium|low","crop":{"x":0,"y":0,"width":0,"height":0}|null}
Image coordinates are percentages (0-100) of the full image. crop must tightly cover the numeric reading display. If you cannot locate the display, crop is null. Read every visible digit exactly. The final two digits are decimal digits.`;

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
  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    try {
      return match ? JSON.parse(match[0]) : null;
    } catch {
      return null;
    }
  }
}

function toDecimalValue(digits: string | null): number | null {
  if (!digits || !/^\d+$/.test(digits)) return null;
  if (digits.length <= 2) return Number(`0.${digits.padStart(2, "0")}`);
  return Number(`${digits.slice(0, -2)}.${digits.slice(-2)}`);
}

export const extractMeterReading = createServerFn({ method: "POST" })
  .validator((data: { imageBase64: string; mimeType?: string }) => data)
  .handler(async ({ data }): Promise<MeterReadingResult> => {
    const apiKey = env.GEMINI_ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("Meter scanning is not configured: GEMINI_ANTHROPIC_API_KEY is missing from the Worker secrets.");
    }

    const mimeType = data.mimeType === "image/png" ? "image/png" : "image/jpeg";
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: METER_SYSTEM_PROMPT }],
          },
          contents: [{
            role: "user",
            parts: [
              { text: "Detect the meter, locate its numeric reading display, and read all digits." },
              { inlineData: { mimeType, data: data.imageBase64 } },
            ],
          }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0,
          },
        }),
      },
    );

    const raw = await res.text();
    if (!res.ok) {
      let detail = raw.slice(0, 300);
      try {
        const body = JSON.parse(raw) as { error?: { message?: string } };
        detail = body.error?.message ?? detail;
      } catch {
        // Keep the raw response excerpt.
      }
      throw new Error(`Gemini meter scan failed (${res.status}): ${detail}`);
    }

    let response: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    try {
      response = JSON.parse(raw);
    } catch {
      throw new Error("Gemini returned an invalid API response.");
    }

    const text = (response.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("")
      .trim();
    const result = extractJson(text) as Partial<MeterReadingResult> | null;
    if (!result) throw new Error("Gemini could not return a readable meter result.");

    const digits = typeof result.digits === "string" && /^\d+$/.test(result.digits)
      ? result.digits
      : null;

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
