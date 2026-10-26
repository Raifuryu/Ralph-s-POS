"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** The browser's own barcode reader. Chrome on Android has it; Safari
    doesn't, which is why this file always keeps a manual-entry fallback
    rather than assuming a camera path exists. Typed here because
    TypeScript's DOM lib doesn't ship it yet. */
type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>;
};
type BarcodeDetectorCtor = new (options?: {
  formats?: string[];
}) => BarcodeDetectorLike;

/** The 1D formats a sari-sari store actually meets: EAN/UPC on packaged
    goods, Code 128/39 on anything locally printed. QR is included because
    some suppliers label with it. */
const FORMATS = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "code_39",
  "itf",
  "qr_code",
];

function detectorCtor(): BarcodeDetectorCtor | null {
  const ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor })
    .BarcodeDetector;
  return typeof ctor === "function" ? ctor : null;
}

type Status =
  | { kind: "starting" }
  | { kind: "scanning" }
  /** Camera can't run at all here — the message says why, in the owner's
      terms, since the usual cause is the app being opened over plain http
      where browsers block the camera outright. */
  | { kind: "unavailable"; message: string };

/**
 * Scans a barcode with the phone's camera and hands back the digits.
 *
 * Deliberately self-contained and dumb: it owns the camera stream and
 * nothing else, so both places that scan (assigning a code to a product in
 * Inventory, and adding an item to a sale) behave identically. The caller
 * decides what a code MEANS — this only reports what it read.
 *
 * Typing the code by hand is always available, not just as an error path:
 * worn and crumpled barcodes are common, and a scan that won't catch
 * shouldn't stop a sale.
 */
export default function BarcodeScanner({
  onScan,
  onCancel,
  hint,
}: {
  /** Called once per distinct code. Scanning keeps running afterwards so
      several items can go in back to back — the caller closes this when
      it's done. */
  onScan: (code: string) => void;
  onCancel: () => void;
  hint?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<Status>({ kind: "starting" });
  const [manual, setManual] = useState("");
  // Last code and when — a camera reads the same label many times a second,
  // so without this one scan would add an item dozens of times.
  const lastScan = useRef<{ code: string; at: number }>({ code: "", at: 0 });

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;

    async function start() {
      const Detector = detectorCtor();
      if (!Detector) {
        setStatus({
          kind: "unavailable",
          message:
            "This browser can't scan barcodes. Chrome on Android can — or type the code below.",
        });
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus({
          kind: "unavailable",
          message:
            "The camera is blocked unless the app is opened over https:// — type the code below instead.",
        });
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // The back camera, and a resolution high enough to resolve the
          // thin bars of an EAN-13 without being slow to decode.
          video: { facingMode: "environment", width: { ideal: 1280 } },
        });
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setStatus({ kind: "scanning" });

        const detector = new Detector({ formats: FORMATS });
        timer = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;
          try {
            const found = await detector.detect(videoRef.current);
            const code = found[0]?.rawValue?.trim();
            if (!code) return;
            const now = Date.now();
            if (code === lastScan.current.code && now - lastScan.current.at < 1500) {
              return;
            }
            lastScan.current = { code, at: now };
            // A short buzz is the only feedback a scan gets — the owner is
            // looking at the shelf, not the screen.
            navigator.vibrate?.(60);
            onScan(code);
          } catch {
            // A frame that can't be decoded is the normal case between
            // reads, not an error worth surfacing.
          }
        }, 250);
      } catch (err) {
        const denied =
          err instanceof DOMException &&
          (err.name === "NotAllowedError" || err.name === "SecurityError");
        setStatus({
          kind: "unavailable",
          message: denied
            ? "Camera permission was refused. Allow it in the browser's site settings, or type the code below."
            : "Couldn't start the camera. Type the code below instead.",
        });
      }
    }

    void start();
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [onScan]);

  return (
    <div className="flex flex-col gap-3">
      {status.kind === "unavailable" ? (
        <p className="rounded-lg border border-warning/60 bg-warning/10 p-2 text-xs font-medium text-warning">
          {status.message}
        </p>
      ) : (
        <div className="relative overflow-hidden rounded-lg border bg-black">
          {/* playsInline keeps iOS from taking the video fullscreen; muted
              is what lets autoplay start without a gesture. */}
          <video
            ref={videoRef}
            playsInline
            muted
            className="h-56 w-full object-cover"
          />
          {/* A window to aim through — a barcode fills it edge to edge at
              roughly the right distance. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-6 top-1/2 h-20 -translate-y-1/2 rounded-lg border-2 border-white/80"
          />
          {status.kind === "starting" ? (
            <p className="absolute inset-0 flex items-center justify-center text-xs text-white">
              Starting camera…
            </p>
          ) : null}
        </div>
      )}

      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}

      <div className="flex flex-col gap-1">
        <Label htmlFor="manual-barcode" className="text-xs">
          Or type the code
        </Label>
        <div className="flex gap-2">
          <Input
            id="manual-barcode"
            inputMode="numeric"
            placeholder="e.g. 4800016641114"
            value={manual}
            onChange={(event) => setManual(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              const code = manual.trim();
              if (!code) return;
              setManual("");
              onScan(code);
            }}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const code = manual.trim();
              if (!code) return;
              setManual("");
              onScan(code);
            }}
          >
            Use
          </Button>
        </div>
      </div>

      <Button type="button" variant="ghost" onClick={onCancel}>
        Close
      </Button>
    </div>
  );
}
