import type { Point } from "@worldbend/web";

export interface FitLandmarkCopy {
  fitCorners: string;
  fitAutomatic: string;
  fitPerimeter: string;
  fitCornerNames: readonly [string, string, string, string];
}

/** The core supplies perimeter fractions and projected corners. These controls
 * only author the four correspondences; they do not recreate boundary geometry. */
export function createFitLandmarkControls(input: {
  inspector: HTMLElement;
  preview: HTMLElement;
  canvas: HTMLCanvasElement;
  copy(): FitLandmarkCopy;
  commit(positions: [number, number, number, number] | undefined): void;
}) {
  const panel = document.createElement("fieldset");
  panel.dataset.role = "fit-corners";
  panel.hidden = true;
  panel.style.cssText = "border:0;padding:0;margin:12px 0;min-width:0";
  const legend = document.createElement("legend");
  const automatic = document.createElement("button");
  automatic.type = "button"; automatic.dataset.role = "fit-automatic";
  const fields = Array.from({ length: 4 }, (_, index) => {
    const label = document.createElement("label"); label.className = "designer-field";
    const name = document.createElement("span");
    const row = document.createElement("span"); row.className = "designer-row"; row.style.gridTemplateColumns = "minmax(0,1fr) 76px";
    const range = document.createElement("input"); range.type = "range";
    range.min = "0"; range.max = "99.99"; range.step = "0.1";
    const number = document.createElement("input"); number.type = "number";
    number.min = "0"; number.max = "99.99"; number.step = "0.1";
    number.dataset.role = `fit-position-${index}`;
    number.style.width = "76px";
    row.append(range, number); label.append(name, row); panel.append(label);
    const change = (field: HTMLInputElement) => {
      const value = Number(field.value);
      if (field.value.trim() === "" || !Number.isFinite(value) || value < 0 || value >= 100) return;
      const positions = [...current] as [number, number, number, number];
      positions[index] = value / 100; input.commit(positions);
    };
    range.addEventListener("change", () => change(range));
    number.addEventListener("change", () => change(number));
    return { name, range, number };
  });
  panel.prepend(legend); panel.append(automatic); input.inspector.prepend(panel);
  const markers = fields.map((field, index) => {
    const marker = document.createElement("button"); marker.type = "button";
    marker.dataset.role = `fit-marker-${index}`; marker.hidden = true;
    marker.style.cssText = "position:absolute;transform:translate(-50%,-50%);width:26px;height:24px;padding:0;border-radius:6px;border:1px solid #17675c;background:#dbfbf3;color:#104b43;font:600 10px system-ui;z-index:4";
    marker.textContent = ["TL", "TR", "BR", "BL"][index]!;
    marker.addEventListener("click", () => field.number.focus());
    input.preview.append(marker); return marker;
  });
  let current: readonly number[] = [0, .25, .5, .75];
  let points: readonly Point[] | undefined;
  automatic.addEventListener("click", () => input.commit(undefined));
  function refresh() {
    const canvas = input.canvas.getBoundingClientRect(), host = input.preview.getBoundingClientRect();
    markers.forEach((marker, index) => {
      const point = points?.[index];
      marker.hidden = panel.hidden || !point;
      if (!point) return;
      marker.style.left = `${canvas.left - host.left + point.x * canvas.width}px`;
      marker.style.top = `${canvas.top - host.top + point.y * canvas.height}px`;
    });
  }
  return {
    update(positions: readonly number[] | undefined, projected: readonly Point[] | undefined, disabled: boolean) {
      panel.hidden = !positions;
      if (positions) current = positions;
      points = projected;
      const copy = input.copy(); legend.textContent = copy.fitCorners;
      panel.title = copy.fitPerimeter; automatic.textContent = copy.fitAutomatic;
      automatic.disabled = disabled;
      fields.forEach((field, index) => {
        field.name.textContent = `${copy.fitCornerNames[index]} (%)`;
        field.range.setAttribute("aria-label", copy.fitCornerNames[index]!);
        field.number.setAttribute("aria-label", `${copy.fitCornerNames[index]} (%)`);
        field.number.title = field.range.title = copy.fitPerimeter;
        field.range.disabled = field.number.disabled = disabled;
        field.range.value = String(current[index]! * 100);
        field.number.value = String(Math.round(current[index]! * 10000) / 100);
        markers[index]!.disabled = disabled;
        markers[index]!.setAttribute("aria-label", copy.fitCornerNames[index]!);
      });
      refresh();
    },
    refresh,
  };
}
