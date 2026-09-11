import { afterEach, describe, expect, it, vi } from "vitest";
import { loadNativeRenderer } from "./native-document";
import { BUNDLED_NATIVE_RENDERER, NATIVE_EFFECT_LISTING_URL } from "./native-renderer";

const definitions = Object.fromEntries([
  "h00", "h01", "h02", "h10", "h11", "h12", "h20", "h21", "h22", "sourceRight", "sourceBottom",
].map((name, i) => [`property-${i}`, { name, type: "NUMBER" }]));
function setup(override = "") {
  const page = { id: "page", getSharedPluginData: () => override } as unknown as PageNode;
  const importShaderById = vi.fn(async (id: string) => ({ id, type: "effect", propertyDefinitions: definitions }));
  vi.stubGlobal("figma", { importShaderById });
  return { page, importShaderById };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("distributed editable renderer", () => {
  it("exposes the companion-effect listing URL for in-plugin copy", () => {
    expect(NATIVE_EFFECT_LISTING_URL).toBe("https://www.figma.com/community/shader/1679431734495527701");
  });

  it("bounds a stalled import and allows a new request without a late failure evicting it", async () => {
    vi.useFakeTimers();
    const h = setup();
    let rejectOld!: (reason: Error) => void;
    h.importShaderById.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }));
    const stalled = loadNativeRenderer(h.page);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await stalled).toBeUndefined();
    expect((await loadNativeRenderer(h.page))?.id).toBe(BUNDLED_NATIVE_RENDERER);
    rejectOld(new Error("Late host failure"));
    await vi.advanceTimersByTimeAsync(0);
    expect((await loadNativeRenderer(h.page))?.id).toBe(BUNDLED_NATIVE_RENDERER);
    expect(h.importShaderById).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("imports the bundled version without document setup and caches only the current host/page", async () => {
    const h = setup();
    expect((await loadNativeRenderer(h.page))?.id).toBe(BUNDLED_NATIVE_RENDERER);
    await loadNativeRenderer(h.page);
    expect(h.importShaderById).toHaveBeenCalledTimes(1);
    await loadNativeRenderer({ ...h.page, id: "another-page" } as PageNode);
    expect(h.importShaderById).toHaveBeenCalledTimes(2);
  });

  it("keeps a retained version ahead of the current page or bundled version", async () => {
    const h = setup(JSON.stringify({ schema: "worldbend.figma.projective-sampler", version: "0.1", id: `trial/${"b".repeat(40)}` }));
    const retained = `retained/${"c".repeat(40)}`;
    expect((await loadNativeRenderer(h.page, retained))?.id).toBe(retained);
    expect(h.importShaderById).toHaveBeenCalledWith(retained);
  });

  it.each([
    ["25fbd473-a6d4-4978-9dac-0a679d35fbad", "4bd7b3ab188e9447b9459d8ecc2f2ba4c8f035b7", "28a52aefe26125f1b8b4d8c221c5b668466c81d9"],
    ["20eff4c7-e099-4bf2-937b-1d83305c0851", "d5d769a7aecb88b7fe06550eaad56dd603840634", "610eb52f8eeb4810422bf37b504129cf83efa355"],
  ])("recognizes the observed resource-hash alias for %s without changing its build", async (resource, hash, build) => {
    const h = setup();
    const retained = `${hash}/${build}`;
    expect((await loadNativeRenderer(h.page, retained))?.id).toBe(`${resource}/${build}`);
    expect(h.importShaderById).toHaveBeenCalledWith(`${resource}/${build}`);
  });

  it("rejects an unexpected build or changed schema, then retries after availability changes", async () => {
    const h = setup();
    h.importShaderById.mockResolvedValueOnce({ id: `other/${"d".repeat(40)}`, type: "effect", propertyDefinitions: definitions });
    expect(await loadNativeRenderer(h.page)).toBeUndefined();
    h.importShaderById.mockResolvedValueOnce({ id: BUNDLED_NATIVE_RENDERER, type: "effect", propertyDefinitions: {} });
    expect(await loadNativeRenderer(h.page)).toBeUndefined();
    h.importShaderById.mockRejectedValueOnce(new Error("Install effect first"));
    expect(await loadNativeRenderer(h.page)).toBeUndefined();
    expect((await loadNativeRenderer(h.page))?.id).toBe(BUNDLED_NATIVE_RENDERER);
  });

  it("repairs the known alpha build for an explicit publication without changing other retained builds", async () => {
    const h = setup();
    const legacy = "4bd7b3ab188e9447b9459d8ecc2f2ba4c8f035b7/28a52aefe26125f1b8b4d8c221c5b668466c81d9";
    expect((await loadNativeRenderer(h.page, legacy, "publish"))?.id).toBe(BUNDLED_NATIVE_RENDERER);
    const other = `25fbd473-a6d4-4978-9dac-0a679d35fbad/${"e".repeat(40)}`;
    expect((await loadNativeRenderer(h.page, other, "publish"))?.id).toBe(other);
  });

  it("does not silently publish the defective alpha build when its repair is unavailable", async () => {
    const h = setup();
    h.importShaderById.mockRejectedValueOnce(new Error("Unavailable"));
    const legacy = "25fbd473-a6d4-4978-9dac-0a679d35fbad/28a52aefe26125f1b8b4d8c221c5b668466c81d9";
    expect(await loadNativeRenderer(h.page, legacy, "publish")).toBeUndefined();
    expect(h.importShaderById).toHaveBeenCalledExactlyOnceWith(BUNDLED_NATIVE_RENDERER);
  });

  it("leaves raster output available on hosts without the shader API", async () => {
    const { page } = setup();
    vi.stubGlobal("figma", {});
    expect(await loadNativeRenderer(page)).toBeUndefined();
  });
});
