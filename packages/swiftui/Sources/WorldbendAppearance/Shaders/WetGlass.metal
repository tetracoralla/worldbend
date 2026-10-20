#include <metal_stdlib>
using namespace metal;

// Wet-glass water-field / refraction composition adapted from Raindrop FX
// (SardineFish, MIT; see Licenses/RaindropFX-LICENSE.txt). Continuous height
// field supplies joined-drop normals. The host photograph / shared frame is
// the only colour source for window mode. Card-rim mode does not sample
// UIKit content.

struct WorldbendWetGlassViewUniforms {
    float2 viewSize;
    float cardMode;
    float padding;
};

struct WorldbendWetGlassOpticsUniforms {
    float normalStrength;
    float refractionBase;
    float refractionHeight;
    float specularPower;
    float specularGain;
    float diffuseGain;
    float diffuseReference;
    float rimShadeGain;
    float coverageMin;
    float coverageMax;
    float edgeSafety;
    float occlusionProbes;
    float surfaceLightX;
    float surfaceLightY;
    float surfaceLightZ;
    float cardLightX;
    float cardLightY;
    float cardGleamGain;
    float cardShadeGain;
    float padding;
};

struct WorldbendWetGlassWaterVertexOut {
    float4 position [[position]];
    float2 local;
};

struct WorldbendWetGlassFullscreenOut {
    float4 position [[position]];
    float2 uv;
};

vertex WorldbendWetGlassWaterVertexOut worldbendWetGlassWaterVertex(
    uint vid [[vertex_id]],
    constant float4* drops [[buffer(0)]],
    constant WorldbendWetGlassViewUniforms& u [[buffer(1)]]
) {
    float4 drop = drops[vid / 6u];
    float2 corner = float2((vid % 6u == 1u || vid % 6u == 4u || vid % 6u == 5u) ? 1.0f : -1.0f,
                           (vid % 6u == 2u || vid % 6u == 3u || vid % 6u == 5u) ? 1.0f : -1.0f);
    float2 pixel = drop.xy + corner * drop.zw;
    float2 ndc = float2(pixel.x / u.viewSize.x * 2.0f - 1.0f,
                        1.0f - pixel.y / u.viewSize.y * 2.0f);
    WorldbendWetGlassWaterVertexOut out;
    out.position = float4(ndc, 0, 1);
    out.local = corner;
    return out;
}

fragment half worldbendWetGlassWaterFragment(WorldbendWetGlassWaterVertexOut in [[stage_in]]) {
    float2 q = in.local;
    q.x /= mix(0.78f, 1.0f, smoothstep(-1.0f, 0.25f, q.y));
    float cap = max(0.0f, 1.0f - dot(q, q));
    return half(cap * cap);
}

vertex WorldbendWetGlassFullscreenOut worldbendWetGlassFullscreenVertex(uint vid [[vertex_id]]) {
    float2 uv = float2(vid == 1u ? 2.0f : 0.0f, vid == 2u ? 2.0f : 0.0f);
    WorldbendWetGlassFullscreenOut out;
    out.position = float4(uv.x * 2.0f - 1.0f, 1.0f - uv.y * 2.0f, 0, 1);
    out.uv = uv;
    return out;
}

fragment half4 worldbendWetGlassPhotoFragment(
    WorldbendWetGlassFullscreenOut in [[stage_in]],
    texture2d<half> photo [[texture(0)]]
) {
    constexpr sampler image(filter::linear, address::clamp_to_edge);
    return photo.sample(image, in.uv);
}

fragment half4 worldbendWetGlassFragment(
    WorldbendWetGlassFullscreenOut in [[stage_in]],
    texture2d<half> photo [[texture(0)]],
    texture2d<float> mask [[texture(1)]],
    texture2d<half> water [[texture(2)]],
    constant WorldbendWetGlassViewUniforms& u [[buffer(1)]],
    constant WorldbendWetGlassOpticsUniforms& o [[buffer(2)]]
) {
    constexpr sampler lens(filter::linear, address::clamp_to_edge);
    float2 uv = in.uv;
    float2 size = max(u.viewSize, float2(1));
    float2 inset = max(o.edgeSafety, 0.0f) / size;
    float glass = mask.sample(lens, uv).r;
    glass = min(glass, mask.sample(lens, uv + float2(inset.x, 0)).r);
    glass = min(glass, mask.sample(lens, uv - float2(inset.x, 0)).r);
    glass = min(glass, mask.sample(lens, uv + float2(0, inset.y)).r);
    glass = min(glass, mask.sample(lens, uv - float2(0, inset.y)).r);
    if (glass < 0.5f) discard_fragment();

    float height = float(water.sample(lens, uv).r);
    float coverage = smoothstep(o.coverageMin, o.coverageMax, height);
    if (coverage < 0.01f) discard_fragment();

    float2 texel = 1.0f / float2(water.get_width(), water.get_height());
    float2 gradient = float2(
        float(water.sample(lens, uv + float2(texel.x, 0)).r) - float(water.sample(lens, uv - float2(texel.x, 0)).r),
        float(water.sample(lens, uv + float2(0, texel.y)).r) - float(water.sample(lens, uv - float2(0, texel.y)).r)
    ) / (2.0f * texel * size);
    float3 normal = normalize(float3(-gradient * o.normalStrength, 1.0f));

    if (u.cardMode > 0.5f) {
        float edge = min(1.0f, length(normal.xy) * 1.8f) * coverage;
        float lightSide = dot(normal.xy, normalize(float2(o.cardLightX, o.cardLightY)));
        float gleam = pow(max(0.0f, lightSide), 8.0f) * edge * o.cardGleamGain;
        float shade = max(0.0f, -lightSide) * edge * o.cardShadeGain;
        float alpha = gleam + shade;
        return half4(half3(gleam), half(alpha));
    }

    float2 offset = -normal.xy * (o.refractionBase + o.refractionHeight * min(height, 1.0f)) / size;
    float2 shifted = clamp(uv + offset, float2(0), float2(1));
    uint probes = (uint)clamp(o.occlusionProbes, 1.0f, 16.0f);
    for (uint i = 1; i <= probes; i++) {
        if (mask.sample(lens, mix(uv, shifted, float(i) / float(probes))).r < 0.5f) {
            shifted = uv;
            break;
        }
    }
    half3 colour = photo.sample(lens, shifted).rgb;
    float3 light = normalize(float3(o.surfaceLightX, o.surfaceLightY, o.surfaceLightZ));
    float diffuse = dot(normal, light);
    float specular = pow(max(0.0f, dot(normal, normalize(light + float3(0, 0, 1)))), o.specularPower);
    float rim = (1.0f - smoothstep(0.16f, 0.38f, height)) * o.rimShadeGain;
    colour = colour * half(1.0f - rim) + half((diffuse - o.diffuseReference) * o.diffuseGain + specular * o.specularGain);
    half alpha = half(coverage);
    return half4(max(colour, half3(0)) * alpha, alpha);
}
