// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// The audiovisual scenes: fragment shaders drawn with WebGPU where the browser has it and WebGL 2 where it does not,
// the same on both sides of the page. Each scene is written once, in GLSL kept to a subset (explicit float and vector
// declarations, float literals, braces on every block, no ternaries), and turned into WGSL by toWGSL below, so the two
// renderers draw the same picture. Everything a scene shows comes from 22 vec4s (see pack):
//   0 time, level, phase (-1 without a bar), beatPhase     1 flash, darken, punch, shockwave
//   2 shockAge, sparks, sparkSeed, streaks                 3 shake, glow, smoke, rough
//   4 passX, passOn, ripple, spin                          5 hueA, hueB, grid, pitchOn
//   6 pitchNow, rippleRate, width, height                  7, 8 eight octave bands (low first)
//   9-20 the pitch over the last 3 s, 48 values oldest first (-1 where none), 0..1 for C2..C7
// Scenes: rings (rhythm: eight octave rings, a hand that keeps the bar), ribbon (melody: the tune as a line, slides and
// vibrato in it), forge (sound effects: a furnace with fire, sparks, smoke and shock).
"use strict";
(function (root) {
  const COMMON = `
const float PI = 3.14159265;
const float TAU = 6.2831853;
float fmod(float x, float y) { return x - y * floor(x / y); }
float sfall(float a, float b, float x) { return 1.0 - smoothstep(b, a, x); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 w = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), w.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), w.x), w.y);
}
vec3 hsv(float h, float s, float v) {
  vec3 p = abs(fract(vec3(h, h, h) + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return v * mix(vec3(1.0, 1.0, 1.0), clamp(p - 1.0, vec3(0.0, 0.0, 0.0), vec3(1.0, 1.0, 1.0)), s);
}
float band(int i) {
  if (i < 4) { return U[7][i]; }
  return U[8][i - 4];
}
float pitchAt(float x) {
  float k = clamp(x, 0.0, 1.0) * 47.0;
  int i = int(floor(k));
  int j = min(i + 1, 47);
  float a = U[9 + i / 4][i - (i / 4) * 4];
  float b = U[9 + j / 4][j - (j / 4) * 4];
  float f = k - floor(k);
  float r = mix(a, b, f);
  if (a < 0.0 || b < 0.0) { r = -1.0; }
  return r;
}
vec3 finish(vec3 c0, float level, float flash, float darken) {
  vec3 col = c0 * (0.55 + 0.6 * level) * (1.0 - 0.75 * darken) + vec3(flash, flash, flash);
  col = 1.0 - exp(-col * 1.3);
  return pow(col, vec3(0.9, 0.9, 0.9));
}`;
  // read the drive into names, and the pixel's place: p centred, height 1, y up, shaken
  const HEAD = `
  float time = U[0].x; float level = U[0].y; float phase = U[0].z; float beatPh = U[0].w;
  float flash = U[1].x; float darken = U[1].y; float punch = U[1].z; float shock = U[1].w;
  float shockAge = U[2].x; float sparks = U[2].y; float seed = U[2].z; float streaks = U[2].w;
  float shake = U[3].x; float glow = U[3].y; float smoke = U[3].z; float rough = U[3].w;
  float passX = U[4].x; float passOn = U[4].y; float ripple = U[4].z; float spin = U[4].w;
  float hueA = U[5].x; float hueB = U[5].y; float grid = U[5].z; float pitchOn = U[5].w;
  float pitchNow = U[6].x; float rippleRate = U[6].y;
  vec2 res = U[6].zw;
  vec2 p = (FRAGCOORD - 0.5 * res) / res.y;
  p = p + shake * 0.03 * vec2(hash(vec2(floor(time * 40.0), 1.0)) - 0.5, hash(vec2(floor(time * 40.0), 2.0)) - 0.5);
  float r = length(p);
  float a = atan(p.y, p.x);`;
  const PASS = `
  if (passOn > 0.0) {
    vec2 q = p - vec2(passX * 0.95, 0.36);
    float tail = exp(-q.x * 40.0);
    if (q.x < 0.0) { tail = exp(q.x * 8.0); }
    float pg = exp(-q.y * q.y / 0.0006) * tail * 0.8 + exp(-dot(q, q) / 0.0012);
    vec3 pc = mix(vec3(0.35, 0.6, 1.0), vec3(1.0, 0.35, 0.25), smoothstep(-0.3, 0.3, passX));
    col = col + pc * pg * passOn * (1.0 - 0.6 * abs(passX));
  }`;
  const SMOKE = `
  if (smoke > 0.001) {
    float sm = noise(vec2(p.x * 3.0 + time * 0.2, p.y * 3.0 - time * 0.6)) * noise(vec2(p.x * 7.0 - time * 0.3, p.y * 6.0 - time * 1.1));
    col = mix(col, vec3(0.45, 0.43, 0.42) * (0.4 + 0.6 * sm), smoke * 0.75 * sfall(0.55, -0.5, p.y) * (0.4 + 0.8 * sm));
  }`;
  const SCENES = {
    rings: `
void main() {${HEAD}
  float wob = ripple * 0.012 * sin(a * 9.0 + time * rippleRate * TAU);
  r = r + wob;
  vec3 col = hsv(hueA, 0.55, 0.03 + 0.12 * glow) * max(0.0, 1.2 - r);
  float sa = floor((a + PI) / TAU * 90.0);
  float streak = hash(vec2(sa, 3.1));
  float run = fract(streak * 7.0 + time * (0.15 + 1.6 * streaks) - r * 1.2);
  col = col + hsv(hueB, 0.5, 1.0) * streaks * 0.45 * smoothstep(0.9, 1.0, streak) * smoothstep(0.0, 0.15, run) * (1.0 - run) * smoothstep(0.1, 0.5, r);
  float ang = spin;
  float lit = 0.4;
  if (phase >= 0.0) { ang = PI * 0.5 - TAU * phase; lit = 1.0; }
  float trail = exp(-fmod(a - ang, TAU) * 2.2);
  float scale = 1.0 + 0.25 * streaks;
  for (int i = 0; i < 8; i++) {
    float b = band(i);
    float fi = float(i);
    float R = (0.11 + 0.042 * fi) * scale;
    float jag = rough * 0.022 * (hash(vec2(floor((a + PI) / TAU * (40.0 + 12.0 * fi)), fi + floor(time * 12.0))) - 0.5);
    float d = abs(r - R - jag);
    float w = 0.003 + 0.010 * b;
    float g = exp(-d * d / (w * w)) * (0.25 + 1.6 * b) + 0.18 * b * exp(-d / 0.035);
    vec3 c = hsv(mix(hueA, hueB, fi / 7.0) + 0.04 * fi, 0.75, 1.0);
    col = col + c * g * (0.55 + 0.6 * trail * lit);
  }
  if (grid > 0.5) {
    float R0 = 0.47 * scale;
    float st = fmod(floor(fmod((PI * 0.5 - a) / TAU, 1.0) * 16.0 + 0.5), 16.0);
    float stepAng = PI * 0.5 - st * TAU / 16.0;
    float da = abs(fmod(a - stepAng + PI, TAU) - PI) * r;
    float len = 0.015;
    if (fmod(st, 4.0) < 0.5) { len = 0.032; }
    float tick = (1.0 - smoothstep(0.0015, 0.004, da)) * step(R0, r) * step(r, R0 + len);
    float cur = 0.0;
    if (abs(fmod(floor(phase * 16.0), 16.0) - st) < 0.5) { cur = 1.0; }
    col = col + vec3(0.45 + 0.9 * cur, 0.45 + 0.9 * cur, 0.45 + 0.9 * cur) * tick * 0.7;
  }
  float dh = abs(fmod(a - ang + PI, TAU) - PI) * r;
  col = col + hsv(hueB, 0.3, 1.0) * (1.0 - smoothstep(0.0, 0.006, dh)) * step(0.07, r) * step(r, 0.5 * scale) * 0.5;
  float kr = 0.05 + 0.05 * punch;
  col = col + hsv(hueA, 0.4, 1.0) * ((1.0 - smoothstep(kr - 0.01, kr, r)) * (0.25 + 1.2 * punch) + 0.6 * punch * exp(-r * 6.0));
  float sx = (r - (0.08 + shockAge * 0.9)) / 0.012;
  col = col + vec3(1.0, 0.95, 0.9) * shock * exp(-sx * sx) * 0.9;
  vec2 pc2 = vec2((a + PI) / TAU * 48.0, r * 36.0);
  float hs = hash(floor(pc2) + vec2(seed * 1.37, seed * 0.71));
  vec2 off = (fract(pc2) - 0.5) * vec2(r * TAU / 48.0 * 36.0, 1.0);
  float dotm = 1.0 - smoothstep(0.12, 0.32, length(off));
  col = col + hsv(hueB + 0.1, 0.3, 1.0) * step(1.0 - 0.12 * sparks, hs) * dotm * smoothstep(0.38, 0.5, r) * sparks * 2.0;
${PASS}${SMOKE}
  OUT(finish(col, level, flash, darken));
}`,
    ribbon: `
void main() {${HEAD}
  vec3 col = mix(hsv(hueA, 0.6, 0.05 + 0.10 * glow), hsv(hueB, 0.6, 0.02), clamp(p.y + 0.5, 0.0, 1.0));
  float xr = p.x / (res.x / res.y) + 0.5;
  for (int i = 0; i < 8; i++) {
    float b = band(i);
    float fi = float(i);
    float bx = abs(xr - (0.06 + 0.125 * fi));
    col = col + hsv(mix(hueA, hueB, fi / 7.0), 0.6, 1.0) * b * 0.10 * (1.0 - smoothstep(0.0, 0.05, bx)) * sfall(0.0, -0.5, p.y);
  }
  float lane = fract(p.y * 9.0 + hash(vec2(floor(p.y * 9.0), 7.0)) * 3.0);
  float sl = fract(xr * 3.0 + time * (0.2 + 2.5 * streaks) + hash(vec2(floor(p.y * 9.0), 3.0)));
  col = col + hsv(hueB, 0.4, 1.0) * streaks * 0.35 * smoothstep(0.85, 1.0, sl) * smoothstep(0.45, 0.5, lane) * (1.0 - smoothstep(0.5, 0.55, lane));
  float hx = xr / 0.8;
  float pv = pitchAt(hx);
  if (hx <= 1.0 && pv >= 0.0) {
    float y0 = -0.42 + 0.84 * pv;
    float wv = ripple * 0.025 * sin(hx * 60.0 - time * rippleRate * TAU) * smoothstep(0.6, 1.0, hx);
    float jag = rough * 0.02 * (hash(vec2(floor(hx * 160.0), floor(time * 15.0))) - 0.5);
    float d = abs(p.y - y0 - wv - jag);
    float w = 0.004 + 0.012 * level * smoothstep(0.0, 1.0, hx);
    float g = exp(-d * d / (w * w)) + 0.35 * exp(-d / 0.03);
    col = col + hsv(mix(hueA, hueB, hx) + 0.05, 0.55, 1.0) * g * (0.25 + 0.9 * hx);
  }
  if (pitchOn > 0.5) {
    vec2 hd = p - vec2((0.8 - 0.5) * res.x / res.y, -0.42 + 0.84 * pitchNow);
    float hr = length(hd);
    col = col + hsv(hueB, 0.3, 1.0) * (exp(-hr * hr / 0.0004) * (0.6 + 1.4 * punch) + 0.25 * exp(-hr / 0.06));
    float sx = (hr - (0.02 + shockAge * 0.6)) / 0.008;
    col = col + vec3(1.0, 0.95, 0.9) * shock * exp(-sx * sx) * 0.8;
    vec2 sp = hd * 30.0;
    float hs = hash(floor(sp) + vec2(seed * 1.37, seed * 0.71));
    col = col + hsv(hueB + 0.1, 0.3, 1.0) * step(1.0 - 0.25 * sparks, hs) * (1.0 - smoothstep(0.1, 0.35, length(fract(sp) - 0.5))) * sfall(0.25, 0.05, hr) * sparks * 2.0;
  }
  float bar = 0.0;
  if (phase >= 0.0) { bar = exp(-phase * 6.0); }
  col = col + hsv(hueA, 0.3, 1.0) * bar * 0.12 * sfall(-0.3, -0.5, p.y);
${PASS}${SMOKE}
  OUT(finish(col, level, flash, darken));
}`,
    forge: `
void main() {${HEAD}
  vec2 q = p;
  float haze = rough * 0.014 * (noise(vec2(q.x * 18.0, q.y * 18.0 - time * 5.0)) - 0.5);
  q = q + vec2(haze, haze * 0.5);
  float low = (band(0) + band(1) + band(2)) / 3.0;
  float high = (band(5) + band(6) + band(7)) / 3.0;
  float heat = clamp(0.3 + 0.55 * glow + 0.7 * punch + 0.35 * low, 0.0, 1.8);
  vec2 mc = vec2(0.0, -0.3);
  float light = heat * exp(-length((q - mc) * vec2(1.0, 1.4)) * 2.4);
  float row = floor(q.y * 11.0);
  vec2 bq = vec2(q.x * 5.5 + 0.5 * fmod(row, 2.0), q.y * 11.0);
  vec2 bf = fract(bq);
  float mortar = smoothstep(0.0, 0.06, bf.x) * sfall(1.0, 0.94, bf.x) * smoothstep(0.0, 0.1, bf.y) * sfall(1.0, 0.9, bf.y);
  float brick = 0.55 + 0.45 * hash(floor(bq));
  vec3 col = vec3(0.30, 0.17, 0.12) * brick * (0.15 + 0.85 * mortar) * (0.06 + light) + hsv(hueA, 0.4, 0.03);
  float ax = q.x / 0.3;
  float archTop = -0.2 + 0.14 * sqrt(max(0.0, 1.0 - ax * ax));
  float inside = step(abs(ax), 1.0) * step(q.y, archTop) * step(-0.5, q.y);
  float rimD = max(abs(ax) - 1.0, q.y - archTop);
  float rim = (1.0 - smoothstep(0.0, 0.05, abs(rimD))) * step(-0.5, q.y);
  col = mix(col, vec3(0.05, 0.04, 0.04) + vec3(0.5, 0.25, 0.1) * light * 0.3, rim);
  float fy = (q.y + 0.5) / max(0.05, archTop + 0.5);
  float tongues = noise(vec2(q.x * 9.0, q.y * 6.0 - time * 3.5)) * 0.6 + noise(vec2(q.x * 21.0 + 2.0, q.y * 13.0 - time * 6.0)) * 0.4;
  float fire = clamp(heat * (1.15 - fy) + tongues * 0.6 * heat - 0.25, 0.0, 1.6);
  vec3 fc2 = mix(vec3(0.6, 0.06, 0.02), vec3(1.0, 0.55, 0.12), clamp(fire, 0.0, 1.0));
  fc2 = mix(fc2, vec3(1.0, 0.93, 0.7), clamp(fire - 0.8, 0.0, 1.0));
  col = mix(col, fc2 * (0.35 + fire), inside);
  for (int k = 0; k < 10; k++) {
    float fk = float(k);
    float t0 = hash(vec2(seed, fk));
    float vx = (hash(vec2(seed + 1.0, fk)) - 0.5) * 1.4;
    float age = fract(time * (0.5 + 1.4 * streaks) + t0);
    vec2 e = vec2(vx * age * 0.8, -0.22 + age * (1.1 - 0.9 * age));
    float de = length(q - e);
    col = col + vec3(1.0, 0.72, 0.3) * (0.12 + 2.0 * sparks + 0.3 * high) * exp(-de * de / 0.00003) * (1.0 - age);
  }
  vec2 sc = vec2(q.x * 30.0, (q.y + 0.2) * 30.0 - time * (2.0 + 6.0 * streaks));
  float hs = hash(floor(sc) + vec2(seed * 1.37, seed * 0.71));
  float spark = step(1.0 - 0.1 * sparks, hs) * (1.0 - smoothstep(0.08, 0.25, length(fract(sc) - 0.5)));
  col = col + vec3(1.0, 0.8, 0.4) * spark * sparks * 2.2 * step(-0.2, q.y) * sfall(0.45, 0.1, abs(q.x));
  vec2 m = (q - mc) * vec2(1.0, 1.5);
  float sx = (length(m) - (0.05 + shockAge * 1.1)) / 0.014;
  col = col + vec3(1.0, 0.88, 0.7) * shock * exp(-sx * sx) * 0.9;
  float wob = ripple * 0.5 * (0.5 + 0.5 * sin(time * rippleRate * TAU));
  col = col * (1.0 - 0.3 * wob * smoothstep(0.15, 0.6, r));
${PASS}${SMOKE}
  OUT(finish(col, level, flash, darken));
}`
  };

  // GLSL (the subset above) to WGSL
  function toWGSL(src) {
    const T = { float: "f32", int: "i32", vec2: "vec2f", vec3: "vec3f", vec4: "vec4f" };
    let s = src;
    s = s.replace(/const (float|int) (\w+) = /g, (_, t, n) => "const " + n + ": " + T[t] + " = ");
    s = s.replace(/\b(float|int|vec2|vec3|vec4) (\w+)\(([^)]*)\) \{/g, (_, t, n, args) => "fn " + n + "(" + args.split(",").map(a => a.trim()).filter(Boolean).map(a => { const [at, an] = a.split(/\s+/); return an + ": " + T[at]; }).join(", ") + ") -> " + T[t] + " {");
    s = s.replace(/for \(int (\w+) = /g, "for (var $1 = ");
    s = s.replace(/\b(float|int|vec2|vec3|vec4) (\w+) = /g, (_, t, n) => "var " + n + ": " + T[t] + " = ");
    s = s.replace(/\b(vec2|vec3|vec4)\(/g, (_, t) => T[t] + "(");
    s = s.replace(/\bfloat\(/g, "f32(").replace(/\bint\(/g, "i32(");
    s = s.replace(/\batan\(/g, "atan2(");
    s = s.replace(/\bU\[/g, "u.v[");
    return s;
  }
  function wgslOf(name) {
    const body = toWGSL(COMMON + SCENES[name])
      .replace("void main() {", "@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {")
      .replace("FRAGCOORD", "vec2f(fc.x, u.v[6].w - fc.y)")
      .replace(/OUT\(([\s\S]*?)\);\n\}$/, "return vec4f($1, 1.0);\n}");
    return `struct Uniforms { v: array<vec4f, 22> };
@group(0) @binding(0) var<uniform> u: Uniforms;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var q = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(-1.0, 1.0), vec2f(3.0, 1.0));
  return vec4f(q[i], 0.0, 1.0);
}` + body;
  }
  function glslOf(name) {
    return `#version 300 es
precision highp float;
precision highp int;
uniform vec4 U[22];
out vec4 o;` + (COMMON + SCENES[name]).replace("FRAGCOORD", "gl_FragCoord.xy").replace(/OUT\(([\s\S]*?)\);\n\}$/, "o = vec4($1, 1.0);\n}");
  }
  const VERT = `#version 300 es
void main() { vec2 p[3] = vec2[3](vec2(-1.0, -3.0), vec2(-1.0, 1.0), vec2(3.0, 1.0)); gl_Position = vec4(p[gl_VertexID], 0.0, 1.0); }`;

  // a drive as 88 floats
  function pack(d, time, w, h, out) {
    const f = out || new Float32Array(88), b = d.bands || [];
    f.set([time, d.level, d.phase, d.beatPhase, d.flash, d.darken, d.punch, d.shockwave, Math.min(d.shockAge, 9), d.sparks, d.sparkSeed, d.streaks,
      d.shake, d.glow, d.smoke, d.rough, d.passX, d.passOn, d.ripple, d.spin, d.hueA, d.hueB, d.grid, d.pitchOn, d.pitchNow, d.rippleRate || 6, w, h]);
    for (let i = 0; i < 8; i++) f[28 + i] = b[i] || 0;
    const hist = d.pitchHist || [];
    for (let i = 0; i < 48; i++) f[36 + i] = hist[i] == null ? -1 : hist[i];
    return f;
  }

  // WebGPU: one device, a pipeline per scene, a context and a uniform buffer per canvas
  async function webgpu(canvases) {
    if (!(typeof navigator !== "undefined" && navigator.gpu)) return null;
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice(), format = navigator.gpu.getPreferredCanvasFormat(), pipes = {};
    for (const name of Object.keys(SCENES)) {
      const module = device.createShaderModule({ code: wgslOf(name) });
      const info = module.getCompilationInfo ? await module.getCompilationInfo() : null;
      if (info && info.messages.some(m => m.type === "error")) throw new Error("WGSL " + name + ": " + info.messages.filter(m => m.type === "error").map(m => m.lineNum + ": " + m.message).join("; "));
      pipes[name] = device.createRenderPipeline({ layout: "auto", vertex: { module, entryPoint: "vs" }, fragment: { module, entryPoint: "fs", targets: [{ format }] }, primitive: { topology: "triangle-list" } });
    }
    const views = canvases.map(cv => {
      const ctx = cv.getContext("webgpu"); ctx.configure({ device, format, alphaMode: "opaque" });
      const buf = device.createBuffer({ size: 88 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const groups = {}; for (const n in pipes) groups[n] = device.createBindGroup({ layout: pipes[n].getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buf } }] });
      return { cv, ctx, buf, groups, f: new Float32Array(88) };
    });
    return {
      name: "WebGPU",
      draw(k, scene, d, time) {
        const v = views[k], f = pack(d, time, v.cv.width, v.cv.height, v.f);
        device.queue.writeBuffer(v.buf, 0, f);
        const enc = device.createCommandEncoder();
        const pass = enc.beginRenderPass({ colorAttachments: [{ view: v.ctx.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
        pass.setPipeline(pipes[scene]); pass.setBindGroup(0, v.groups[scene]); pass.draw(3); pass.end();
        device.queue.submit([enc.finish()]);
      }
    };
  }
  // WebGL 2: a context per canvas, a program per scene
  function webgl2(canvases) {
    const views = [];
    for (const cv of canvases) {
      const gl = cv.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
      if (!gl) return null;
      const sh = (type, src, name) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("GLSL " + name + ": " + gl.getShaderInfoLog(s)); return s; };
      const progs = {};
      for (const name of Object.keys(SCENES)) {
        const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT, "vertex")); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, glslOf(name), name)); gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("GLSL " + name + ": " + gl.getProgramInfoLog(prog));
        progs[name] = { prog, loc: gl.getUniformLocation(prog, "U") };
      }
      views.push({ cv, gl, progs, vao: gl.createVertexArray(), f: new Float32Array(88) });
    }
    return {
      name: "WebGL 2",
      draw(k, scene, d, time) {
        const v = views[k], gl = v.gl, pr = v.progs[scene];
        gl.viewport(0, 0, v.cv.width, v.cv.height); gl.useProgram(pr.prog); gl.bindVertexArray(v.vao);
        gl.uniform4fv(pr.loc, pack(d, time, v.cv.width, v.cv.height, v.f));
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    };
  }
  // WebGPU where the browser has it (prefer "webgl2" asks otherwise), else WebGL 2
  async function create(canvases, prefer) {
    if (prefer !== "webgl2") { try { const r = await webgpu(canvases); if (r) return r; } catch (e) { console.warn("WebGPU not used:", e.message || e); } }
    return webgl2(canvases);
  }
  const api = { create, pack, scenes: Object.keys(SCENES), wgslOf, glslOf, toWGSL };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.AVScene = api;
})(typeof self !== "undefined" ? self : this);
