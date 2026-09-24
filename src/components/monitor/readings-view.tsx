import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { units } from "@/lib/engine/time";
import { extractMeterReading, type MeterReadingResult } from "@/lib/meter-vision";
import { loadMeterIdentities, loadMeterImageReferences, saveMeterImage, listMeterImages, attachMeterImage, deleteMeterImage, type MeterImage } from "@/lib/storage/meter-images";
import { driveStatus, driveFolderInfo, loadDriveImage } from "@/lib/storage/google-drive";
import { processRawMRFolder, type RawImportResult } from "@/lib/storage/raw-meter-import";
import { useMonitor } from "@/store/monitor";

function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)); }
async function fileToDataUrl(file: File): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = () => reject(new Error("Could not read the image file.")); reader.readAsDataURL(file); }); }
async function decodeOriented(file: File): Promise<ImageBitmap | HTMLImageElement> { if (typeof createImageBitmap === "function") { try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch {} } const dataUrl = await fileToDataUrl(file); return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("Could not decode the image.")); img.src = dataUrl; }); }
function bitmapSize(image: ImageBitmap | HTMLImageElement) { return { width: "naturalWidth" in image ? image.naturalWidth || image.width : image.width, height: "naturalHeight" in image ? image.naturalHeight || image.height : image.height }; }
async function normalizeImage(file: File, maxDim = 2200): Promise<string> { const image = await decodeOriented(file); const { width: sourceWidth, height: sourceHeight } = bitmapSize(image); const scale = Math.min(1, maxDim / Math.max(sourceWidth, sourceHeight)); const width = Math.max(1, Math.round(sourceWidth * scale)); const height = Math.max(1, Math.round(sourceHeight * scale)); const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Could not create the image canvas."); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high"; ctx.drawImage(image, 0, 0, width, height); if ("close" in image) image.close(); return canvas.toDataURL("image/jpeg", 0.9).split(",")[1]; }
async function cropAndRotateImage(base64: string, crop: MeterReadingResult["crop"], rotation: number): Promise<string> { const img = await new Promise<HTMLImageElement>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error("Could not prepare the detected display crop.")); image.src = `data:image/jpeg;base64,${base64}`; }); if (!crop) return base64; const x = clamp(crop.x, 0, 100) / 100, y = clamp(crop.y, 0, 100) / 100, w = clamp(crop.width, 1, 100) / 100, h = clamp(crop.height, 1, 100) / 100; const rawX = img.naturalWidth * x, rawY = img.naturalHeight * y, rawW = img.naturalWidth * w, rawH = img.naturalHeight * h; const padX = rawW * 0.08, padY = rawH * 0.18; const sx = Math.max(0, Math.floor(rawX - padX)), sy = Math.max(0, Math.floor(rawY - padY)); const ex = Math.min(img.naturalWidth, Math.ceil(rawX + rawW + padX)), ey = Math.min(img.naturalHeight, Math.ceil(rawY + rawH + padY)); const sw = Math.max(1, ex - sx), sh = Math.max(1, ey - sy); const radians = (rotation * Math.PI) / 180, sin = Math.abs(Math.sin(radians)), cos = Math.abs(Math.cos(radians)); const outWidth = Math.max(1, Math.ceil(sw * cos + sh * sin)), outHeight = Math.max(1, Math.ceil(sw * sin + sh * cos)); const canvas = document.createElement("canvas"); canvas.width = outWidth; canvas.height = outHeight; const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Could not create the crop canvas."); ctx.fillStyle = "#f5f5f5"; ctx.fillRect(0, 0, outWidth, outHeight); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high"; ctx.translate(outWidth / 2, outHeight / 2); ctx.rotate(radians); ctx.drawImage(img, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh); return canvas.toDataURL("image/jpeg", 0.96).split(",")[1]; }
function pad(n: number) { return String(n).padStart(2, "0"); }
function nowParts() { const n = new Date(); return { date: `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`, time: `${pad(n.getHours())}:${pad(n.getMinutes())}` }; }
type MeterKey = "m1" | "m2";
type ScanState = { value: string; thumb: string | null; status: "idle" | "scanning" | "done" | "error"; result: MeterReadingResult | null; detectedMeter: MeterKey | null; needsChoice: boolean; error: string };
function emptyScan(value = ""): ScanState { return { value, thumb: null, status: "idle", result: null, detectedMeter: null, needsChoice: false, error: "" }; }
function latestMeterValue(readings: ReturnType<typeof useMonitor.getState>["readings"], meter: MeterKey) { const field = meter === "m1" ? "newInput" : "oldInput"; return [...readings].sort((a, b) => b.datetime - a.datetime).find((r) => r[field] != null)?.[field] ?? null; }
function normalizeIdentity(value: string | null | undefined) { return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, ""); }
function inferIdentityMeter(identity: string | null, known: Array<{ meter: MeterKey; identity: string }>): MeterKey | null { const key = normalizeIdentity(identity); if (!key || key.length < 4) return null; const matches = known.filter((x) => { const knownKey = normalizeIdentity(x.identity); return knownKey && (key.includes(knownKey) || knownKey.includes(key)); }); const meters = new Set(matches.map((x) => x.meter)); return meters.size === 1 ? matches[0].meter : null; }
function inferMeter(readings: ReturnType<typeof useMonitor.getState>["readings"], value: number | null): MeterKey | null { if (value == null || !Number.isFinite(value)) return null; const p1 = latestMeterValue(readings, "m1"), p2 = latestMeterValue(readings, "m2"); if (p1 == null && p2 == null) return null; if (p1 == null) return "m1"; if (p2 == null) return "m2"; const d1 = value - p1, d2 = value - p2, eps = 0.05, plausible = (d: number) => d >= -eps && d <= 500; const a1 = plausible(d1), a2 = plausible(d2); if (a1 && !a2) return "m1"; if (a2 && !a1) return "m2"; if (!a1 && !a2) return null; const moved1 = d1 > eps, moved2 = d2 > eps; if (moved1 && !moved2) return "m1"; if (moved2 && !moved1) return "m2"; if (Math.abs(d1) < eps && Math.abs(d2) >= eps) return "m1"; if (Math.abs(d2) < eps && Math.abs(d1) >= eps) return "m2"; if (Math.abs(d1 - d2) > 0.5) return Math.abs(d1) < Math.abs(d2) ? "m1" : "m2"; return null; }
function ScanResult({ scan, onChoose }: { scan: ScanState; onChoose: (meter: MeterKey) => void }) { if (scan.status !== "done" || !scan.result) return null; const meterLabel = scan.detectedMeter === "m1" ? "Meter 1" : scan.detectedMeter === "m2" ? "Meter 2" : null; return <div className="mt-3 rounded-xl border border-border bg-background p-3"><div className="grid gap-2 sm:grid-cols-2"><div className="rounded-lg border border-border px-3 py-2"><p className="text-sm font-medium">{meterLabel ? "✓ Meter detected" : "⚠ Meter not identified"}</p><p className="text-sm text-muted">{meterLabel ?? "Choose the physical meter below."}</p></div><div className="rounded-lg border border-border px-3 py-2"><p className="text-sm font-medium">{scan.result.value != null ? "✓ Reading detected" : "⚠ Reading not detected"}</p><p className="text-sm text-muted">{scan.result.value ?? "Unreadable"} · {scan.result.confidence} confidence{scan.result.label ? ` · ${scan.result.label}` : ""}</p></div></div>{scan.result.identity ? <p className="mt-2 text-xs text-muted">Identity: {scan.result.identity}</p> : null}{scan.needsChoice && <div className="mt-3 flex gap-2"><Button type="button" size="sm" variant="outline" onClick={() => onChoose("m1")}>Meter 1</Button><Button type="button" size="sm" variant="outline" onClick={() => onChoose("m2")}>Meter 2</Button></div>}</div>; }
function MeterScanner({ scan, onPhoto, onValueChange, onChoose }: { scan: ScanState; onPhoto: (file: File) => void; onValueChange: (value: string) => void; onChoose: (meter: MeterKey) => void }) { const fileRef = useRef<HTMLInputElement>(null); const meterLabel = scan.detectedMeter === "m1" ? "Meter 1" : scan.detectedMeter === "m2" ? "Meter 2" : "Meter"; return <div className="rounded-xl border border-border p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium">Take meter photo</p><p className="text-sm text-muted">The app detects the meter and reading from the photo.</p></div><Button type="button" variant="outline" disabled={scan.status === "scanning"} onClick={() => fileRef.current?.click()}>{scan.status === "scanning" ? "Reading meter…" : scan.thumb ? "Retake photo" : "Take photo"}</Button><input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void onPhoto(file); e.target.value = ""; }} /></div>{scan.thumb && <img src={`data:image/jpeg;base64,${scan.thumb}`} alt="Detected meter display" className="mt-3 max-h-72 w-full rounded-lg object-contain bg-background" />}{scan.status === "done" && scan.result && <ScanResult scan={scan} onChoose={onChoose} />}{scan.status === "error" && <p className="mt-2 text-sm text-danger">{scan.error}</p>}<Input className="mt-3" type="number" step="0.01" placeholder={scan.detectedMeter ? meterLabel : "Meter reading"} value={scan.value} onChange={(e) => onValueChange(e.target.value)} /></div>; }
function AddReadingModal({ onClose }: { onClose: () => void }) {
  const addReading = useMonitor((s) => s.addReading); const readings = useMonitor((s) => s.readings); const aiProvider = useMonitor((s) => s.general.aiProvider); const latest = useMemo(() => [...readings].sort((a, b) => b.datetime - a.datetime)[0], [readings]); const [date, setDate] = useState(nowParts().date), [time, setTime] = useState(nowParts().time), [load, setLoad] = useState(""); const [scan, setScan] = useState<ScanState>(emptyScan()); const [m1, setM1] = useState(String(latest?.newInput ?? "")), [m2, setM2] = useState(String(latest?.oldInput ?? ""));
  async function handlePhoto(file: File) { setScan((prev) => ({ ...prev, status: "scanning", error: "" })); try { const base64 = await normalizeImage(file); const [knownIdentities, knownReferences] = await Promise.all([loadMeterIdentities(), loadMeterImageReferences()]); const result = await extractMeterReading({ data: { imageBase64: base64, mimeType: "image/jpeg", provider: aiProvider, knownIdentities, knownReferences } }); const cropped = result.crop ? await cropAndRotateImage(base64, result.crop, result.rotation) : base64; const identityMeter = inferIdentityMeter(result.identity, knownIdentities); const detectedMeter = result.matchedMeter ?? identityMeter ?? inferMeter(readings, result.value); const needsChoice = result.value == null || detectedMeter == null; setScan({ value: result.value != null ? String(result.value) : "", thumb: cropped, status: "done", result, detectedMeter, needsChoice, error: "" }); if (!needsChoice && result.value != null) { if (detectedMeter === "m1") setM1(String(result.value)); if (detectedMeter === "m2") setM2(String(result.value)); } } catch (err) { setScan((prev) => ({ ...prev, status: "error", error: err instanceof Error ? err.message : "Could not read the meter photo." })); } }
  function chooseMeter(meter: MeterKey) { setScan((prev) => ({ ...prev, detectedMeter: meter, needsChoice: false })); if (scan.result?.value != null) { if (meter === "m1") setM1(String(scan.result.value)); else setM2(String(scan.result.value)); } }
  const scanning = scan.status === "scanning";
  async function handleSave() { if (!date || !time || (scan.status === "done" && scan.needsChoice)) return; const [y, mo, d] = date.split("-").map(Number), [h, mi] = time.split(":").map(Number); const dt = new Date(y, mo - 1, d, h, mi, 0, 0); const readingId = addReading({ datetime: dt.getTime(), newInput: m1 === "" ? null : Number(m1), oldInput: m2 === "" ? null : Number(m2), loadKw: load === "" ? null : Number(load), notes: "" }); if (scan.status === "done" && scan.result && scan.detectedMeter && scan.thumb) { try { await saveMeterImage({ data: { id: `img-${crypto.randomUUID()}`, meter: scan.detectedMeter, readingId, value: scan.result.value, identity: scan.result.identity, imageBase64: scan.thumb } }); } catch { /* The reading is already saved; image storage can be retried with a later scan. */ } } onClose(); }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"><div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-elevated p-5 shadow-border sm:p-6"><div className="flex items-center justify-between"><h2 className="font-display text-2xl font-medium">Add reading</h2><Button variant="ghost" size="sm" onClick={onClose}>Close</Button></div><p className="mt-1 text-sm text-muted">Take a photo of either meter. The app corrects camera rotation, crops the numeric display, detects the meter and reading, then lets you confirm before saving.</p><div className="mt-4"><MeterScanner scan={scan} onPhoto={handlePhoto} onValueChange={(v) => { setScan((prev) => ({ ...prev, value: v })); if (scan.detectedMeter === "m1") setM1(v); if (scan.detectedMeter === "m2") setM2(v); }} onChoose={chooseMeter} /></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-border p-3"><p className="mb-2 text-sm font-medium">Meter 1</p><Input type="number" step="0.01" value={m1} onChange={(e) => setM1(e.target.value)} /></div><div className="rounded-xl border border-border p-3"><p className="mb-2 text-sm font-medium">Meter 2</p><Input type="number" step="0.01" value={m2} onChange={(e) => setM2(e.target.value)} /></div></div><div className="mt-4 grid gap-3 sm:grid-cols-3"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" /><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" /><Input type="number" step="0.01" placeholder="Inverter kW" value={load} onChange={(e) => setLoad(e.target.value)} /></div><div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={handleSave} disabled={scanning || scan.needsChoice}>{scanning ? "Reading meter…" : scan.needsChoice ? "Choose meter first" : "Add reading"}</Button></div></div></div>;
}



