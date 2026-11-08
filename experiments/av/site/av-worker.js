// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// Works out both sides off the page's thread: the usual signals (drivers.js) and Playhead's analysis.
"use strict";
importScripts("../dist/playhead-core.js", "drivers.js");
onmessage = async e => {
  const { id, sr, channels, name } = e.data;
  try {
    const mono = channels.length === 1 ? channels[0] : Float32Array.from(channels[0], (v, i) => channels.reduce((s, c) => s + c[i], 0) / channels.length);
    postMessage({ id, standard: AVDrivers.standardDrivers(mono, sr) });
    const doc = await Playhead.analyze({ sampleRate: sr, channels }, { profile: "music", name, onProgress: p => postMessage({ id, progress: p }) });
    postMessage({ id, doc });
  } catch (err) { postMessage({ id, error: String((err && err.message) || err) }); }
};
