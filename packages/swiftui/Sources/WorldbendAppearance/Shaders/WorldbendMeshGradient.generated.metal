// Generated from mesh_gradient.wgsl by Naga 30.0.1. Do not edit.
// Canonical source: sha256:9b7f61158bc9b4755c590acf0cbfa9f3e5c49d48bf25ee69450c528068a3fe5f
// language: metal2.4
#include <metal_stdlib>
#include <simd/simd.h>

using metal::uint;

struct Uniforms {
    metal::float4 frameData;
    metal::float4 outputDimsData;
    metal::float4 colorTl;
    metal::float4 colorTr;
    metal::float4 colorBl;
    metal::float4 colorBr;
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

float worldbend_mesh_gradient_v2_hash21_(
    metal::float2 p
) {
    metal::float2 q = {};
    q = metal::fract(p * metal::float2(127.1, 311.7));
    metal::float2 _e7 = q;
    metal::float2 _e8 = q;
    metal::float2 _e9 = q;
    q = _e7 + metal::float2(metal::dot(_e8, _e9 + metal::float2(74.13)));
    float _e17 = q.x;
    float _e19 = q.y;
    return metal::fract(_e17 * _e19);
}

float worldbend_mesh_gradient_v2_valueNoise(
    metal::float2 p_1
) {
    metal::float2 i_1 = metal::floor(p_1);
    metal::float2 f = metal::fract(p_1);
    metal::float2 t = ((f * f) * f) * ((f * ((f * 6.0) - metal::float2(15.0))) + metal::float2(10.0));
    float _e15 = worldbend_mesh_gradient_v2_hash21_(i_1);
    float _e20 = worldbend_mesh_gradient_v2_hash21_(i_1 + metal::float2(1.0, 0.0));
    float _e25 = worldbend_mesh_gradient_v2_hash21_(i_1 + metal::float2(0.0, 1.0));
    float _e30 = worldbend_mesh_gradient_v2_hash21_(i_1 + metal::float2(1.0, 1.0));
    return metal::mix(metal::mix(_e15, _e20, t.x), metal::mix(_e25, _e30, t.x), t.y);
}

float worldbend_mesh_gradient_v2_fbm(
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
            float _e14 = worldbend_mesh_gradient_v2_valueNoise(_e13);
            value = _e11 + (_e12 * _e14);
            metal::float2 _e17 = point;
            point = (_e17 * 2.07) + metal::float2(17.3, 13.1);
            float _e24 = amplitude;
            amplitude = _e24 * 0.5;
        }
    }
    float _e30 = value;
    return _e30;
}

struct worldbend_mesh_gradient_v2_vs_mainInput {
    metal::float2 pos [[attribute(0)]];
    metal::float2 uv_1 [[attribute(1)]];
};
struct worldbend_mesh_gradient_v2_vs_mainOutput {
    metal::float4 position [[position]];
    metal::float2 uv [[user(loc0), center_perspective]];
};
vertex worldbend_mesh_gradient_v2_vs_mainOutput worldbend_mesh_gradient_v2_vs_main(
  worldbend_mesh_gradient_v2_vs_mainInput varyings [[stage_in]]
) {
    const VsIn in = { varyings.pos, varyings.uv_1 };
    VsOut out = {};
    out.position = metal::float4(in.pos, 0.0, 1.0);
    out.uv = in.uv;
    VsOut _e9 = out;
    const auto _tmp = _e9;
    return worldbend_mesh_gradient_v2_vs_mainOutput { _tmp.position, _tmp.uv };
}


