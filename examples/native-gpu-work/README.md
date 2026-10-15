# Chromatic Tide: native GPU source and Metal optical receiving

Original analytic colour/contour field sampled at absolute time. The host owns
parameters, geometry, clock and actions. It creates a guarded
`WorldbendMetalFrameProducer` over the existing FrameHub; fresh immutable Metal
textures publish only after GPU completion. The existing Metal optical scene
samples that source without UIImage/PNG materialization. This is a frame carrier
and coherent optical example, not a particle engine or realtime3D claim.

The source retains Metal code, editable parameters/seed42, the canonical optical
receipt and source identity. Parameters/time/size reproduce on the same GPU;
floating-point shader differences across devices are not bit-exact guarantees.
Native drawing uses actual window displayScale and absolute elapsed time. A
preferred refresh rate is a request; submit, complete and drawable presentation
metrics remain separate. Physical-device thermal/power/60fps acceptance is not
established by Simulator or offline rendering.

The macOS proof entry takes `--output <new-empty-folder>` and
`--optical-library <compiled-owned-MetalOpticalGlass.metallib>`. It produces
1170×1560 PNG frames using the actual source and optical shader, at390×520 logical
points. The chosen export scale is explicit; it is not a fixed native pixel
density. This proof/export route performs disclosed GPU readback and PNG writing;
the production source/optical views do not. Encode saved frames independently.

BGRA8 is encoded-sRGB premultiplied/opaque SDR. The optionalRGBA16Float source
stores extended *encoded* sRGB range and retains values above1 in the completed
carrier. Existing optical surfaces are8-bitSDR, so they clip that range; there is
no hidden tone map, EDR presentation or linear-light/P3 producer claim. Alpha is
explicit, with underlying native composition retained. Other transfer/color
profiles need their own conversion and acceptance.
