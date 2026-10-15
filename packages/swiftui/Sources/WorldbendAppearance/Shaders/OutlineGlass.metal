#include <metal_stdlib>
using namespace metal;

// Outline / SetupArc-class optical glass. Samples a baked normal-field texture
// (rgba16: distance, nx, ny, insideMask) plus an APP-published source frame.
// APP owns the contour polyline; Worldbend owns normals and optics.

struct WorldbendOutlineOpticalUniforms {
    float4 paneFrame;       // logical points: x, y, w, h
    float4 contentRect;     // logical points
    float2 logicalSize;     // field / scene canvas
    float2 drawableSize;    // pane pixels
    float2 fieldOrigin;     // field texel(0,0) corner in field space
    float2 fieldCellSize;   // logical points per texel (xy equal)
    float2 fieldTexelSize;  // width, height in texels
    float fieldSpacePaneLocal; // 1 = pane-local (subtract paneFrame.xy); 0 = scene
    float edgeWidth;
    float refractionScale;
    float chromaticOffset;
    float2 lightDirection;
    float highlightStrength;
    float frostRadius;
    float frostLod;         // mip LOD for frost > 2pt (0 = full-res)
};

struct WorldbendOutlineOpticalVertexOut {
    float4 position [[position]];
    float2 panePixel;
};

vertex WorldbendOutlineOpticalVertexOut worldbendOutlineOpticalVertex(
    uint vid [[vertex_id]],
    constant WorldbendOutlineOpticalUniforms& u [[buffer(0)]]
) {
    float2 positions[3] = {
        float2(-1.0, -1.0),
        float2( 3.0, -1.0),
        float2(-1.0,  3.0)
    };
    float2 clip = positions[vid];
    WorldbendOutlineOpticalVertexOut out;
    out.position = float4(clip, 0.0, 1.0);
    float2 uv = float2(clip.x * 0.5 + 0.5, 0.5 - clip.y * 0.5);
    out.panePixel = uv * u.drawableSize;
    return out;
}

static float2 logicalFromPanePixel(float2 panePixel, constant WorldbendOutlineOpticalUniforms& u) {
    float2 scale = float2(
        u.paneFrame.z / max(u.drawableSize.x, 1.0),
        u.paneFrame.w / max(u.drawableSize.y, 1.0)
    );
    return u.paneFrame.xy + panePixel * scale;
}

static float2 textureUV(float2 logical, constant WorldbendOutlineOpticalUniforms& u) {
    return (logical - u.contentRect.xy) / max(u.contentRect.zw, float2(0.0001));
}

static half4 sampleSource(
    texture2d<half> source,
    sampler samp,
    float2 logical,
    constant WorldbendOutlineOpticalUniforms& u,
    float frost
) {
    float2 uv = textureUV(logical, u);
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
        return half4(0.0);
    }
    if (frost <= 0.001) {
        return source.sample(samp, uv);
    }

    // frostRadius is logical points (same unit as SwiftUI `.blur(radius:)`),
    // mapped through contentRect — not raw texels — so @2x/@3x hosts match
    // layerEffect strength.
    //
    // Small frost (≤2pt, includes 1.2pt clear buttons): keep the historical
    // 3×3 discrete kernel byte-for-byte so translucent button look is unchanged.
    // Large frost (~12–40pt menus): shared-frame mip pyramid at a *conservative*
    // LOD (prefilter only) + 7×7 Gaussian in UV spanning the frost radius.
    // Hardware mip_filter::linear blends adjacent levels. Not mip-only box
    // downsample, and not a residual step crushed by 1/exp2(lod).
    constexpr float kLegacyFrostMaxPt = 2.0;
    float2 uvStep = float2(frost) / max(u.contentRect.zw, float2(1.0));

    if (frost <= kLegacyFrostMaxPt) {
        half4 acc = half4(0.0);
        float weight = 0.0;
        for (int y = -1; y <= 1; ++y) {
            for (int x = -1; x <= 1; ++x) {
                float2 offset = float2(x, y) * uvStep;
                float2 s = uv + offset;
                if (s.x < 0.0 || s.y < 0.0 || s.x > 1.0 || s.y > 1.0) continue;
                float w = 1.0 - 0.25 * float(abs(x) + abs(y));
                acc += source.sample(samp, s) * half(w);
                weight += w;
            }
        }
        return weight > 0.0 ? acc / half(weight) : source.sample(samp, uv);
    }

    float lod = max(u.frostLod, 0.0);
    // Continuous Gaussian in UV matching SwiftUI `.blur(radius:)` ≈ σ in points.
    // Conservative mip LOD prefilters so outer taps do not alias on the sharp
    // source. Do NOT scale the step by 1/exp2(lod): that crushed the old 3×3
    // below one mip texel (mosaic / scenery too clear).
    float2 sigmaUV = float2(frost) / max(u.contentRect.zw, float2(1.0));
    // 7×7, tap-unit σ=1; gStep = σ_uv so physical σ matches frostRadius
    // (SwiftUI `.blur(radius:)`). ±3 taps cover ±3σ (outer weights tiny).
    float2 gStep = sigmaUV;
    constexpr float gw[7] = {
        0.00443305f, 0.05400558f, 0.24203623f, 0.39905028f,
        0.24203623f, 0.05400558f, 0.00443305f
    };
    half4 acc = half4(0.0);
    float weight = 0.0;
    for (int y = 0; y < 7; ++y) {
        for (int x = 0; x < 7; ++x) {
            float2 s = uv + float2(float(x - 3), float(y - 3)) * gStep;
            if (s.x < 0.0 || s.y < 0.0 || s.x > 1.0 || s.y > 1.0) continue;
            float w = gw[x] * gw[y];
            // level(lod) + mip_filter::linear blends adjacent mips.
            acc += source.sample(samp, s, level(lod)) * half(w);
            weight += w;
        }
    }
    return weight > 0.0 ? acc / half(weight) : source.sample(samp, uv, level(lod));
}

