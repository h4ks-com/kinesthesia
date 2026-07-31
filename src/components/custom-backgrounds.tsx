"use client";

import { ImagePlus, Trash2 } from "lucide-react";
import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { Preview } from "@/components/skin-picker";
import { SliderRow } from "@/components/ui/slider-row";
import { Toggle } from "@/components/ui/toggle";
import {
  type Backdrop,
  type BackgroundChoice,
  backdropBrightness,
  plainBackdrop,
} from "@/lib/skins/backdrop";
import { pictureBackdrop } from "@/lib/skins/picture";
import {
  deletePicture,
  listPictures,
  type Picture,
  pictureHref,
  storePicture,
} from "@/lib/storage/pictures";

/** Big enough for any photo worth putting behind a roll, small enough that the
 * device can hold several and draw one every frame. */
const mostBytes = 8 * 1024 * 1024;

type CustomBackgroundsProps = {
  chosen: BackgroundChoice | null;
  onChoose: (next: BackgroundChoice | null) => void;
};

/** The pictures on this device, each shown as itself. Held as object urls,
 * which are ours to let go of when the list changes or the dialog closes. */
function useThumbnails(
  pictures: readonly Picture[],
): ReadonlyMap<string, string> {
  const [hrefs, setHrefs] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    let live = true;
    const made: string[] = [];
    void Promise.all(
      pictures.map(async (picture) => {
        const href = await pictureHref(picture.source);
        return [picture.source, href] as const;
      }),
    ).then((pairs) => {
      const next = new Map<string, string>();
      for (const [source, href] of pairs) {
        if (href !== null) {
          next.set(source, href);
          made.push(href);
        }
      }
      if (live) {
        setHrefs(next);
      } else {
        for (const href of made) {
          URL.revokeObjectURL(href);
        }
      }
    });
    return () => {
      live = false;
      for (const href of made) {
        URL.revokeObjectURL(href);
      }
    };
  }, [pictures]);
  return hrefs;
}

export function CustomBackgrounds({
  chosen,
  onChoose,
}: CustomBackgroundsProps) {
  const [pictures, setPictures] = useState<readonly Picture[]>([]);
  const [over, setOver] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const thumbnails = useThumbnails(pictures);

  useEffect(() => {
    void listPictures().then(setPictures);
  }, []);

  const image = chosen?.kind === "image" ? chosen.image : null;

  // Run small against the settings as they are, because the roll behind this
  // dialog is blurred and cannot be read.
  const href = image === null ? undefined : thumbnails.get(image.source);
  const preview = useMemo(
    () =>
      image === null || href === undefined
        ? null
        : pictureBackdrop(image, href, "down"),
    [image, href],
  );
  const previewKey = `${image?.source}-${image?.scroll}-${image?.brightness}`;

  const shape = (next: Partial<Backdrop>): void => {
    if (image === null) {
      return;
    }
    onChoose({ kind: "image", image: { ...image, ...next } });
  };

  const take = async (files: FileList | null): Promise<void> => {
    const file = [...(files ?? [])].find((entry) =>
      entry.type.startsWith("image/"),
    );
    if (file === undefined) {
      setFailed("That was not an image.");
      return;
    }
    if (file.size > mostBytes) {
      setFailed("That image is too big. Around 8MB is the most that fits.");
      return;
    }
    setFailed(null);
    try {
      const source = await storePicture(
        file.name,
        await file.arrayBuffer(),
        file.type,
      );
      setPictures(await listPictures());
      onChoose({ kind: "image", image: { source, ...plainBackdrop } });
    } catch {
      setFailed("There was no room to keep that one.");
    }
  };

  const drop = (event: DragEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    setOver(false);
    void take(event.dataTransfer.files);
  };

  return (
    <section>
      <h3 className="font-semibold text-sm text-text">Your own</h3>
      <p className="mt-0.5 mb-2.5 text-muted text-xs leading-relaxed">
        Kept on this device. A link to one only opens a picture for you.
      </p>

      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        className={`flex w-full flex-col items-center gap-1 rounded-xl border border-dashed px-3 py-4 text-center transition-colors ${
          over ? "border-accent bg-raised" : "border-line-strong"
        }`}
      >
        <ImagePlus className="size-5 text-faint" aria-hidden="true" />
        <span className="font-medium text-accent text-xs">Choose an image</span>
        <span className="text-faint text-xs">or drop one here</span>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        aria-label="Background image"
        className="hidden"
        onChange={(event) => void take(event.target.files)}
      />
      {failed === null ? null : (
        <p role="alert" className="mt-2 text-danger text-xs">
          {failed}
        </p>
      )}

      {pictures.length === 0 ? null : (
        <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {pictures.map((picture) => {
            const selected = image?.source === picture.source;
            const href = thumbnails.get(picture.source);
            return (
              <li key={picture.source} className="relative">
                <button
                  type="button"
                  aria-label={picture.name}
                  aria-pressed={selected}
                  onClick={() =>
                    onChoose({
                      kind: "image",
                      image: { source: picture.source, ...plainBackdrop },
                    })
                  }
                  className={`block h-16 w-full overflow-hidden rounded-lg border ${
                    selected ? "border-accent" : "border-line-strong"
                  }`}
                >
                  {href === undefined ? null : (
                    // biome-ignore lint/performance/noImgElement: the picture is a blob on this device, which the image optimiser cannot fetch
                    <img src={href} alt="" className="size-full object-cover" />
                  )}
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${picture.name}`}
                  onClick={() => {
                    void deletePicture(picture.source).then(async () => {
                      setPictures(await listPictures());
                      if (selected) {
                        onChoose(null);
                      }
                    });
                  }}
                  className="absolute top-1 right-1 rounded-md bg-void/70 p-1 text-faint transition-colors hover:text-danger"
                >
                  <Trash2 className="size-3" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {image === null ? null : (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
          <div className="sm:w-1/2">
            <p className="mb-1 px-2 font-mono text-[0.7rem] text-muted">
              How it will look
            </p>
            {preview === null ? null : (
              <div className="overflow-hidden rounded-lg border border-line-strong">
                <Preview key={previewKey} source={preview} />
              </div>
            )}
          </div>
          <div className="flex flex-1 flex-col gap-2">
            <p className="px-2 font-mono text-[0.7rem] text-muted">
              Brightness
            </p>
            <SliderRow
              ariaLabel="Background brightness percent"
              min={backdropBrightness.min}
              max={backdropBrightness.max}
              step={5}
              value={image.brightness}
              valueText={`${image.brightness}%`}
              onChange={(brightness) => shape({ brightness })}
            />
            <Toggle
              label="Travel with the notes"
              checked={image.scroll}
              onChange={(scroll) => shape({ scroll })}
              tip="Tiles the picture and moves it with the notes, so it travels while the song plays and stops when it does."
            />
          </div>
        </div>
      )}
    </section>
  );
}
