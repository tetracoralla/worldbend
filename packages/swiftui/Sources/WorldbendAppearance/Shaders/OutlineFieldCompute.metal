#include <metal_stdlib>
using namespace metal;

// Optional outline distance/normal field. The r6 CPU pointer kernel remains
// the semantic authority and the default. This shader repeats that math:
//   * 3-4 chamfer as a row-wise linear recurrence (parallel prefix; same
//     integers as the sequential min sweeps)
//   * central-difference outward normals
//   * exact closest-segment refine with the same strict < tie break
// Scanline fill stays on the CPU. Apple GPUs have no double, and the r6
// mask is CGFloat. Fast-math is off so the remaining float ops stay IEEE.
#pragma clang fp contract(off)

struct OutlineFieldGPUParams {
    uint width;
    uint height;
    float cell;
    float scale;
    float far;
    float inf;
    float infHalf;
    float band;
    float gridCell;
    float originX;
    float originY;
    uint cols;
    uint rows;
    uint segmentCount;
    uint texelCount;
    float bestInit;
};

// One threadgroup of 1024. Every thread must hit every barrier.
constant uint kOutlineFieldThreadgroup = 1024;

static void prefix_min_left(threadgroup float* current,
                            threadgroup float* scratch,
                            uint width,
                            uint tid) {
    uint cur = 0;
    for (uint offset = 1; offset < width; offset <<= 1) {
        threadgroup float* read = cur == 0 ? current : scratch;
        threadgroup float* write = cur == 0 ? scratch : current;
        float next = 0;
        if (tid < width) {
            next = read[tid];
            if (tid >= offset) {
                next = min(next, read[tid - offset] + 3.0f * float(offset));
            }
        }
        threadgroup_barrier(mem_flags::mem_threadgroup);
        if (tid < width) write[tid] = next;
        threadgroup_barrier(mem_flags::mem_threadgroup);
        cur ^= 1;
    }
    if (cur != 0 && tid < width) current[tid] = scratch[tid];
    threadgroup_barrier(mem_flags::mem_threadgroup);
}

static void prefix_min_right(threadgroup float* current,
                             threadgroup float* scratch,
                             uint width,
                             uint tid) {
    uint cur = 0;
    for (uint offset = 1; offset < width; offset <<= 1) {
        threadgroup float* read = cur == 0 ? current : scratch;
        threadgroup float* write = cur == 0 ? scratch : current;
        float next = 0;
        if (tid < width) {
            next = read[tid];
            if (tid + offset < width) {
                next = min(next, read[tid + offset] + 3.0f * float(offset));
            }
        }
        threadgroup_barrier(mem_flags::mem_threadgroup);
        if (tid < width) write[tid] = next;
        threadgroup_barrier(mem_flags::mem_threadgroup);
        cur ^= 1;
    }
    if (cur != 0 && tid < width) current[tid] = scratch[tid];
    threadgroup_barrier(mem_flags::mem_threadgroup);
}