static float4 sampleField(
    texture2d<float> field,
    sampler samp,
    float2 logical,
    constant WorldbendOutlineOpticalUniforms& u
) {
    // Bake stores texel i at logical center ((i+0.5)*cell). Metal UV for that
    // center is (i+0.5)/texelCount = logical/(cell*texelCount). Do **not** add
    // another +0.5 — that shifts the field by half a texel and misaligns the
    // ±0.5pt coverage band when cellSize is ~2pt.
    //
    // Pane-local fields are authored in Shape.path space. Subtract paneFrame.xy
    // so translating the control does not require rebake / global polylines.
    float2 sampleLogical = logical;
    if (u.fieldSpacePaneLocal > 0.5) {
        sampleLogical = logical - u.paneFrame.xy;
    }
    float2 local = sampleLogical - u.fieldOrigin;
    float2 uv = local / max(u.fieldCellSize * u.fieldTexelSize, float2(0.0001));
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
        // Outside the baked field → treat as exterior.
        return float4(1.0, 0.0, -1.0, 0.0);
    }
    return field.sample(samp, uv);
}

fragment half4 worldbendOutlineOpticalFragment(
    WorldbendOutlineOpticalVertexOut in [[stage_in]],
    constant WorldbendOutlineOpticalUniforms& u [[buffer(0)]],
    texture2d<half> source [[texture(0)]],
    texture2d<float> field [[texture(1)]]
) {
    constexpr sampler samp(address::clamp_to_edge, filter::linear, mip_filter::linear);
    float2 logical = logicalFromPanePixel(in.panePixel, u);
    float4 f = sampleField(field, samp, logical, u);
    float distance = f.x;
    float2 normal = float2(f.y, f.z);
    float nLen = length(normal);
    if (nLen > 1e-5) normal /= nLen;
    else normal = float2(0.0, -1.0);

    // Soft coverage at the contour; exterior clears.
    if (distance > 0.5) return half4(0.0);
    float width = max(u.edgeWidth, 0.001);
    float rim = smoothstep(0.0, 1.0, 1.0 + distance / width);
    float2 offset = -normal * rim * u.refractionScale;
    float2 split = normal * rim * u.chromaticOffset;

    half4 green = sampleSource(source, samp, logical + offset, u, u.frostRadius);
    half4 red = sampleSource(source, samp, logical + offset + split, u, u.frostRadius);
    half4 blue = sampleSource(source, samp, logical + offset - split, u, u.frostRadius);
    half alpha = max(green.a, max(red.a, blue.a));
    half3 color = half3(red.r, green.g, blue.b);
    float facing = dot(normal, u.lightDirection);
    float light = max(0.0, facing) + 0.24 * max(0.0, -facing);
    float highlight = u.highlightStrength * (
        (0.3 + 0.7 * light) * pow(rim, 8.0) + 0.16 * light * pow(rim, 2.0));
    color = mix(color, half3(alpha), half(highlight));
    half coverage = half(1.0 - smoothstep(-0.5, 0.5, distance));
    return half4(color, alpha) * coverage;
}
