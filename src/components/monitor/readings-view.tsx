import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { units } from "@/lib/engine/time";
import { extractMeterReading, type MeterReadingResult } from "@/lib/meter-vision";
import { useMonitor } from "@/store/monitor";

function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)); }

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = () => reject(new Error("Could not read the image file.")); reader.readAsDataURL(file);
  });
}

async function decodeOriented(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { /* browser fallback */ }
  }
  const dataUrl = await fileToDataUrl(file);
  return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("Could not decode the image.")); img.src = dataUrl; });
}

function bitmapSize(image: ImageBitmap | HTMLImageElement) {
  return { width: "naturalWidth" in image ? image.naturalWidth || image.width : image.width, height: "naturalHeight" in image ? image.naturalHeight || image.height : image.height };
}

async function normalizeImage(file: File, maxDim = 2200): Promise<string> {
  const image = await decodeOriented(file);
  const { width: sourceWidth, height: sourceHeight } = bitmapSize(image);
  const scale = Math.min(1, maxDim / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale)); const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Could not create the image canvas.");
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high"; ctx.drawImage(image, 0, 0, width, height);
  if ("close" in image) image.close();
  return canvas.toDataURL("image/jpeg", 0.9).split(",")[1];
}

async function cropAndRotateImage(base64: string, crop: MeterReadingResult["crop"], rotation: number): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error("Could not prepare the detected display crop.")); image.src = `data:image/jpeg;base64,${base64}`; });
  if (!crop) return base64;
  const x = clamp(crop.x, 0, 100) / 100, y = clamp(crop.y, 0, 100) / 100, w = clamp(crop.width, 1, 100) / 100, h = clamp(crop.height, 1, 100) / 100;
  const rawX = img.naturalWidth * x, rawY = img.naturalHeight * y, rawW = img.naturalWidth * w, rawH = img.naturalHeight * h;
  // Give AI coordinates a small safety margin so a tight crop cannot cut off digits.
  const padX = rawW * 0.08, padY = rawH * 0.18;
  const sx = Math.max(0, Math.floor(rawX - padX)), sy = Math.max(0, Math.floor(rawY - padY));
  const ex = Math.min(img.naturalWidth, Math.ceil(rawX + rawW + padX)), ey = Math.min(img.naturalHeight, Math.ceil(rawY + rawH + padY));
  const sw = Math.max(1, ex - sx), sh = Math.max(1, ey - sy);
  const radians = (rotation * Math.PI) / 180, sin = Math.abs(Math.sin(radians)), cos = Math.abs(Math.cos(radians));
  const outWidth = Math.max(1, Math.ceil(sw * cos + sh * sin)), outHeight = Math.max(1, Math.ceil(sw * sin + sh * cos));
  const canvas = document.createElement("canvas"); canvas.width = outWidth; canvas.height = outHeight;
  const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Could not create the crop canvas.");
  // Rotated canvas corners are transparent by default and become black in JPEG. Paint them first.
  ctx.fillStyle = "#f5f5f5"; ctx.fillRect(0, 0, outWidth, outHeight);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.translate(outWidth / 2, outHeight / 2); ctx.rotate(radians);
  ctx.drawImage(img, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh);
  return canvas.toDataURL("image/jpeg", 0.96).split(",")[1];
}

function pad(n: number) { return String(n).padStart(2, "0"); }
function nowParts() { const n = new Date(); return { date: `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`, time: `${pad(n.getHours())}:${pad(n.getMinutes())}` }; }
type MeterKey = "m1" | "m2";
type ScanState = { value: string; thumb: string | null; status: "idle" | "scanning" | "done" | "error"; result: MeterReadingResult | null; detectedMeter: MeterKey | null; needsChoice: boolean; error: string };
function emptyScan(value = ""): ScanState { return { value, thumb: null, status: "idle", result: null, detectedMeter: null, needsChoice: false, error: "" }; }

function latestMeterValue(readings: ReturnType<typeof useMonitor.getState>["readings"], meter: MeterKey) {
  const field = meter === "m1" ? "newInput" : "oldInput";
  return [...readings].sort((a, b) => b.datetime - a.datetime).find((r) => r[field] != null)?.[field] ?? null;
}

function inferMeter(readings: ReturnType<typeof useMonitor.getState>["readings"], value: number | null): MeterKey | null {
  if (value == null || !Number.isFinite(value)) return null;
  const p1 = latestMeterValue(readings, "m1"), p2 = latestMeterValue(readings, "m2");
  if (p1 == null && p2 == null) return null; if (p1 == null) return "m1"; if (p2 == null) return "m2";
  const d1 = value - p1, d2 = value - p2, eps = 0.05, plausible = (d: number) => d >= -eps && d <= 500;
  const a1 = plausible(d1), a2 = plausible(d2);
  if (a1 && !a2) return "m1"; if (a2 && !a1) return "m2"; if (!a1 && !a2) return null;
  const moved1 = d1 > eps, moved2 = d2 > eps; if (moved1 && !moved2) return "m1"; if (moved2 && !moved1) return "m2";
  if (Math.abs(d1) < eps && Math.abs(d2) >= eps) return "m1"; if (Math.abs(d2) < eps && Math.abs(d1) >= eps) return "m2";
  if (Math.abs(d1 - d2) > 0.5) return Math.abs(d1) < Math.abs(d2) ? "m1" : "m2";
  return null;
}