kernel void outline_field_chamfer(
    device const uchar* inside [[buffer(0)]],
    device float* dist [[buffer(1)]],
    constant OutlineFieldGPUParams& p [[buffer(2)]],
    uint tid [[thread_position_in_threadgroup]],
    uint tgSize [[threads_per_threadgroup]]
) {
    if (p.width == 0 || p.height == 0 || p.width > kOutlineFieldThreadgroup) return;
    // Divergent return is illegal once barriers start. tgSize is the dispatch.
    if (tgSize == 0) return;

    threadgroup float bufA[kOutlineFieldThreadgroup];
    threadgroup float bufB[kOutlineFieldThreadgroup];

    // Forward sweep. Row y reads only the finished row y-1 (up / up-left / up-right).
    for (uint y = 0; y < p.height; ++y) {
        if (tid < p.width) {
            uint i = y * p.width + tid;
            bool here = inside[i] != 0;
            bool left = tid > 0 ? inside[i - 1] != 0 : false;
            bool right = tid + 1 < p.width ? inside[i + 1] != 0 : false;
            bool up = y > 0 ? inside[i - p.width] != 0 : false;
            bool down = y + 1 < p.height ? inside[i + p.width] != 0 : false;
            float seed = (here != left || here != right || here != up || here != down) ? 0.0f : p.inf;
            float base = seed;
            if (y > 0) {
                uint upRow = (y - 1) * p.width;
                base = min(base, dist[upRow + tid] + 3.0f);
                if (tid > 0) base = min(base, dist[upRow + tid - 1] + 4.0f);
                if (tid + 1 < p.width) base = min(base, dist[upRow + tid + 1] + 4.0f);
            }
            bufA[tid] = base;
        }
        threadgroup_barrier(mem_flags::mem_threadgroup);
        prefix_min_left(bufA, bufB, p.width, tid);
        if (tid < p.width) dist[y * p.width + tid] = bufA[tid];
        threadgroup_barrier(mem_flags::mem_device);
    }

    // Backward sweep. Row y reads the finished row y+1.
    for (int y = int(p.height) - 1; y >= 0; --y) {
        if (tid < p.width) {
            uint row = uint(y) * p.width;
            float base = dist[row + tid];
            if (uint(y) + 1 < p.height) {
                uint downRow = (uint(y) + 1) * p.width;
                base = min(base, dist[downRow + tid] + 3.0f);
                if (tid + 1 < p.width) base = min(base, dist[downRow + tid + 1] + 4.0f);
                if (tid > 0) base = min(base, dist[downRow + tid - 1] + 4.0f);
            }
            bufA[tid] = base;
        }
        threadgroup_barrier(mem_flags::mem_threadgroup);
        prefix_min_right(bufA, bufB, p.width, tid);
        if (tid < p.width) dist[uint(y) * p.width + tid] = bufA[tid];
        threadgroup_barrier(mem_flags::mem_device);
    }

    for (uint i = tid; i < p.texelCount; i += kOutlineFieldThreadgroup) {
        bool inn = inside[i] != 0;
        float mag = dist[i];
        float signedValue = inn ? -mag : mag;
        dist[i] = signedValue >= p.infHalf ? (inn ? -p.far : p.far) : signedValue * p.scale;
    }
}

kernel void outline_field_normals(
    device const float* dist [[buffer(0)]],
    device float* normalsX [[buffer(1)]],
    device float* normalsY [[buffer(2)]],
    constant OutlineFieldGPUParams& p [[buffer(3)]],
    uint2 gid [[thread_position_in_grid]]
) {
    if (gid.x >= p.width || gid.y >= p.height) return;
    uint x = gid.x;
    uint y = gid.y;
    uint xm = x > 0 ? x - 1 : 0;
    uint xp = x + 1 < p.width ? x + 1 : p.width - 1;
    uint ym = y > 0 ? y - 1 : 0;
    uint yp = y + 1 < p.height ? y + 1 : p.height - 1;
    uint row = y * p.width;
    float gx = dist[row + xp] - dist[row + xm];
    float gy = dist[yp * p.width + x] - dist[ym * p.width + x];
    float len = sqrt(gx * gx + gy * gy);
    uint i = row + x;
    if (len > 1e-6f) {
        normalsX[i] = gx / len;
        normalsY[i] = gy / len;
    } else {
        normalsX[i] = 0;
        normalsY[i] = -1;
    }
}

