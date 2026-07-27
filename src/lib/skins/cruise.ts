import { nebulaSource } from "@/lib/skins/fullscreen";
import { Planets } from "@/lib/skins/planets";
import { RockField } from "@/lib/skins/rubble";
import { defineSkin, type SceneView } from "@/lib/skins/scene";

/** Dimmer than the still field, because streaking stars are already carrying
 * the eye and the notes still have to win. */
const nebulaGain = 0.5;

/** Stars are held in a space with depth and projected, so they spread out of
 * the point being travelled toward and streak more the nearer they come. A
 * column of falling lines reads as rain; this reads as motion. */
const starCount = 200;
/** How fast depth is eaten. The whole field crosses in a few seconds. */
const approach = 0.55;
const nearest = 0.06;

/** Real starlight is not white. A few warm and blue ones stop the field looking
 * like static. */
const starColours = [
  "#ffffff",
  "#dce8ff",
  "#bcd4ff",
  "#ffe9c8",
  "#ffd3a8",
] as const;

type Star = {
  /** Direction from the vanishing point, before depth is applied. */
  x: number;
  y: number;
  z: number;
  color: string;
  twinkle: number;
};

function place(star: Star, fresh: boolean): void {
  star.x = (Math.random() - 0.5) * 2.4;
  star.y = (Math.random() - 0.5) * 2.4;
  star.z = fresh ? Math.random() : 1;
  star.color =
    starColours[Math.floor(Math.random() * starColours.length)] ?? "#ffffff";
  star.twinkle = Math.random() * Math.PI * 2;
}

function seed(): Star[] {
  const stars: Star[] = [];
  for (let count = 0; count < starCount; count += 1) {
    const star: Star = { x: 0, y: 0, z: 1, color: "#ffffff", twinkle: 0 };
    place(star, true);
    stars.push(star);
  }
  return stars;
}

/** Travelling toward the top of the roll, so the field spreads out of a point
 * above it and pours down past the keys. */
function vanishing(view: SceneView): { x: number; y: number; reach: number } {
  return {
    x: view.width / 2,
    y: -view.height * 0.25,
    reach: Math.max(view.width, view.height),
  };
}

export const cruise = defineSkin({
  id: "cruise",
  name: "Cruising",
  blurb:
    "The keys fly through space. Stars streak past, a world drifts by now and then, and the rocks your notes reach break apart.",
  shader: { source: nebulaSource(0.06), gain: nebulaGain },

  createScene() {
    const stars = seed();
    const planets = new Planets();
    const field = new RockField({
      max: 9,
      rate: 1.2,
      smallest: 13,
      largest: 30,
    });

    return {
      paint(ctx, view, frame, step) {
        const away = vanishing(view);
        // Furthest thing out there, so everything else is drawn over it.
        planets.paint(ctx, view, away, step);

        for (const star of stars) {
          const was = star.z;
          star.z -= approach * step;
          if (star.z <= nearest) {
            place(star, false);
            continue;
          }
          const x = away.x + (star.x / star.z) * away.reach * 0.5;
          const y = away.y + (star.y / star.z) * away.reach * 0.5;
          if (y > frame.keyboardTop + 40 || x < -60 || x > view.width + 60) {
            continue;
          }
          const wasX = away.x + (star.x / was) * away.reach * 0.5;
          const wasY = away.y + (star.y / was) * away.reach * 0.5;
          const closeness = 1 - star.z;
          const shine =
            (0.25 + closeness * 0.75) *
            (0.75 + 0.25 * Math.sin(frame.elapsed * 3 + star.twinkle));

          ctx.globalAlpha = Math.min(1, shine);
          ctx.strokeStyle = star.color;
          ctx.lineWidth = 0.5 + closeness * 2.1;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(wasX, wasY);
          ctx.lineTo(x, y);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.lineCap = "butt";

        field.paint(ctx, view.width, view.height, step, frame);
      },
    };
  },
});
