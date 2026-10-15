import { describe, expect, it } from "vitest";
import { nativeFrameAvailability } from "./native-frame-availability";

describe("native frame publication availability", () => {
  const base = { renderer: false, rendererPending: false, corePending: false, legacyTarget: false };
  it("publishes an affine frame without installing a sampler, even during unrelated discovery", () => {
    expect(nativeFrameAvailability({...base,coreKind:"affine",rendererPending:true})).toEqual({supported:true,preparing:false});
  });
  it("keeps projective discovery separate from confirmed unavailability", () => {
    expect(nativeFrameAvailability({...base,coreKind:"projective",rendererPending:true})).toEqual({supported:false,preparing:true});
    expect(nativeFrameAvailability({...base,coreKind:"projective"})).toEqual({supported:false,preparing:false});
    expect(nativeFrameAvailability({...base,coreKind:"projective",renderer:true})).toEqual({supported:true,preparing:false});
  });
  it("retains the existing sampled carrier until it is explicitly migrated", () => {
    expect(nativeFrameAvailability({...base,coreKind:"affine",legacyTarget:true})).toEqual({supported:false,preparing:false});
  });
  it("does not leave failed core planning in a perpetual preparing state", () => {
    expect(nativeFrameAvailability(base)).toEqual({supported:false,preparing:false});
    expect(nativeFrameAvailability({...base,corePending:true})).toEqual({supported:false,preparing:true});
  });
});