function ScanResult({ scan, onChoose }: { scan: ScanState; onChoose: (meter: MeterKey) => void }) {
  if (scan.status !== "done" || !scan.result) return null;
  const meterLabel = scan.detectedMeter === "m1" ? "Meter 1" : scan.detectedMeter === "m2" ? "Meter 2" : null;
  return <div className="mt-3 rounded-xl border border-border bg-background p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-medium">{meterLabel ? `${meterLabel} detected` : "Meter identity needs confirmation"}</p><p className="text-sm text-muted">Reading: <strong>{scan.result.value ?? "unreadable"}</strong> · {scan.result.confidence} confidence{scan.result.label ? ` · ${scan.result.label}` : ""}{scan.result.rotation ? ` · rotated ${scan.result.rotation.toFixed(1)}°` : ""}</p></div>{scan.needsChoice && <div className="flex gap-2"><Button type="button" size="sm" variant="outline" onClick={() => onChoose("m1")}>Meter 1</Button><Button type="button" size="sm" variant="outline" onClick={() => onChoose("m2")}>Meter 2</Button></div>}</div></div>;
}

function MeterScanner({ scan, onPhoto, onValueChange, onChoose }: { scan: ScanState; onPhoto: (file: File) => void; onValueChange: (value: string) => void; onChoose: (meter: MeterKey) => void }) {
  const fileRef = useRef<HTMLInputElement>(null); const meterLabel = scan.detectedMeter === "m1" ? "Meter 1" : scan.detectedMeter === "m2" ? "Meter 2" : "Meter";
  return <div className="rounded-xl border border-border p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium">Photograph meter</p><p className="text-sm text-muted">The app detects which physical meter the photo belongs to.</p></div><Button type="button" variant="outline" disabled={scan.status === "scanning"} onClick={() => fileRef.current?.click()}>{scan.status === "scanning" ? "Analyzing…" : scan.thumb ? "Retake photo" : "Photograph"}</Button><input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void onPhoto(file); e.target.value = ""; }} /></div>{scan.thumb && <img src={`data:image/jpeg;base64,${scan.thumb}`} alt="Detected meter display" className="mt-3 max-h-72 w-full rounded-lg object-contain bg-background" />}{scan.status === "done" && scan.result && <ScanResult scan={scan} onChoose={onChoose} />}{scan.status === "error" && <p className="mt-2 text-sm text-danger">{scan.error}</p>}<Input className="mt-3" type="number" step="0.01" placeholder={scan.detectedMeter ? meterLabel : "Meter reading"} value={scan.value} onChange={(e) => onValueChange(e.target.value)} /></div>;
}

