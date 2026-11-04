// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
// Playhead analysis in a module worker: post { id, sampleRate, channels, opts }, receive { id, doc } or { id, error }.
// Channel arrays are transferred, not copied. Progress arrives as { id, progress } (0..1).
import Playhead from "../dist/playhead-core.mjs";

self.onmessage = async e => {
  const { id, sampleRate, channels, opts } = e.data;
  try {
    const doc = await Playhead.analyze({ sampleRate, channels }, { ...opts, onProgress: p => self.postMessage({ id, progress: p }) });
    self.postMessage({ id, doc });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