kernel void outline_field_refine(
    device const uchar* inside [[buffer(0)]],
    device float* dist [[buffer(1)]],
    device float* normalsX [[buffer(2)]],
    device float* normalsY [[buffer(3)]],
    device const float* segments [[buffer(4)]],
    device const int* offsets [[buffer(5)]],
    device const int* items [[buffer(6)]],
    constant OutlineFieldGPUParams& p [[buffer(7)]],
    device atomic_uint* stats [[buffer(8)]],
    device uchar* degenerate [[buffer(9)]],
    uint gid [[thread_position_in_grid]]
) {
    if (gid >= p.texelCount || p.segmentCount == 0) return;
    float signedDistance = dist[gid];
    if (fabs(signedDistance) > p.band) return;

    uint y = gid / p.width;
    uint x = gid - y * p.width;
    float px = (float(x) + 0.5f) * p.cell;
    float py = (float(y) + 0.5f) * p.cell;
    int gx = int(floor((px - p.originX) / p.gridCell));
    int gy = int(floor((py - p.originY) / p.gridCell));
    gx = clamp(gx, 0, int(p.cols) - 1);
    gy = clamp(gy, 0, int(p.rows) - 1);
    int cellIndex = gy * int(p.cols) + gx;
    int rangeStart = offsets[cellIndex];
    int rangeEnd = offsets[cellIndex + 1];
    bool useAll = rangeStart == rangeEnd;
    uint candidateCount = useAll ? p.segmentCount : uint(rangeEnd - rangeStart);

    float bestDist2 = p.bestInit;
    float bestCX = px;
    float bestCY = py;
    float bestTX = 1;
    float bestTY = 0;

    if (useAll) {
        for (uint si = 0; si < p.segmentCount; ++si) {
            uint base = si * 9;
            float ax = segments[base];
            float ay = segments[base + 1];
            float abx = segments[base + 2];
            float aby = segments[base + 3];
            float ab2 = segments[base + 4];
            float apx = px - ax;
            float apy = py - ay;
            float t = ab2 < 1e-12f ? 0 : clamp((apx * abx + apy * aby) / ab2, 0.0f, 1.0f);
            float cx = ax + abx * t;
            float cy = ay + aby * t;
            float dx = px - cx;
            float dy = py - cy;
            float d2 = dx * dx + dy * dy;
            if (d2 < bestDist2) {
                bestDist2 = d2;
                bestCX = cx;
                bestCY = cy;
                bestTX = abx;
                bestTY = aby;
            }
        }
    } else {
        for (int k = rangeStart; k < rangeEnd; ++k) {
            uint si = uint(items[k]);
            uint base = si * 9;
            float ax = segments[base];
            float ay = segments[base + 1];
            float abx = segments[base + 2];
            float aby = segments[base + 3];
            float ab2 = segments[base + 4];
            float apx = px - ax;
            float apy = py - ay;
            float t = ab2 < 1e-12f ? 0 : clamp((apx * abx + apy * aby) / ab2, 0.0f, 1.0f);
            float cx = ax + abx * t;
            float cy = ay + aby * t;
            float dx = px - cx;
            float dy = py - cy;
            float d2 = dx * dx + dy * dy;
            if (d2 < bestDist2) {
                bestDist2 = d2;
                bestCX = cx;
                bestCY = cy;
                bestTX = abx;
                bestTY = aby;
            }
        }
    }

    atomic_fetch_add_explicit(stats + 0, candidateCount, memory_order_relaxed);
    atomic_fetch_add_explicit(stats + 1, 1u, memory_order_relaxed);

    bool inn = inside[gid] != 0;
    float unsignedDistance = sqrt(bestDist2);
    dist[gid] = inn ? -unsignedDistance : unsignedDistance;

    float vx = px - bestCX;
    float vy = py - bestCY;
    float vlen = sqrt(vx * vx + vy * vy);
    if (vlen > 1e-6f) {
        float nx = vx / vlen;
        float ny = vy / vlen;
        if (inn) {
            nx = -nx;
            ny = -ny;
        }
        normalsX[gid] = nx;
        normalsY[gid] = ny;
    } else {
        float tlen = sqrt(bestTX * bestTX + bestTY * bestTY);
        if (tlen > 1e-6f) {
            // Even-odd probe stays on the CPU (CGFloat). Flag the texel.
            degenerate[gid] = 1;
        }
    }
}

kernel void outline_field_pack(
    device const float* dist [[buffer(0)]],
    device const float* normalsX [[buffer(1)]],
    device const float* normalsY [[buffer(2)]],
    constant OutlineFieldGPUParams& p [[buffer(3)]],
    texture2d<half, access::write> field [[texture(0)]],
    uint2 gid [[thread_position_in_grid]]
) {
    if (gid.x >= p.width || gid.y >= p.height) return;
    uint i = gid.y * p.width + gid.x;
    float d = dist[i];
    half insideMask = d <= 0.0f ? half(1.0) : half(0.0);
    field.write(half4(half(d), half(normalsX[i]), half(normalsY[i]), insideMask), gid);
}