function filenameTimestamp(file: File) {
  // Camera apps commonly encode the original capture time in names such as
  // IMG_20260901_215823.jpg and TimePhoto_20260901_215823.jpg.
  // Ignore suffixes such as _1 / _2: they are duplicate-name suffixes, not time.
  const match = file.name.match(/(?:IMG|TimePhoto)_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})(?:_\d+)?\.jpe?g$/i);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const value = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)).getTime();
  return Number.isFinite(value) ? value : null;
}

async function imageTimestamp(file: File) {
  // Filename time is authoritative for bulk imports because Windows can
  // rewrite lastModified when files are copied. EXIF is the next fallback.
  const fromName = filenameTimestamp(file);
  if (fromName != null) return fromName;

  if (/jpe?g/i.test(file.type) || /\.jpe?g$/i.test(file.name)) {
    try {
      const buffer = await file.slice(0, Math.min(file.size, 512 * 1024)).arrayBuffer();
      const view = new DataView(buffer);
      let p = 2;
      while (p + 4 < view.byteLength) {
        if (view.getUint8(p) !== 0xff) break;
        const marker = view.getUint8(p + 1); const length = view.getUint16(p + 2);
        if (marker === 0xe1 && p + 10 < view.byteLength) {
          const exif = p + 4;
          if (new TextDecoder().decode(new Uint8Array(buffer, exif, 6)) === "Exif\0\0") {
            const t = exif + 6;
            const little = view.getUint16(t) === 0x4949;
            const u16 = (o: number) => view.getUint16(o, little);
            const u32 = (o: number) => view.getUint32(o, little);
            if (u16(t + 2) === 42) {
              const ifd0 = t + u32(t + 4);
              const entries = u16(ifd0);
              let exifOffset = 0;
              for (let i = 0; i < entries; i++) {
                const e = ifd0 + 2 + i * 12;
                if (u16(e) === 0x8769) exifOffset = u32(e + 8);
              }
              if (exifOffset) {
                const ifd = t + exifOffset, count = u16(ifd);
                for (let i = 0; i < count; i++) {
                  const e = ifd + 2 + i * 12;
                  if (u16(e) !== 0x9003) continue;
                  const type = u16(e + 2), n = u32(e + 4);
                  if (type !== 2 || n < 19) continue;
                  const offset = n <= 4 ? e + 8 : t + u32(e + 8);
                  const raw = new TextDecoder().decode(new Uint8Array(buffer, offset, Math.min(n, 19))).replace(/\0/g, "");
                  const m = raw.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
                  if (m) {
                    const value = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])).getTime();
                    if (Number.isFinite(value)) return value;
                  }
                }
              }
            }
          }
        }
        p += Math.max(2, length);
      }
    } catch {}
  }
  return file.lastModified;
}

