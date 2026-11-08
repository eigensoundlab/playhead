// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// The audiovisual scene: one fragment shader, drawn with WebGPU where the browser has it and WebGL 2 where it does not,
// the same on both sides of the page. Everything it shows comes from a drive (see drivers.js), packed into 8 vec4s:
//   0 time, -, level, phase        1 kick, snare, snareAge, hat     2 hatSeed, hueA, hueB, build    3 rough, flash, passX, passOn
//   4 bands 0-3                    5 bands 4-7                      6 beatPhase, spin, fill, brk     7 bg, grid, width, height
// Eight rings are eight octaves (low inside); the centre punches on a kick; a shockwave runs out on a snare; sparkles fall
// on hats; a hand goes round once a bar (phase) or spins freely (spin); streaks run outward with the build; a drop
// flashes; edges roughen with distortion; a light crosses for a pass-by, blue as it comes and red as it goes.
"use strict";
(function (root) {
  // the scene in WGSL; the GLSL below is the same line by line
  const WGSL = `
struct U { v: array<vec4<f32>, 8> };
@group(0) @binding(0) var<uniform> u: U;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(-1.0, 1.0), vec2<f32>(3.0, 1.0));
  return vec4<f32>(p[i], 0.0, 1.0);
}
const PI = 3.14159265;
const TAU = 6.2831853;
fn fmod(x: f32, y: f32) -> f32 { return x - y * floor(x / y); }
fn hash(p: vec2<f32>) -> f32 { return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453); }
fn hsv(h: f32, s: f32, v: f32) -> vec3<f32> {
  let p = abs(fract(vec3<f32>(h, h, h) + vec3<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return v * mix(vec3<f32>(1.0), clamp(p - 1.0, vec3<f32>(0.0), vec3<f32>(1.0)), s);
}
fn band(i: i32) -> f32 { if (i < 4) { return u.v[4][i]; } return u.v[5][i - 4]; }
@fragment fn fs(@builtin(position) fc: vec4<f32>) -> @location(0) vec4<f32> {
  let res = u.v[7].zw;
  let p = vec2<f32>(fc.x - 0.5 * res.x, 0.5 * res.y - fc.y) / res.y;
  let r = length(p); let a = atan2(p.y, p.x);
  let time = u.v[0].x; let level = u.v[0].z; let phase = u.v[0].w;
  let kick = u.v[1].x; let snare = u.v[1].y; let sAge = u.v[1].z; let hat = u.v[1].w;
  let hseed = u.v[2].x; let hueA = u.v[2].y; let hueB = u.v[2].z; let build = u.v[2].w;
  let rough = u.v[3].x; let flash = u.v[3].y; let passX = u.v[3].z; let passOn = u.v[3].w;
  let spin = u.v[6].y; let fill = u.v[6].z; let brk = u.v[6].w; let bg = u.v[7].x; let grid = u.v[7].y;
  var col = hsv(hueA, 0.55, 0.03 + 0.10 * bg) * max(0.0, 1.2 - r);
  let sa = floor((a + PI) / TAU * 90.0);
  let streak = hash(vec2<f32>(sa, 3.1));
  let run = fract(streak * 7.0 + time * (0.15 + 1.6 * build) - r * 1.2);
  col += hsv(hueB, 0.5, 1.0) * build * 0.45 * smoothstep(0.9, 1.0, streak) * smoothstep(0.0, 0.15, run) * (1.0 - run) * smoothstep(0.1, 0.5, r);
  var ang = spin;
  if (phase >= 0.0) { ang = PI * 0.5 - TAU * phase; }
  var lit = 0.4;
  if (phase >= 0.0) { lit = 1.0; }
  let trail = exp(-fmod(a - ang, TAU) * 2.2);
  let scale = 1.0 + 0.25 * build;
  for (var i = 0; i < 8; i++) {
    let b = band(i); let fi = f32(i);
    let R = (0.11 + 0.042 * fi) * scale;
    let jag = rough * 0.022 * (hash(vec2<f32>(floor((a + PI) / TAU * (40.0 + 12.0 * fi)), fi + floor(time * 12.0))) - 0.5);
    let d = abs(r - R - jag);
    let w = 0.003 + 0.010 * b;
    var g = exp(-d * d / (w * w)) * (0.25 + 1.6 * b) + 0.18 * b * exp(-d / 0.035);
    g = g * (1.0 - 0.55 * brk);
    let c = hsv(mix(hueA, hueB, fi / 7.0) + 0.04 * fi, 0.75, 1.0);
    col += c * g * (0.55 + 0.6 * trail * lit);
  }
  if (grid > 0.5) {
    let R0 = 0.47 * scale;
    let st = fmod(floor(fmod((PI * 0.5 - a) / TAU, 1.0) * 16.0 + 0.5), 16.0);
    let stepAng = PI * 0.5 - st * TAU / 16.0;
    let da = abs(fmod(a - stepAng + PI, TAU) - PI) * r;
    var len = 0.015;
    if (fmod(st, 4.0) < 0.5) { len = 0.032; }
    let tick = (1.0 - smoothstep(0.0015, 0.004, da)) * step(R0, r) * step(r, R0 + len);
    var cur = 0.0;
    if (abs(fmod(floor(phase * 16.0), 16.0) - st) < 0.5) { cur = 1.0; }
    col += vec3<f32>(0.45 + 0.9 * cur) * tick * 0.7;
  }
  let dh = abs(fmod(a - ang + PI, TAU) - PI) * r;
  col += hsv(hueB, 0.3, 1.0) * (1.0 - smoothstep(0.0, 0.006, dh)) * step(0.07, r) * step(r, 0.5 * scale) * 0.5;
  let kr = 0.05 + 0.05 * kick;
  col += hsv(hueA, 0.4, 1.0) * ((1.0 - smoothstep(kr - 0.01, kr, r)) * (0.25 + 1.2 * kick) + 0.6 * kick * exp(-r * 6.0));
  let sw = 0.08 + sAge * 0.9;
  let sx = (r - sw) / 0.012;
  col += vec3<f32>(1.0, 0.95, 0.9) * snare * exp(-sx * sx) * 0.9;
  let pc2 = vec2<f32>((a + PI) / TAU * 48.0, r * 36.0);
  let cell = floor(pc2);
  let hs = hash(cell + vec2<f32>(hseed * 1.37, hseed * 0.71));
  let thr = 1.0 - (0.10 * hat + 0.12 * fill);
  let off = (fract(pc2) - 0.5) * vec2<f32>(r * TAU / 48.0 * 36.0, 1.0);
  let dotm = 1.0 - smoothstep(0.12, 0.32, length(off));
  col += hsv(hueB + 0.1, 0.3, 1.0) * step(thr, hs) * dotm * smoothstep(0.38, 0.5, r) * (hat + fill * 0.6) * 2.0;
  if (passOn > 0.0) {
    let q = p - vec2<f32>(passX * 0.95, 0.36);
    var tail = exp(-q.x * 40.0);
    if (q.x < 0.0) { tail = exp(q.x * 8.0); }
    let glow = exp(-q.y * q.y / 0.0006) * tail * 0.8 + exp(-dot(q, q) / 0.0012);
    let pc = mix(vec3<f32>(0.35, 0.6, 1.0), vec3<f32>(1.0, 0.35, 0.25), smoothstep(-0.3, 0.3, passX));
    col += pc * glow * passOn * (1.0 - 0.6 * abs(passX));
  }
  col += vec3<f32>(flash);
  col = col * (0.55 + 0.6 * level);
  col = 1.0 - exp(-col * 1.3);
  return vec4<f32>(pow(col, vec3<f32>(0.9)), 1.0);
}`;
  const VERT = `#version 300 es
void main() { vec2 p[3] = vec2[3](vec2(-1.0, -3.0), vec2(-1.0, 1.0), vec2(3.0, 1.0)); gl_Position = vec4(p[gl_VertexID], 0.0, 1.0); }`;
  const FRAG = `#version 300 es
precision highp float;
uniform vec4 U[8];
out vec4 o;
const float PI = 3.14159265;
const float TAU = 6.2831853;
float fmod(float x, float y) { return x - y * floor(x / y); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 hsv(float h, float s, float v) { vec3 p = abs(fract(vec3(h) + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0); return v * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), s); }
float band(int i) { if (i < 4) return U[4][i]; return U[5][i - 4]; }
void main() {
  vec2 res = U[7].zw;
  vec2 p = (gl_FragCoord.xy - 0.5 * res) / res.y;
  float r = length(p), a = atan(p.y, p.x);
  float time = U[0].x, level = U[0].z, phase = U[0].w;
  float kick = U[1].x, snare = U[1].y, sAge = U[1].z, hat = U[1].w;
  float hseed = U[2].x, hueA = U[2].y, hueB = U[2].z, build = U[2].w;
  float rough = U[3].x, flash = U[3].y, passX = U[3].z, passOn = U[3].w;
  float spin = U[6].y, fill = U[6].z, brk = U[6].w, bg = U[7].x, grid = U[7].y;
  vec3 col = hsv(hueA, 0.55, 0.03 + 0.10 * bg) * max(0.0, 1.2 - r);
  float sa = floor((a + PI) / TAU * 90.0);
  float streak = hash(vec2(sa, 3.1));
  float run = fract(streak * 7.0 + time * (0.15 + 1.6 * build) - r * 1.2);
  col += hsv(hueB, 0.5, 1.0) * build * 0.45 * smoothstep(0.9, 1.0, streak) * smoothstep(0.0, 0.15, run) * (1.0 - run) * smoothstep(0.1, 0.5, r);
  float ang = phase >= 0.0 ? PI * 0.5 - TAU * phase : spin;
  float lit = phase >= 0.0 ? 1.0 : 0.4;
  float trail = exp(-fmod(a - ang, TAU) * 2.2);
  float scale = 1.0 + 0.25 * build;
  for (int i = 0; i < 8; i++) {
    float b = band(i), fi = float(i);
    float R = (0.11 + 0.042 * fi) * scale;
    float jag = rough * 0.022 * (hash(vec2(floor((a + PI) / TAU * (40.0 + 12.0 * fi)), fi + floor(time * 12.0))) - 0.5);
    float d = abs(r - R - jag);
    float w = 0.003 + 0.010 * b;
    float g = exp(-d * d / (w * w)) * (0.25 + 1.6 * b) + 0.18 * b * exp(-d / 0.035);
    g *= 1.0 - 0.55 * brk;
    vec3 c = hsv(mix(hueA, hueB, fi / 7.0) + 0.04 * fi, 0.75, 1.0);
    col += c * g * (0.55 + 0.6 * trail * lit);
  }
  if (grid > 0.5) {
    float R0 = 0.47 * scale;
    float st = fmod(floor(fmod((PI * 0.5 - a) / TAU, 1.0) * 16.0 + 0.5), 16.0);
    float stepAng = PI * 0.5 - st * TAU / 16.0;
    float da = abs(fmod(a - stepAng + PI, TAU) - PI) * r;
    float len = fmod(st, 4.0) < 0.5 ? 0.032 : 0.015;
    float tick = (1.0 - smoothstep(0.0015, 0.004, da)) * step(R0, r) * step(r, R0 + len);
    float cur = abs(fmod(floor(phase * 16.0), 16.0) - st) < 0.5 ? 1.0 : 0.0;
    col += vec3(0.45 + 0.9 * cur) * tick * 0.7;
  }
  float dh = abs(fmod(a - ang + PI, TAU) - PI) * r;
  col += hsv(hueB, 0.3, 1.0) * (1.0 - smoothstep(0.0, 0.006, dh)) * step(0.07, r) * step(r, 0.5 * scale) * 0.5;
  float kr = 0.05 + 0.05 * kick;
  col += hsv(hueA, 0.4, 1.0) * ((1.0 - smoothstep(kr - 0.01, kr, r)) * (0.25 + 1.2 * kick) + 0.6 * kick * exp(-r * 6.0));
  float sw = 0.08 + sAge * 0.9;
  float sx = (r - sw) / 0.012;
  col += vec3(1.0, 0.95, 0.9) * snare * exp(-sx * sx) * 0.9;
  vec2 pc2 = vec2((a + PI) / TAU * 48.0, r * 36.0);
  vec2 cell = floor(pc2);
  float hs = hash(cell + vec2(hseed * 1.37, hseed * 0.71));
  float thr = 1.0 - (0.10 * hat + 0.12 * fill);
  vec2 off = (fract(pc2) - 0.5) * vec2(r * TAU / 48.0 * 36.0, 1.0);
  float dotm = 1.0 - smoothstep(0.12, 0.32, length(off));
  col += hsv(hueB + 0.1, 0.3, 1.0) * step(thr, hs) * dotm * smoothstep(0.38, 0.5, r) * (hat + fill * 0.6) * 2.0;
  if (passOn > 0.0) {
    vec2 q = p - vec2(passX * 0.95, 0.36);
    float tail = q.x < 0.0 ? exp(q.x * 8.0) : exp(-q.x * 40.0);
    float glow = exp(-q.y * q.y / 0.0006) * tail * 0.8 + exp(-dot(q, q) / 0.0012);
    vec3 pc = mix(vec3(0.35, 0.6, 1.0), vec3(1.0, 0.35, 0.25), smoothstep(-0.3, 0.3, passX));
    col += pc * glow * passOn * (1.0 - 0.6 * abs(passX));
  }
  col += vec3(flash);
  col *= 0.55 + 0.6 * level;
  col = 1.0 - exp(-col * 1.3);
  o = vec4(pow(col, vec3(0.9)), 1.0);
}`;

  // the drive as 32 floats
  function pack(d, time, w, h, out) {
    const f = out || new Float32Array(32), b = d.bands;
    f.set([time, w / h, d.level, d.phase, d.kick, d.snare, Math.min(d.snareAge, 9), d.hat, d.hatSeed, d.hueA, d.hueB, d.build, d.rough, d.flash, d.passX, d.passOn,
      b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], d.beatPhase, d.spin, d.fill, d.brk, d.bg, d.grid, w, h]);
    return f;
  }

  // WebGPU: one device and pipeline, a context and a uniform buffer per canvas
  async function webgpu(canvases) {
    if (!(typeof navigator !== "undefined" && navigator.gpu)) return null;
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice(), format = navigator.gpu.getPreferredCanvasFormat();
    const module = device.createShaderModule({ code: WGSL });
    const info = module.getCompilationInfo ? await module.getCompilationInfo() : null;
    if (info && info.messages.some(m => m.type === "error")) throw new Error("WGSL: " + info.messages.map(m => m.message).join("; "));
    const pipeline = device.createRenderPipeline({ layout: "auto", vertex: { module, entryPoint: "vs" }, fragment: { module, entryPoint: "fs", targets: [{ format }] }, primitive: { topology: "triangle-list" } });
    const views = canvases.map(cv => {
      const ctx = cv.getContext("webgpu"); ctx.configure({ device, format, alphaMode: "opaque" });
      const buf = device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buf } }] });
      return { cv, ctx, buf, group, f: new Float32Array(32) };
    });
    return {
      name: "WebGPU",
      draw(k, d, time) {
        const v = views[k], f = pack(d, time, v.cv.width, v.cv.height, v.f);
        device.queue.writeBuffer(v.buf, 0, f);
        const enc = device.createCommandEncoder();
        const pass = enc.beginRenderPass({ colorAttachments: [{ view: v.ctx.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
        pass.setPipeline(pipeline); pass.setBindGroup(0, v.group); pass.draw(3); pass.end();
        device.queue.submit([enc.finish()]);
      }
    };
  }
  // WebGL 2: a context and a program per canvas
  function webgl2(canvases) {
    const views = [];
    for (const cv of canvases) {
      const gl = cv.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
      if (!gl) return null;
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("GLSL: " + gl.getShaderInfoLog(s)); return s; };
      const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("GLSL: " + gl.getProgramInfoLog(prog));
      views.push({ cv, gl, prog, loc: gl.getUniformLocation(prog, "U"), vao: gl.createVertexArray(), f: new Float32Array(32) });
    }
    return {
      name: "WebGL 2",
      draw(k, d, time) {
        const v = views[k], gl = v.gl;
        gl.viewport(0, 0, v.cv.width, v.cv.height); gl.useProgram(v.prog); gl.bindVertexArray(v.vao);
        gl.uniform4fv(v.loc, pack(d, time, v.cv.width, v.cv.height, v.f));
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    };
  }
  // WebGPU where the browser has it (and ?gl does not ask otherwise), else WebGL 2
  async function create(canvases, prefer) {
    if (prefer !== "webgl2") { try { const r = await webgpu(canvases); if (r) return r; } catch (e) { console.warn("WebGPU not used:", e.message || e); } }
    return webgl2(canvases);
  }
  const api = { create, pack, WGSL, FRAG };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.AVScene = api;
})(typeof self !== "undefined" ? self : this);
