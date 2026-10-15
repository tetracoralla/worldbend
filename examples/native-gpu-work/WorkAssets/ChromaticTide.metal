#include <metal_stdlib>
using namespace metal;

// Original analytic colour field. Absolute-time sampling has no history or
// particle state. Encoded sRGB premultiplied output; HDR carrier is extended
// encoded range, not a claim of linear-light or EDR display rendering.
struct TideUniforms {
    float2 pixels;
    float2 logicalSize;
    float time;
    float variation;
    float transparent;
    float extendedRange;
    uint seed;
};

kernel void chromaticTide(texture2d<float, access::write> target [[texture(0)]],
                         constant TideUniforms& u [[buffer(0)]],
                         uint2 tid [[thread_position_in_grid]]) {
    if (tid.x >= target.get_width() || tid.y >= target.get_height()) return;
    float2 uv = (float2(tid) + 0.5) / u.pixels;
    float2 p = (uv - 0.5) * float2(u.logicalSize.x / u.logicalSize.y, 1.0);
    float t = u.time * 0.5235987756 + float(u.seed % 97) * 0.071;
    float warp = 0.21 * sin(5.5*p.y + 0.6*t) + 0.11*cos(7*p.x - 0.4*t);
    float wave = 12*p.x + 6*p.y + 3*warp + t;
    float ribbon = pow(0.5 + 0.5*sin(wave), 5.0);
    float depth = 0.5 + 0.5*cos(4.0*p.y - 1.7*p.x - 0.7*t);
    float3 ink = float3(0.025,0.055,0.105);
    float3 jade = u.variation < 0.5 ? float3(0.10,0.78,0.66) : float3(0.49,0.23,0.88);
    float3 amber = u.variation < 0.5 ? float3(1.0,0.65,0.25) : float3(0.96,0.29,0.44);
    float3 color = mix(ink, mix(jade,amber,depth), 0.24 + 0.75*ribbon);

    float2 center = float2(0.09*cos(0.5*t),0.15*sin(0.7*t));
    float radial = length(p-center) + 0.045*sin(8*atan2(p.y-center.y,p.x-center.x)+t);
    float phase = fract(radial*9.0 - 0.17*t);
    float distance = min(phase,1-phase)/9.0;
    float pixel = 1.0/u.pixels.y;
    float contour = 1-smoothstep(0.001,0.001+pixel,distance);
    color = mix(color,float3(0.82,0.89,0.72),0.24*contour);
    float2 logical = uv*u.logicalSize;
    float2 gridDistance = abs(fract(logical/24.0+0.5)-0.5)*24.0;
    float grid = 1-smoothstep(0.18,0.18+u.logicalSize.y/u.pixels.y,min(gridDistance.x,gridDistance.y));
    color += 0.04*grid;
    float alpha = u.transparent > 0.5 ? (0.16 + 0.68*ribbon) : 1.0;
    float peak = u.extendedRange > 0.5 ? 2.4 : 1.0;
    target.write(float4(color*alpha*peak,alpha),tid);
}

// Proof/export composition only: actual optical shader output over the same
// completed source, entirely on GPU. Native UI uses the existing MTKView panes.
kernel void chromaticComposite(texture2d<float, access::read_write> scene [[texture(0)]],
                               texture2d<float, access::read> pane [[texture(1)]],
                               constant uint2& origin [[buffer(0)]],
                               uint2 tid [[thread_position_in_grid]]) {
    if(tid.x >= pane.get_width() || tid.y >= pane.get_height()) return;
    uint2 position=origin+tid;
    if(position.x >= scene.get_width() || position.y >= scene.get_height()) return;
    float4 foreground=pane.read(tid),background=scene.read(position);
    scene.write(foreground+background*(1-foreground.a),position);
}