function nearestReadingId(readings: ReturnType<typeof useMonitor.getState>["readings"], timestamp: number) {
  // Bulk imports are matched to the closest reading by absolute time.
  // Multiple images are allowed to resolve to the same reading.
  let best: typeof readings[number] | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const reading of readings) {
    const distance = Math.abs(timestamp - reading.datetime);
    if (distance < bestDistance) {
      best = reading;
      bestDistance = distance;
    }
  }
  return best?.id ?? null;
}

function ImageThumb({ driveFileId, alt }: { driveFileId: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { void loadDriveImage({ data: { id: driveFileId } }).then((x) => setSrc(`data:${x.mimeType};base64,${x.base64}`)).catch(() => setSrc(null)); }, [driveFileId]);
  return src ? <img src={src} alt={alt} className="h-20 w-20 rounded-lg object-cover bg-background" /> : <div className="h-20 w-20 rounded-lg bg-background" />;
}

function BulkUploadModal({ readings, onClose }: { readings: ReturnType<typeof useMonitor.getState>["readings"]; onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [folderUrl, setFolderUrl] = useState<string | null>(null);
  const [folderError, setFolderError] = useState("");

  useEffect(() => {
    let active = true;
    void driveFolderInfo().then((info) => {
      if (active) setFolderUrl(info.url);
    }).catch((err) => {
      if (active) setFolderError(err instanceof Error ? err.message : "Could not verify the Google Drive folder.");
    });
    return () => { active = false; };
  }, []);

  async function upload() {
    if (!files.length || busy) return;
    const status = await driveStatus();
    if (!status.connected) { window.location.href = "/api/drive/connect"; return; }
    setBusy(true); setMessage(""); setFolderError("");
    try {
      const folder = await driveFolderInfo();
      setFolderUrl(folder.url);
      let attached = 0, unrelated = 0;
      for (const file of files) {
        try {
          const base64 = await normalizeImage(file);
          const timestamp = await imageTimestamp(file);
          const readingId = nearestReadingId(readings, timestamp);
          const target = readingId ? readings.find((r) => r.id === readingId) : null;
          const meter = target?.newInput != null && target?.oldInput == null ? "m1" : target?.oldInput != null && target?.newInput == null ? "m2" : "m1";
          const uploaded = await saveMeterImage({
            data: {
              id: `img-${crypto.randomUUID()}`,
              meter,
              readingId,
              imageCreatedAt: timestamp,
              status: readingId ? "attached" : "unrelated",
              imageBase64: base64,
            },
          });
          if (uploaded.ok) readingId ? attached++ : unrelated++;
        } catch { unrelated++; }
        setMessage(`Uploaded ${attached + unrelated} / ${files.length} · ${attached} attached · ${unrelated} unrelated`);
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"><div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-elevated p-5 shadow-border">
    <div className="flex items-center justify-between"><h2 className="font-display text-2xl font-medium">Bulk upload images</h2><Button variant="ghost" size="sm" onClick={onClose}>Close</Button></div>
    <p className="mt-1 text-sm text-muted">Filename timestamps such as IMG_YYYYMMDD_HHMMSS and TimePhoto_YYYYMMDD_HHMMSS are used first, then EXIF. Every selected image is uploaded to Google Drive; images without a reading remain unrelated and can be attached later.</p>
    <div className="mt-4 rounded-xl border border-border bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="text-sm font-medium">Google Drive storage</p><p className="text-xs text-muted">EM_DATA folder in your connected Google Drive. Images are organized under Meter Readings by meter.</p></div>
        {folderUrl && <a href={folderUrl} target="_blank" rel="noreferrer" className="text-sm underline">Open EM_DATA</a>}
      </div>
      {folderError && <p className="mt-2 text-xs text-danger">{folderError}</p>}
    </div>
    <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
    <div className="mt-4 rounded-xl border border-dashed border-border p-6 text-center"><Button variant="outline" onClick={() => inputRef.current?.click()}>Choose images</Button><p className="mt-2 text-sm text-muted">{files.length ? `${files.length} images selected` : "Select multiple meter photos"}</p></div>
    {message && <p className="mt-3 text-sm">{message}</p>}
    <div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!files.length || busy} onClick={() => void upload()}>{busy ? "Uploading…" : "Bulk upload images"}</Button></div>
  </div></div>;
}

function RawMRModal({ readings, onClose }: { readings: ReturnType<typeof useMonitor.getState>["readings"]; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RawImportResult | null>(null);
  const [error, setError] = useState("");
  const [folderUrl, setFolderUrl] = useState<string | null>(null);

  useEffect(() => {
    void driveFolderInfo().then((x) => setFolderUrl(x.url)).catch(() => setFolderUrl(null));
  }, []);

  async function process() {
    if (busy) return;
    const status = await driveStatus();
    if (!status.connected) { window.location.href = "/api/drive/connect"; return; }
    setBusy(true); setError(""); setResult(null);
    try {
      setResult(await processRawMRFolder({
        data: {
          readings: readings.map((r) => ({
            id: r.id,
            datetime: r.datetime,
            newInput: r.newInput ?? null,
            oldInput: r.oldInput ?? null,
          })),
        },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not process the MR folder.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
    <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-elevated p-5 shadow-border">
      <div className="flex items-center justify-between">
        <div><h2 className="font-display text-2xl font-medium">Process MR folder</h2><p className="mt-1 text-sm text-muted">MR stays untouched. The app reads each raw image, identifies the meter, matches its capture time to the nearest reading, and creates an organized copy in EM_DATA.</p></div>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>
      <div className="mt-4 rounded-xl border border-border bg-background p-3">
        <p className="text-sm"><strong>Source:</strong> Google Drive / MR</p>
        <p className="text-sm"><strong>Destination:</strong> EM_DATA / Meter Readings / Meter 1, Meter 2, or Unrelated</p>
        {folderUrl && <a href={folderUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm underline">Open EM_DATA</a>}
      </div>
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      {busy && <p className="mt-3 text-sm">Processing raw images… This may take time because each image is scanned before it is organized.</p>}
      {result && <div className="mt-4 rounded-xl border border-border p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div><p className="text-xs text-muted">Raw images</p><p className="text-xl font-medium">{result.total}</p></div>
          <div><p className="text-xs text-muted">Processed</p><p className="text-xl font-medium">{result.processed}</p></div>
          <div><p className="text-xs text-muted">Attached</p><p className="text-xl font-medium">{result.attached}</p></div>
          <div><p className="text-xs text-muted">Review</p><p className="text-xl font-medium">{result.review}</p></div>
        </div>
        {result.failed > 0 && <p className="mt-3 text-sm text-danger">{result.failed} images failed and were not copied.</p>}
        <div className="mt-4 max-h-64 overflow-y-auto space-y-1 text-xs">
          {result.items.map((item) => <div key={item.sourceId} className="flex gap-2 border-t border-border py-1.5"><span className="min-w-0 flex-1 truncate">{item.sourceName}</span><span>{item.meter === "m1" ? "M1" : item.meter === "m2" ? "M2" : "Review"}</span><span>{item.value ?? "—"}</span><span>{item.error ? "Failed" : item.readingId ? "Attached" : "Review"}</span></div>)}
        </div>
      </div>}
      <div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Close</Button><Button disabled={busy} onClick={() => void process()}>{busy ? "Processing…" : "Process MR folder"}</Button></div>
    </div>
  </div>;
}

function ImageManager({ reading, onClose }: { reading: ReturnType<typeof useMonitor.getState>["readings"][number]; onClose: () => void }) {
  const [images, setImages] = useState<MeterImage[]>([]);
  const [storageOpen, setStorageOpen] = useState(false);
  async function refresh() { setImages(await listMeterImages()); }
  useEffect(() => { void refresh(); }, []);
  const attached = images.filter((x) => x.readingId === reading.id);
  const available = images.filter((x) => !x.readingId && x.driveFileId && (x.status === "review" || x.status === "unrelated"));
  async function remove(image: MeterImage) { await attachMeterImage({ data: { id: image.id, readingId: null, status: "unrelated" } }); await refresh(); }
  async function discard(image: MeterImage) { await deleteMeterImage({ data: { id: image.id, driveFileId: image.driveFileId } }); await refresh(); }
  async function attach(image: MeterImage, meter: MeterKey) { await attachMeterImage({ data: { id: image.id, meter, readingId: reading.id, status: "attached" } }); await refresh(); setStorageOpen(false); }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"><div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-elevated p-5 shadow-border">
    <div className="flex items-center justify-between"><div><h2 className="font-display text-2xl font-medium">Reading images</h2><p className="text-sm text-muted">{new Date(reading.datetime).toLocaleString()}</p></div><Button variant="ghost" size="sm" onClick={onClose}>Close</Button></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">{attached.map((image) => <div key={image.id} className="flex items-center gap-3 rounded-xl border border-border p-3"><ImageThumb driveFileId={image.driveFileId!} alt={image.id} /><div className="min-w-0 flex-1"><p className="truncate text-sm">{new Date(image.imageCreatedAt ?? image.createdAt).toLocaleString()}</p><div className="mt-2 flex gap-2"><Button size="sm" variant="outline" onClick={() => void remove(image)}>Remove</Button><Button size="sm" variant="ghost" onClick={() => void discard(image)}>Discard</Button></div></div></div>)}</div>
    <Button className="mt-4" variant="outline" onClick={() => setStorageOpen((v) => !v)}>+ Add from image storage</Button>
    {storageOpen && <div className="mt-3 rounded-xl border border-border p-3"><p className="mb-2 text-sm font-medium">Unrelated / unattached images</p>{available.length ? <div className="grid gap-2 sm:grid-cols-2">{available.map((image) => <div key={image.id} className="flex items-center gap-3 rounded-lg border border-border p-2"><ImageThumb driveFileId={image.driveFileId!} alt={image.id} /><span className="min-w-0 flex-1 text-xs">{new Date(image.imageCreatedAt ?? image.createdAt).toLocaleString()}</span><div className="flex gap-1"><Button size="sm" variant="outline" onClick={() => void attach(image, "m1")}>M1</Button><Button size="sm" variant="outline" onClick={() => void attach(image, "m2")}>M2</Button></div></div>)}</div> : <p className="text-sm text-muted">No unattached images.</p>}</div>}
  </div></div>;
}

export function ReadingsView() {
  const readings = useMonitor((s) => s.readings);
  const deleteReading = useMonitor((s) => s.deleteReading);
  const [modalOpen, setModalOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [rawMROpen, setRawMROpen] = useState(false);
  const [imageReading, setImageReading] = useState<ReturnType<typeof useMonitor.getState>["readings"][number] | null>(null);
  const [meterImages, setMeterImages] = useState<MeterImage[]>([]);
  const sorted = useMemo(() => [...readings].sort((a, b) => b.datetime - a.datetime), [readings]);

  useEffect(() => {
    void listMeterImages().then(setMeterImages).catch(() => setMeterImages([]));
  }, []);

  return <section className="space-y-5">
    <div className="rounded-2xl bg-elevated p-5 shadow-border sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="font-display text-2xl font-medium">Readings</h2><p className="mt-1 text-sm text-muted">Take a meter photo, confirm the detected reading, and add it.</p></div>
        <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => { window.location.href = "/api/drive/connect"; }}>Connect Drive</Button><Button variant="outline" onClick={() => setRawMROpen(true)}>Process MR folder</Button><Button variant="outline" onClick={() => setBulkOpen(true)}>Bulk upload images</Button><Button onClick={() => setModalOpen(true)}>Add reading</Button></div>
      </div>
    </div>
    {modalOpen && <AddReadingModal onClose={() => setModalOpen(false)} />}
    {bulkOpen && <BulkUploadModal readings={readings} onClose={() => setBulkOpen(false)} />}
    {rawMROpen && <RawMRModal readings={readings} onClose={() => { setRawMROpen(false); void listMeterImages().then(setMeterImages).catch(() => {}); }} />}
    {imageReading && <ImageManager reading={imageReading} onClose={() => { setImageReading(null); void listMeterImages().then(setMeterImages).catch(() => {}); }} />}
    <div className="rounded-2xl bg-elevated p-5 shadow-border sm:p-6">
      <div className="flex items-center justify-between"><h3 className="font-display text-xl font-medium">Recent readings</h3><span className="text-sm text-muted">{readings.length} total</span></div>
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[48rem] text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wider text-muted">
            <th className="pb-2 font-medium">When</th><th className="pb-2 text-right font-medium">Meter 1</th><th className="pb-2 text-right font-medium">Meter 2</th><th className="pb-2 text-right font-medium">Load</th><th className="pb-2 font-medium">Images</th><th className="pb-2 font-medium"></th>
          </tr></thead>
          <tbody>{sorted.map((r) => {
            const images = meterImages.filter((image) => image.readingId === r.id && image.driveFileId);
            return <tr key={r.id} className="border-t border-border cursor-pointer hover:bg-background/40" onClick={() => setImageReading(r)}>
              <td className="py-2.5">{new Date(r.datetime).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" })}</td>
              <td className="py-2.5 text-right tabular-nums">{units(r.newInput)}</td>
              <td className="py-2.5 text-right tabular-nums">{units(r.oldInput)}</td>
              <td className="py-2.5 text-right tabular-nums">{units(r.loadKw)}</td>
              <td className="py-2.5">
                {images.length ? <div className="flex flex-wrap gap-2">{images.map((image, index) => <a key={image.id} href={`https://drive.google.com/file/d/${encodeURIComponent(image.driveFileId!)}/view`} target="_blank" rel="noreferrer" className="underline">Image {index + 1}</a>)}</div> : <span className="text-muted">—</span>}
              </td>
              <td className="py-2.5 text-right"><div className="flex justify-end gap-1"><Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setImageReading(r); }}>Images</Button><Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); deleteReading(r.id); }}>Remove</Button></div></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </div>
  </section>;
}
