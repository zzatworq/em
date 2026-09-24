import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";

const METER_SYSTEM_PROMPT = `You inspect utility meter photographs. Respond with ONLY compact JSON, with no markdown fences or commentary:
{"meterDetected":true|false,"displayDetected":true|false,"digits":"digits only or null","label":"visible meter brand/model or null","identity":"visible serial/model/label text useful for distinguishing this physical meter, or null","matchedMeter":"m1|m2|null","confidence":"high|medium|low","rotation":0,"crop":{"x":0,"y":0,"width":0,"height":0}|null}
Image coordinates are percentages (0-100) of the full image.
crop must tightly cover the COMPLETE numeric reading display, including every reading digit and decimal area, with a small margin. Do not crop to individual digits. Do not guess a crop if the display cannot be located.
rotation is the clockwise angle in degrees needed to make the display upright after cropping; normally between -45 and 45. Use 0 when the display is already upright or the angle is uncertain.
Read every visible digit exactly. The final two digits are decimal digits.
identity should contain any visible serial number, meter number, model number, or distinctive printed label that can distinguish this physical meter from another meter.`;

export type MeterReadingResult = {
  meterDetected: boolean;
  displayDetected: boolean;
  digits: string | null;
  label: string | null;
  identity: string | null;
  matchedMeter: "m1" | "m2" | null;
  confidence: "high" | "medium" | "low";
  value: number | null;
  rotation: number;
  crop: { x: number; y: number; width: number; height: number } | null;
};

function extractJson(text: string): unknown {
  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    try { return match ? JSON.parse(match[0]) : null; } catch { return null; }
  }
}

function toDecimalValue(digits: string | null): number | null {
  if (!digits || !/^\d+$/.test(digits)) return null;
  if (digits.length <= 2) return Number(`0.${digits.padStart(2, "0")}`);
  return Number(`${digits.slice(0, -2)}.${digits.slice(-2)}`);
}

function normalizeVisionText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value.map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) return String((part as { text?: unknown }).text ?? "");
      return "";
    }).join("").trim();
  }
  return "";
}

async function runCloudflareVision(imageBase64: string, mimeType: string, prompt: string): Promise<string> {
  const ai = (env as unknown as { AI?: { run: (model: string, input: unknown) => Promise<unknown> } }).AI;
  if (!ai) throw new Error("Cloudflare Workers AI is not configured. Deploy the Worker with the AI binding first.");

  const result = await ai.run("@cf/google/gemma-4-26b-a4b-it", {
    messages: [{
      role: "system",
      content: METER_SYSTEM_PROMPT,
    }, {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}`, detail: "auto" } },
        { type: "text", text: prompt },
      ],
    }],
    max_completion_tokens: 512,
    chat_template_kwargs: { enable_thinking: false },
  });

  if (typeof result === "string") return result;
  if (result && typeof result === "object" && "choices" in result) {
    const choices = (result as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
    return normalizeVisionText(choices?.[0]?.message?.content);
  }
  return "";
}

async function runGeminiVision(imageBase64: string, mimeType: string, prompt: string): Promise<string> {
  const apiKey = env.GEMINI_ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Gemini meter scanning is not configured: GEMINI_ANTHROPIC_API_KEY is missing from the Worker secrets.");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: METER_SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType, data: imageBase64 } }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      }),
    },
  );

  const raw = await res.text();
  if (!res.ok) {
    let detail = raw.slice(0, 300);
    try { detail = (JSON.parse(raw) as { error?: { message?: string } }).error?.message ?? detail; } catch {}
    throw new Error(`Gemini meter scan failed (${res.status}): ${detail}`);
  }

  let response: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  try { response = JSON.parse(raw); } catch { throw new Error("Gemini returned an invalid API response."); }
  return (response.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("").trim();
}

export const extractMeterReading = createServerFn({ method: "POST" })
  .validator((data: {
    imageBase64: string;
    mimeType?: string;
    provider?: "gemini" | "cloudflare";
    knownIdentities?: Array<{ meter: "m1" | "m2"; identity: string }>;
    knownReferences?: Array<{ meter: "m1" | "m2"; imageBase64: string }>;
  }) => data)
  .handler(async ({ data }): Promise<MeterReadingResult> => {
    const provider = data.provider === "cloudflare" ? "cloudflare" : "gemini";
    const mimeType = data.mimeType === "image/png" ? "image/png" : "image/jpeg";
    const prompt = `The first image is the current meter photo. Detect the physical meter and its numeric display. Locate the display, estimate the correction rotation, and read every digit. If known meter identities are supplied, compare visible serial/meter/model text against them. Known identities: ${(data.knownIdentities ?? []).map((x) => `${x.meter}: ${x.identity}`).join(" | ") || "none"}`;

    const text = provider === "cloudflare"
      ? await runCloudflareVision(data.imageBase64, mimeType, prompt)
      : await runGeminiVision(data.imageBase64, mimeType, prompt);

    const result = extractJson(text) as Partial<MeterReadingResult> | null;
    if (!result) throw new Error(`${provider === "cloudflare" ? "Cloudflare AI" : "Gemini"} could not return a readable meter result.`);

    const digits = typeof result.digits === "string" && /^\d+$/.test(result.digits) ? result.digits : null;
    const rawCrop = result.crop;
    const crop = rawCrop && [rawCrop.x, rawCrop.y, rawCrop.width, rawCrop.height].every((n) => typeof n === "number")
      ? { x: Math.max(0, Math.min(100, rawCrop.x)), y: Math.max(0, Math.min(100, rawCrop.y)), width: Math.max(0, Math.min(100, rawCrop.width)), height: Math.max(0, Math.min(100, rawCrop.height)) }
      : null;
    const rotation = typeof result.rotation === "number" && Number.isFinite(result.rotation) ? Math.max(-45, Math.min(45, result.rotation)) : 0;

    return {
      meterDetected: result.meterDetected === true,
      displayDetected: result.displayDetected === true,
      digits,
      label: typeof result.label === "string" ? result.label : null,
      identity: typeof result.identity === "string" ? result.identity : null,
      matchedMeter: result.matchedMeter === "m1" || result.matchedMeter === "m2" ? result.matchedMeter : null,
      confidence: result.confidence === "high" || result.confidence === "low" ? result.confidence : "medium",
      value: toDecimalValue(digits),
      rotation,
      crop,
    };
  });
