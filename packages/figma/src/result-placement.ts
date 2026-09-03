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
  const rowX =
    Math.max(...occupied.map((placement) => placement.x + placement.width)) + RESULT_PLACEMENT_GAP;
  const stepLimit = output.width + 2 * RESULT_PLACEMENT_GAP;
  let x = rowX;
  for (;;) {
    const collisions = obstacles.filter((placement) =>
      x < placement.x + placement.width &&
      x + output.width > placement.x &&
      y < placement.y + placement.height &&
      y + output.height > placement.y
    );
    if (collisions.length === 0) return { ...output, x, y };
    const nextX =
      Math.min(...collisions.map((placement) => placement.x + placement.width)) +
      RESULT_PLACEMENT_GAP;
    if (
      collisions.some((placement) => placement.width > stepLimit) ||
      nextX - rowX > stepLimit
    ) {
      y = Math.max(...collisions.map((placement) => placement.y + placement.height)) + RESULT_PLACEMENT_GAP;
      x = rowX;
    } else {
      x = nextX;
    }
  }
}