struct worldbend_mesh_gradient_v2_fs_mainInput {
    metal::float2 outputUv_in [[user(loc0), center_perspective]];
};
struct worldbend_mesh_gradient_v2_fs_mainOutput {
    metal::float4 member_1 [[color(0)]];
};
fragment worldbend_mesh_gradient_v2_fs_mainOutput worldbend_mesh_gradient_v2_fs_main(
  worldbend_mesh_gradient_v2_fs_mainInput varyings_1 [[stage_in]]
, constant Uniforms& u [[buffer(0)]]
) {
    const auto outputUv_in = varyings_1.outputUv_in;
    metal::float2 uv = {};
    float sx = {};
    float sy = {};
    float _e4 = u.flags.x;
    if (_e4 < 0.5) {
        return worldbend_mesh_gradient_v2_fs_mainOutput { metal::float4(0.0) };
    }
    metal::float4 _e11 = u.outputDimsData;
    metal::float2 dims = metal::max(_e11.xy, metal::float2(1.0));
    float aspect = dims.x / metal::max(dims.y, 1.0);
    float _e24 = u.frameData.y;
    float duration = metal::max(_e24, 0.001);
    float phase = u.frameData.z;
    float _e34 = u.frameData.w;
    float flowSpeed = metal::max(_e34, 0.0);
    float _e40 = u.frameData.x;
    float loopT = metal::fract((_e40 + phase) / duration);
    float angle = loopT * 6.2831855;
    metal::float2 orbit = (metal::float2(metal::sin(angle), 1.0 - metal::cos(angle)) * 6.2831855) * flowSpeed;
    float _e57 = u.surface.x;
    float warp = metal::clamp(_e57, 0.0, 1.0);
    float _e64 = u.surface.y;
    float softness = metal::clamp(_e64, 0.0, 1.0);
    uv = metal::float2(outputUv_in.x * aspect, outputUv_in.y);
    metal::float2 _e73 = uv;
    float _e81 = worldbend_mesh_gradient_v2_fbm((_e73 * 2.4) + (orbit * metal::float2(0.17, 0.11)));
    metal::float2 _e84 = uv;
    float _e99 = worldbend_mesh_gradient_v2_fbm((_e84 * 2.4) + metal::float2(19.0 + (orbit.y * 0.13), 7.0 - (orbit.x * 0.19)));
    metal::float2 drift = metal::float2(_e81 - 0.5, _e99 - 0.5);
    metal::float2 _e103 = uv;
    uv = _e103 + ((drift * warp) * 0.35);
    float _e109 = uv.x;
    sx = metal::clamp(_e109 / metal::max(aspect, 0.0001), 0.0, 1.0);
    float _e118 = uv.y;
    sy = metal::clamp(_e118, 0.0, 1.0);
    float power = metal::mix(1.35, 0.55, softness);
    float _e126 = sx;
    sx = metal::pow(_e126, power);
    float _e128 = sy;
    sy = metal::pow(_e128, power);
    metal::float4 _e132 = u.colorTl;
    float _e137 = u.colorTl.w;
    float _e142 = u.colorTl.w;
    metal::float4 _e146 = u.colorTr;
    float _e151 = u.colorTr.w;
    float _e156 = u.colorTr.w;
    float _e158 = sx;
    metal::float4 top = metal::mix(metal::float4(_e132.xyz * _e137, _e142), metal::float4(_e146.xyz * _e151, _e156), _e158);
    metal::float4 _e162 = u.colorBl;
    float _e167 = u.colorBl.w;
    float _e172 = u.colorBl.w;
    metal::float4 _e176 = u.colorBr;
    float _e181 = u.colorBr.w;
    float _e186 = u.colorBr.w;
    float _e188 = sx;
    metal::float4 bottom = metal::mix(metal::float4(_e162.xyz * _e167, _e172), metal::float4(_e176.xyz * _e181, _e186), _e188);
    float _e190 = sy;
    metal::float4 premultiplied = metal::mix(top, bottom, _e190);
    float alpha = premultiplied.w;
    float _e196 = u.flags.y;
    if (_e196 > 0.5) {
        return worldbend_mesh_gradient_v2_fs_mainOutput { premultiplied };
    }
    if (alpha <= 0.0) {
        return worldbend_mesh_gradient_v2_fs_mainOutput { metal::float4(0.0) };
    }
    return worldbend_mesh_gradient_v2_fs_mainOutput { metal::float4(premultiplied.xyz / metal::float3(alpha), alpha) };
}
