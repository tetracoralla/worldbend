#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// Rounded surface optics over the explicitly bound backdrop. This is an
// approximation of Figma GLASS, not Apple's private optical implementation.
[[ stitchable ]] half4 worldbendRoundedGlass(
    float2 position, SwiftUI::Layer layer, float4 frame, float2 canvasSize,
    float cornerRadius, float edgeWidth, float refractionScale,
    float chromaticOffset, float2 lightDirection, float highlightStrength
) {
    float2 halfSize = frame.zw * 0.5;
    float2 p = position - frame.xy - halfSize;
    float2 q = abs(p) - halfSize + cornerRadius;
    float2 outside = max(q, 0.0);
    float distance = length(outside) + min(max(q.x, q.y), 0.0) - cornerRadius;
    if (distance > 0.5 || min(halfSize.x, halfSize.y) <= 0.0) return half4(0.0);
    float2 normal = length(outside) > 0.0001
        ? normalize(outside) * select(float2(-1.0), float2(1.0), p >= 0.0)
        : (q.x > q.y ? float2(p.x >= 0.0 ? 1.0 : -1.0, 0.0) : float2(0.0, p.y >= 0.0 ? 1.0 : -1.0));
    float width = min(edgeWidth, min(halfSize.x, halfSize.y));
    float rim = smoothstep(0.0, 1.0, 1.0 + distance / max(width, 0.001));
    float2 offset = -normal * rim * refractionScale;
    float2 split = normal * rim * chromaticOffset;
    float2 limit = max(float2(0.5), canvasSize - 0.5);
    half4 green = layer.sample(clamp(position + offset, float2(0.5), limit));
    half4 red = layer.sample(clamp(position + offset + split, float2(0.5), limit));
    half4 blue = layer.sample(clamp(position + offset - split, float2(0.5), limit));
    // Preserve premultiplied color and extended-gamut energy: components
    // may be negative or greater than alpha. Clamping them to [0, alpha]
    // can change even a neutral pane with wide-gamut artwork.
    // Each sampled channel is already premultiplied; retain that energy and
    // choose coverage containing all three samples, including transparency.
    half alpha = max(green.a, max(red.a, blue.a));
    half3 color = half3(red.r, green.g, blue.b);
    float facing = dot(normal, lightDirection);
    float light = max(0.0, facing) + 0.24 * max(0.0, -facing);
    float highlight = highlightStrength * (
        (0.3 + 0.7 * light) * pow(rim, 8.0) + 0.16 * light * pow(rim, 2.0));
    color = mix(color, half3(alpha), half(highlight));
    half coverage = half(1.0 - smoothstep(-0.5, 0.5, distance));
    return half4(color, alpha) * coverage;
}
