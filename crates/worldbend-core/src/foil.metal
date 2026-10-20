// Generated from foil.wgsl by Naga 30.0.1. Do not edit.
// Canonical source: sha256:ec9d71237d96c4d708f18e90e3449188ae73f4de620e8c58506de1c443fe8676
// language: metal2.4
#include <metal_stdlib>
#include <simd/simd.h>

using metal::uint;

struct Uniforms {
    metal::float4 frameData;
    metal::float4 outputDimsData;
    metal::float4 baseColor;
    metal::float4 highlightColor;
    metal::float4 surface;
    metal::float4 flags;
};
struct VsIn {
    metal::float2 pos;
    metal::float2 uv;
};
struct VsOut {
    metal::float4 position;
    metal::float2 uv;
    char _pad2[8];
};

float worldbend_foil_hash21_(
    metal::float2 p
) {
    metal::float2 q = {};
    q = metal::fract(p * metal::float2(123.34, 456.21));
    metal::float2 _e7 = q;
    metal::float2 _e8 = q;
    metal::float2 _e9 = q;
    q = _e7 + metal::float2(metal::dot(_e8, _e9 + metal::float2(45.32)));
    float _e17 = q.x;
    float _e19 = q.y;
    return metal::fract(_e17 * _e19);
}

float worldbend_foil_valueNoise(
    metal::float2 p_1
) {
    metal::float2 i_1 = metal::floor(p_1);
    metal::float2 f = metal::fract(p_1);
    metal::float2 t = ((f * f) * f) * ((f * ((f * 6.0) - metal::float2(15.0))) + metal::float2(10.0));
    float _e15 = worldbend_foil_hash21_(i_1);
    float _e20 = worldbend_foil_hash21_(i_1 + metal::float2(1.0, 0.0));
    float _e25 = worldbend_foil_hash21_(i_1 + metal::float2(0.0, 1.0));
    float _e30 = worldbend_foil_hash21_(i_1 + metal::float2(1.0, 1.0));
    return metal::mix(metal::mix(_e15, _e20, t.x), metal::mix(_e25, _e30, t.x), t.y);
}

float worldbend_foil_fbm(
    metal::float2 p_2
) {
    float value = 0.0;
    float amplitude = 0.5;
    metal::float2 point = {};
    int i = 0;
    point = p_2;
    uint2 loop_bound = uint2(4294967295u);
    bool loop_init = true;
    while(true) {
        if (metal::all(loop_bound == uint2(0u))) { break; }
        loop_bound -= uint2(loop_bound.y == 0u, 1u);
        if (!loop_init) {
            int _e28 = i;
            i = as_type<int>(as_type<uint>(_e28) + as_type<uint>(1));
        }
        loop_init = false;
        int _e8 = i;
        if (_e8 < 4) {
        } else {
            break;
        }
        {
            float _e11 = value;
            float _e12 = amplitude;
            metal::float2 _e13 = point;
            float _e14 = worldbend_foil_valueNoise(_e13);
            value = _e11 + (_e12 * _e14);
            metal::float2 _e17 = point;
            point = (_e17 * 2.03) + metal::float2(11.7, 9.2);
            float _e24 = amplitude;
            amplitude = _e24 * 0.5;
        }
    }
    float _e30 = value;
    return _e30;
}

struct worldbend_foil_vs_mainInput {
    metal::float2 pos [[attribute(0)]];
    metal::float2 uv [[attribute(1)]];
};
struct worldbend_foil_vs_mainOutput {
    metal::float4 position [[position]];
    metal::float2 uv [[user(loc0), center_perspective]];
};
vertex worldbend_foil_vs_mainOutput worldbend_foil_vs_main(
  worldbend_foil_vs_mainInput varyings [[stage_in]]
) {
    const VsIn in = { varyings.pos, varyings.uv };
    VsOut out = {};
    out.position = metal::float4(in.pos, 0.0, 1.0);
    out.uv = in.uv;
    VsOut _e9 = out;
    const auto _tmp = _e9;
    return worldbend_foil_vs_mainOutput { _tmp.position, _tmp.uv };
}


struct worldbend_foil_fs_mainInput {
    metal::float2 outputUv_in [[user(loc0), center_perspective]];
};
struct worldbend_foil_fs_mainOutput {
    metal::float4 member_1 [[color(0)]];
};
fragment worldbend_foil_fs_mainOutput worldbend_foil_fs_main(
  worldbend_foil_fs_mainInput varyings_1 [[stage_in]]
, constant Uniforms& u [[buffer(0)]]
) {
    const auto outputUv_in = varyings_1.outputUv_in;
    float _e4 = u.flags.x;
    if (_e4 < 0.5) {
        return worldbend_foil_fs_mainOutput { metal::float4(0.0) };
    }
    metal::float4 _e11 = u.outputDimsData;
    metal::float2 dims = metal::max(_e11.xy, metal::float2(1.0));
    float aspect = dims.x / metal::max(dims.y, 1.0);
    metal::float2 p_3 = metal::float2(outputUv_in.x * aspect, outputUv_in.y);
    float lightAngle = u.surface.x;
    float _e32 = u.surface.y;
    float intensity = metal::clamp(_e32, 0.0, 1.0);
    float _e39 = u.surface.z;
    float roughness = metal::clamp(_e39, 0.0, 1.0);
    float _e46 = u.surface.w;
    float flowSpeed = metal::max(_e46, 0.0);
    float _e52 = u.frameData.x;
    float flow = _e52 * flowSpeed;
    metal::float2 dir = metal::float2(metal::cos(lightAngle), metal::sin(lightAngle));
    float along = metal::dot(p_3, dir);
    float _e66 = worldbend_foil_fbm((p_3 * 3.0) + metal::float2(flow * 0.35, flow * 0.21));
    float warp = (_e66 - 0.5) * roughness;
    float phase = metal::fract(((along + (warp * 0.85)) * 2.4) - (flow * 0.28));
    float opening = metal::smoothstep(0.08, 0.1, phase);
    float face = (opening * (1.0 - metal::smoothstep(0.16, 0.86, phase))) * 0.75;
    float glint = metal::smoothstep(0.1, 0.14, phase) * (1.0 - metal::smoothstep(0.14, 0.152 + (roughness * 0.025), phase));
    float weight = intensity * metal::clamp(face + (glint * 0.7), 0.0, 1.0);
    float _e112 = u.baseColor.w;
    float _e116 = u.highlightColor.w;
    float alpha = metal::mix(_e112, _e116, weight);
    metal::float4 _e120 = u.baseColor;
    float _e125 = u.baseColor.w;
    metal::float4 _e129 = u.highlightColor;
    float _e134 = u.highlightColor.w;
    metal::float3 premultiplied = metal::mix(_e120.xyz * _e125, _e129.xyz * _e134, weight);
    float _e140 = u.flags.y;
    if (_e140 > 0.5) {
        return worldbend_foil_fs_mainOutput { metal::float4(premultiplied, alpha) };
    }
    if (alpha <= 0.0) {
        return worldbend_foil_fs_mainOutput { metal::float4(0.0) };
    }
    return worldbend_foil_fs_mainOutput { metal::float4(premultiplied / metal::float3(alpha), alpha) };
}
