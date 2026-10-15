import type { Placement } from "./messages";

export const RESULT_PLACEMENT_GAP = 48;

/**
 * Place a newly published result beside every input that produced it.
 * Replacements deliberately bypass this helper so they remain in place.
 *
 * The candidate starts one gap right of the inputs' right edge, on the
 * inputs' top edge, and steps right across same-band content one obstacle
 * at a time. An obstacle, or cumulative horizontal detour, wider than the
 * output itself plus surrounding gaps is never stepped over: the candidate
 * drops below everything currently blocking the row and restarts from the
 * row origin. This lets a small nearby object shift the result slightly but
 * keeps wide frames and long result rows from sending it far from the inputs.
 * Before a tall blocker causes a long vertical detour, try the four nearby
 * sides of the inputs. Prefer the closest free side; never overlap artwork.
 * Every step strictly advances x within a row, and every restart strictly
 * advances y past the blockers' bottom edge, so the walk terminates against
 * any finite obstacle set.
 */
export function placementBeside(
  occupied: readonly Placement[],
  output: Pick<Placement, "width" | "height">,
  obstacles: readonly Placement[] = occupied,
): Placement {
  if (occupied.length === 0) return { ...output, x: 0, y: 0 };
  let y = Math.min(...occupied.map((placement) => placement.y));
  const originY = y;
  const rowX =
    Math.max(...occupied.map((placement) => placement.x + placement.width)) + RESULT_PLACEMENT_GAP;
  const stepLimit = output.width + 2 * RESULT_PLACEMENT_GAP;
  let x = rowX;
  for (;;) {
    const collisions = obstacles.filter(placement => overlaps({ ...output, x, y }, placement));
    if (collisions.length === 0) return { ...output, x, y };
    const nextX =
      Math.min(...collisions.map((placement) => placement.x + placement.width)) +
      RESULT_PLACEMENT_GAP;
    if (
      collisions.some((placement) => placement.width > stepLimit) ||
      nextX - rowX > stepLimit
    ) {
      const nextY = Math.max(...collisions.map((placement) => placement.y + placement.height)) + RESULT_PLACEMENT_GAP;
      if (nextY - originY > output.height + 2 * RESULT_PLACEMENT_GAP) {
        const nearby = nearbyPlacement(occupied, output, obstacles, originY, rowX);
        if (nearby) return nearby;
      }
      y = nextY;
      x = rowX;
    } else {
      x = nextX;
    }
  }
}

function nearbyPlacement(
  inputs: readonly Placement[], output: Pick<Placement, "width" | "height">,
  obstacles: readonly Placement[], top: number, rowX: number,
): Placement | undefined {
  const left = Math.min(...inputs.map(p => p.x)), right = rowX - RESULT_PLACEMENT_GAP;
  const bottom = Math.max(...inputs.map(p => p.y + p.height));
  const centerX = (left + right - output.width) / 2, centerY = (top + bottom - output.height) / 2;
  const candidates = [
    { x: centerX, y: top - RESULT_PLACEMENT_GAP - output.height },
    { x: left - RESULT_PLACEMENT_GAP - output.width, y: centerY },
    { x: centerX, y: bottom + RESULT_PLACEMENT_GAP },
    { x: right + RESULT_PLACEMENT_GAP, y: centerY },
  ].map(p => ({ ...output, ...p }));
  const distance = (p: Placement) => Math.hypot(p.x - centerX, p.y - centerY);
  return candidates.filter(p => ![...inputs, ...obstacles].some(o => overlaps(p, o)))
    .sort((a, b) => distance(a) - distance(b))[0];
}

function overlaps(a: Placement, b: Placement): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x &&
    a.y < b.y + b.height && a.y + a.height > b.y;
}
