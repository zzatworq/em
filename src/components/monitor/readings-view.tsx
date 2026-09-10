import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { units } from "@/lib/engine/time";
import {
  downloadBackup,
  downloadReadingsCsv,
  parseBackup,
  parseReadingsCsv,
} from "@/lib/backup";
import { extractMeterReading, type MeterReadingResult } from "@/lib/meter-vision";
import { useMonitor } from "@/store/monitor";

async function resizeToBase64(file: File, maxDim = 1200): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxDim) {
        height = Math.round(height * (maxDim / width));
        width = maxDim;
      } else if (height >= width && height > maxDim) {
        width = Math.round(width * (maxDim / height));
        height = maxDim;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.85).split(",")[1]);
    };
    img.onerror = () => reject(new Error("Could not decode the image"));
    img.src = dataUrl;
  });
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function nowParts() {
  const n = new Date();
  return {
    date: `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`,
    time: `${pad(n.getHours())}:${pad(n.getMinutes())}`,
  };
}

type MeterKey = "m1" | "m2";

type MeterSlotState = {
  value: string;
  thumb: string | null;
  status: "idle" | "scanning" | "done" | "error";
  result: MeterReadingResult | null;
  error: string;
  crop: string | null;
  confirmed: boolean;
};

function emptySlot(value: string): MeterSlotState {
  return { value, thumb: null, status: "idle", result: null, error: "", crop: null, confirmed: false };
}

function cropDisplay(base64: string, crop: MeterReadingResult["crop"]): Promise<string | null> {
  if (!crop) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const sx = img.width * crop.x / 100;
      const sy = img.height * crop.y / 100;
      const sw = img.width * crop.width / 100;
      const sh = img.height * crop.height / 100;
      if (sw < 2 || sh < 2) return resolve(null);
      canvas.width = sw; canvas.height = sh;
      canvas.getContext("2d")?.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      resolve(canvas.toDataURL("image/jpeg", 0.95).split(",")[1]);
    };
    img.onerror = () => resolve(null);
    img.src = `data:image/jpeg;base64,${base64}`;
  });
}

function MeterSlot({
  label, slot, onPhoto, onValueChange, onConfirm,
}: {
  label: string;
  slot: MeterSlotState;
  onPhoto: (file: File) => void;
  onValueChange: (value: string) => void;
  onConfirm: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">{label}</p>
        <Button type="button" variant="outline" size="sm" disabled={slot.status === "scanning"} onClick={() => fileRef.current?.click()}>
          {slot.status === "scanning" ? "Scanning…" : slot.thumb ? "Retake" : "Capture"}
        </Button>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => { const file = e.target.files?.[0]; if (file) onPhoto(file); e.target.value = ""; }} />
      </div>

      {slot.thumb && <img src={`data:image/jpeg;base64,${slot.thumb}`} alt="Captured meter" className="mt-3 h-40 w-full rounded-lg object-cover" />}

      {slot.status === "scanning" && <div className="mt-3 rounded-lg bg-background p-3 text-sm">
        <p>⏳ Meter detection in progress…</p>
        <p className="mt-1 text-muted">Locating the reading display and digits.</p>
      </div>}

      {slot.status === "done" && slot.result && <div className="mt-3 space-y-2 rounded-lg bg-background p-3 text-sm">
        <p>{slot.result.meterDetected ? "✓ Meter detected" : "✕ Meter not detected"}</p>
        <p>{slot.result.displayDetected ? "✓ Reading display detected" : "✕ Reading display not detected"}</p>
        {slot.crop && <div><p className="mb-1 text-xs text-muted">Detected reading area</p><img src={`data:image/jpeg;base64,${slot.crop}`} alt="Detected reading area" className="h-20 max-w-full rounded border border-border object-contain" /></div>}
        <p>Reading detected: <strong>{slot.result.value ?? "Unreadable"} kWh</strong></p>
        <p className="text-xs text-muted">Confidence: {slot.result.confidence}. Check or edit the value before confirming.</p>
      </div>}

      {slot.status === "error" && <div className="mt-3 rounded-lg border border-danger/30 p-3 text-sm text-danger">
        <p className="font-medium">Scan failed</p><p className="mt-1">{slot.error}</p>
      </div>}

      <Input className="mt-3" type="number" step="0.01" placeholder={label} value={slot.value}
        onChange={(e) => onValueChange(e.target.value)} />

      {slot.status === "done" && !slot.confirmed && slot.result?.value != null && (
        <Button type="button" className="mt-3 w-full" onClick={onConfirm}>Confirm detected reading</Button>
      )}
      {slot.confirmed && <p className="mt-3 text-sm font-medium">✓ Reading confirmed</p>}
    </div>
  );
}
