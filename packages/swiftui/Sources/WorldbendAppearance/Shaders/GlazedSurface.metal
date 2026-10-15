#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// Microfacet clear-coat BRDF adapted to Metal from Google Filament:
// shaders/src/surface_brdf.fs, 764fe6cac9bdb4ba24d3d852344dfa04a5f70f75.
// Apache-2.0; license and attribution ship in Licenses/Filament-LICENSE.txt.
// Modified: scalar Metal functions, bounded mask normals, fixed studio light.
// This is a 2.5D receiving surface, not the Filament engine or environment IBL.
float wbGlazeGGX(float roughness, float NoH) {
    float a = NoH * roughness;
    float k = min(roughness / max(0.00001, 1.0 - NoH * NoH + a * a), 453.5);
    return k * (k / M_PI_F);
}
float wbGlazeKelemen(float LoH) { return 0.25 / max(LoH * LoH, 0.0000039); }
float wbGlazeSchlick(float f0, float VoH) { return f0 + (1.0 - f0) * pow(1.0 - VoH, 5.0); }

[[ stitchable ]] half4 worldbendGlazedSurface(
    float2 position, SwiftUI::Layer layer, float2 size, half4 reflection,
    float bevel, float coat, float roughness, float curvature, float pooling, float coverage, float contact
) {
    half4 body = layer.sample(position);
    if (body.a <= 0.001h || min(size.x, size.y) < 1.0) return body;
    float2 uv = position / size, p = uv * 2.0 - 1.0;
    // Average successive mask samples: a turned, curved edge rather than an
    // abrupt grey extrusion. Alpha silhouette and foreground remain unchanged.
    float l = 0, r = 0, t = 0, b = 0;
    for (int i = 1; i <= 4; ++i) {
        float d = bevel * float(i) / 4.0;
        l += float(layer.sample(position - float2(d, 0)).a) * 0.25;
        r += float(layer.sample(position + float2(d, 0)).a) * 0.25;
        t += float(layer.sample(position - float2(0, d)).a) * 0.25;
        b += float(layer.sample(position + float2(0, d)).a) * 0.25;
    }
    float rim = saturate(1.0 - min(min(l, r), min(t, b)));
    float3 N = normalize(float3((l - r) * 1.3 + p.x * curvature * 0.24,
        (t - b) * 1.3 + p.y * curvature * 0.34 + contact * 0.045, 1.0));
    float3 V = float3(0, 0, 1);
    float3 L = normalize(float3(-0.45, -0.65, 1.4)), H = normalize(V + L);
    float NoL = saturate(dot(N, L)), NoH = saturate(dot(N, H)), LoH = saturate(dot(L, H));
    float NoV = saturate(N.z);
    float F = wbGlazeSchlick(0.04, LoH);
    float specular = wbGlazeGGX(max(0.025, roughness * roughness), NoH) * wbGlazeKelemen(LoH) * F * NoL;
    float3 base = float3(body.rgb) / max(float(body.a), 0.001);
    // Neutral dielectric body; the clear-coat BRDF is independent of coverage.
    base *= 0.77 + 0.19 * NoL - pooling * rim * (0.3 + 0.4 * uv.y);
    float3 R = reflect(-V, N);
    float2 plane = R.xy / max(0.25, R.z);
    float feather = 0.045 + roughness * 0.22;
    float2 window = 1.0 - smoothstep(float2(0.28, 0.13), float2(0.28, 0.13) + feather,
        abs(plane - float2(-0.36, -0.52)));
    float reflected = window.x * window.y;
    float coatF = wbGlazeSchlick(0.04, NoV);
    // Fixed luminous studio window + direct specular. The studio fixture is
    // explicit; actual scene-constrained environment reflection is not claimed.
    float3 lit = base * (1.0 - coat * coatF) + float3(reflection.rgb) * coat
        * (min(specular, 1.0) * 0.5 + reflected * coatF * 2.4);
    float coatCoverage = saturate(coat * (coatF + min(specular, 1.0) * 0.08 + reflected * coatF));
    half alpha = body.a * half(coverage + (1.0 - coverage) * coatCoverage);
    return half4(half3(saturate(lit)) * alpha, alpha);
}
