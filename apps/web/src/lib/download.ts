export function downloadName(title: string, extension: string): string {
  const base = title.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "");
  return `${base === "" ? "song" : base}.${extension}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // The click starts the download asynchronously, so revoking on this tick can
  // cancel it before the browser has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
