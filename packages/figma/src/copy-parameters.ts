/**
 * Human-facing export of the canonical placement document. The plugin iframe
 * may deny the async clipboard API, so a synchronous editable-host fallback
 * keeps the action available in Figma Desktop.
 */

export function placementParametersJson(spec: unknown): string {
  return JSON.stringify(spec, null, 2);
}

export interface CopyTextArea {
  value: string;
  style: Record<string, string>;
  setAttribute(name: string, value: string): void;
  select(): void;
  remove(): void;
}

export interface CopyHost {
  readonly navigator?: {
    readonly clipboard?: {
      writeText?(text: string): Promise<void>;
    };
  };
  readonly document?: {
    createElement(tagName: "textarea"): CopyTextArea;
    body: { append(node: unknown): void };
    execCommand(command: "copy"): boolean;
  };
}

export async function copyPlacementParameters(text: string, host: CopyHost = globalThis): Promise<boolean> {
  const writeText = host.navigator?.clipboard?.writeText?.bind(host.navigator.clipboard);
  if (writeText) {
    try {
      await writeText(text);
      return true;
    } catch {
      // Fall through to the synchronous fallback below.
    }
  }
  const area = tryCreateFallbackArea(host);
  if (!area) return false;
  try {
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    host.document?.body.append(area);
    area.select();
    return host.document?.execCommand("copy") ?? false;
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

function tryCreateFallbackArea(host: CopyHost): CopyTextArea | undefined {
  try {
    return host.document?.createElement("textarea");
  } catch {
    return undefined;
  }
}
