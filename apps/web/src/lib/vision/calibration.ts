"use client";

import { applyCalibration, type Calibration } from "keybed";

/** The keybed's shape and the camera's lens, each measured once from corners
 * placed by hand and kept for this browser. The fit reads them globally, so a
 * session applies what it has before it looks at anything. */
const depthKey = "kinesthesia.keybed.depthUnits";
const focalKey = "kinesthesia.keybed.focalFraction";

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
