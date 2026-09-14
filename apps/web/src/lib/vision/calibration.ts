"use client";

import { applyCalibration, type Calibration } from "keybed";
import type { PitchRange } from "@/lib/vision/space";

/** The keybed's shape and the camera's lens, each measured once from corners
 * placed by hand and kept for this browser. The fit reads them globally, so a
 * session applies what it has before it looks at anything. */
const depthKey = "kinesthesia.keybed.depthUnits";
const focalKey = "kinesthesia.keybed.focalFraction";
const lowPitchKey = "kinesthesia.keybed.lowPitch";
const highPitchKey = "kinesthesia.keybed.highPitch";

function read(key: string): number | null {
  try {
    const held = localStorage.getItem(key);
    return held === null ? null : Number(held);
  } catch {
    return null;
  }
}

function write(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Storage can be blocked, and the measurement still holds for this session.
  }
}

export function storedCalibration(): Calibration {
  return { depthUnits: read(depthKey), focalFraction: read(focalKey) };
}

export function applyStoredCalibration(): void {
  applyCalibration(storedCalibration());
}

export function keepDepth(units: number): void {
  write(depthKey, units);
}

export function keepFocal(fraction: number): void {
  write(focalKey, fraction);
}

/** The board the player has pinned down themselves. Null is the ordinary case:
 * nothing is assumed about the instrument, and the keys are read off the
 * picture instead. */
export function storedRange(): PitchRange | null {
  const lowest = read(lowPitchKey);
  const highest = read(highPitchKey);
  return lowest === null || highest === null || lowest >= highest
    ? null
    : { lowest, highest };
}

export function keepRange(range: PitchRange): void {
  write(lowPitchKey, range.lowest);
  write(highPitchKey, range.highest);
}
