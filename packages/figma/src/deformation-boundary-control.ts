export interface DeformationBoundaryCopy {
  boundaryLabel: string;
  boundaryFixed: string;
  boundaryFree: string;
}

/** Both deformation views choose the same saved core boundary policy. */
export function createDeformationBoundaryControl(input: {
  inspector: HTMLElement;
  copy(): DeformationBoundaryCopy;
  change(boundary: "fixed" | "free"): void;
}) {
  const label = document.createElement("label");
  label.className = "designer-field";
  const title = document.createElement("span");
  const select = document.createElement("select");
  select.dataset.role = "deformation-boundary";
  for (const value of ["fixed", "free"] as const) {
    const option = document.createElement("option");
    option.value = value;
    select.append(option);
  }
  label.append(title, select);
  input.inspector.prepend(label);
  select.addEventListener("change", () => input.change(select.value === "free" ? "free" : "fixed"));
  return {
    update(boundary: "fixed" | "free" | undefined, disabled: boolean) {
      const copy = input.copy();
      title.textContent = copy.boundaryLabel;
      select.options[0]!.textContent = copy.boundaryFixed;
      select.options[1]!.textContent = copy.boundaryFree;
      select.value = boundary ?? "fixed";
      select.disabled = disabled;
    },
  };
}