function AddReadingModal({ onClose }: { onClose: () => void }) {
  const addReading = useMonitor((s) => s.addReading); const readings = useMonitor((s) => s.readings);
  const latest = useMemo(() => [...readings].sort((a, b) => b.datetime - a.datetime)[0], [readings]);
  const [date, setDate] = useState(nowParts().date), [time, setTime] = useState(nowParts().time), [load, setLoad] = useState("");
  const [scan, setScan] = useState<ScanState>(emptyScan()); const [m1, setM1] = useState(String(latest?.newInput ?? "")), [m2, setM2] = useState(String(latest?.oldInput ?? ""));

  async function handlePhoto(file: File) {
    setScan((prev) => ({ ...prev, status: "scanning", error: "" }));
    try {
      const base64 = await normalizeImage(file); const result = await extractMeterReading({ data: { imageBase64: base64, mimeType: "image/jpeg" } });
      const cropped = result.crop ? await cropAndRotateImage(base64, result.crop, result.rotation) : base64; const detectedMeter = inferMeter(readings, result.value); const needsChoice = result.value == null || detectedMeter == null;
      setScan({ value: result.value != null ? String(result.value) : "", thumb: cropped, status: "done", result, detectedMeter, needsChoice, error: "" });
      if (!needsChoice && result.value != null) { if (detectedMeter === "m1") setM1(String(result.value)); if (detectedMeter === "m2") setM2(String(result.value)); }
    } catch (err) { setScan((prev) => ({ ...prev, status: "error", error: err instanceof Error ? err.message : "Could not read the meter photo." })); }
  }
  function chooseMeter(meter: MeterKey) { setScan((prev) => ({ ...prev, detectedMeter: meter, needsChoice: false })); if (scan.result?.value != null) { if (meter === "m1") setM1(String(scan.result.value)); else setM2(String(scan.result.value)); } }
  const scanning = scan.status === "scanning";
  function handleSave() {
    if (!date || !time || (scan.status === "done" && scan.needsChoice)) return;
    const [y, mo, d] = date.split("-").map(Number), [h, mi] = time.split(":").map(Number); const dt = new Date(y, mo - 1, d, h, mi, 0, 0);
    addReading({ datetime: dt.getTime(), newInput: m1 === "" ? null : Number(m1), oldInput: m2 === "" ? null : Number(m2), loadKw: load === "" ? null : Number(load), notes: "" }); onClose();
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"><div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-elevated p-5 shadow-border sm:p-6"><div className="flex items-center justify-between"><h2 className="font-display text-2xl font-medium">Add reading</h2><Button variant="ghost" size="sm" onClick={onClose}>Close</Button></div><p className="mt-1 text-sm text-muted">Photograph either meter. The app normalizes camera rotation, crops the numeric display, and uses reading continuity to identify Meter 1 or Meter 2. If the identity is genuinely ambiguous, it asks once rather than writing to the wrong meter.</p><div className="mt-4"><MeterScanner scan={scan} onPhoto={handlePhoto} onValueChange={(v) => { setScan((prev) => ({ ...prev, value: v })); if (scan.detectedMeter === "m1") setM1(v); if (scan.detectedMeter === "m2") setM2(v); }} onChoose={chooseMeter} /></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-border p-3"><p className="mb-2 text-sm font-medium">Meter 1</p><Input type="number" step="0.01" value={m1} onChange={(e) => setM1(e.target.value)} /></div><div className="rounded-xl border border-border p-3"><p className="mb-2 text-sm font-medium">Meter 2</p><Input type="number" step="0.01" value={m2} onChange={(e) => setM2(e.target.value)} /></div></div><div className="mt-4 grid gap-3 sm:grid-cols-3"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" /><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" /><Input type="number" step="0.01" placeholder="Inverter kW" value={load} onChange={(e) => setLoad(e.target.value)} /></div><div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={handleSave} disabled={scanning || scan.needsChoice}>{scanning ? "Waiting for photo…" : scan.needsChoice ? "Choose meter first" : "Save reading"}</Button></div></div></div>;
}

export function ReadingsView() {
  const readings = useMonitor((s) => s.readings); const deleteReading = useMonitor((s) => s.deleteReading); const [modalOpen, setModalOpen] = useState(false);
  const sorted = useMemo(() => [...readings].sort((a, b) => b.datetime - a.datetime), [readings]);
  return <section className="space-y-5"><div className="rounded-2xl bg-elevated p-5 shadow-border sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-display text-2xl font-medium">Readings</h2><p className="mt-1 text-sm text-muted">Photograph either meter, confirm the detected reading, and save.</p></div><Button onClick={() => setModalOpen(true)}>Add reading</Button></div></div>{modalOpen && <AddReadingModal onClose={() => setModalOpen(false)} />}<div className="rounded-2xl bg-elevated p-5 shadow-border sm:p-6"><div className="flex items-center justify-between"><h3 className="font-display text-xl font-medium">Recent readings</h3><span className="text-sm text-muted">{readings.length} total</span></div><div className="mt-5 grid gap-2 sm:hidden">{sorted.slice(0, 80).map((r) => <div key={r.id} className="rounded-xl border border-border p-3"><div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{new Date(r.datetime).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" })}</span><Button variant="ghost" size="sm" onClick={() => deleteReading(r.id)}>Remove</Button></div><dl className="mt-2 grid grid-cols-3 gap-2 text-sm"><div><dt className="text-xs text-muted">Meter 1</dt><dd className="tabular-nums">{units(r.newInput)}</dd></div><div><dt className="text-xs text-muted">Meter 2</dt><dd className="tabular-nums">{units(r.oldInput)}</dd></div><div><dt className="text-xs text-muted">Load</dt><dd className="tabular-nums">{units(r.loadKw)}</dd></div></dl></div>)}</div><div className="mt-5 hidden overflow-x-auto sm:block"><table className="w-full min-w-[40rem] text-sm"><thead><tr className="text-left text-xs uppercase tracking-wider text-muted"><th className="pb-2 font-medium">When</th><th className="pb-2 text-right font-medium">Meter 1</th><th className="pb-2 text-right font-medium">Meter 2</th><th className="pb-2 text-right font-medium">Load</th><th className="pb-2 font-medium"></th></tr></thead><tbody>{sorted.slice(0, 80).map((r) => <tr key={r.id} className="border-t border-border"><td className="py-2.5">{new Date(r.datetime).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" })}</td><td className="py-2.5 text-right tabular-nums">{units(r.newInput)}</td><td className="py-2.5 text-right tabular-nums">{units(r.oldInput)}</td><td className="py-2.5 text-right tabular-nums">{units(r.loadKw)}</td><td className="py-2.5 text-right"><Button variant="ghost" size="sm" onClick={() => deleteReading(r.id)}>Remove</Button></td></tr>)}</tbody></table></div></div></section>;
}
