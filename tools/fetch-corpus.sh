#!/usr/bin/env sh
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Daniel Sandner
#
# Fetches the openly licensed recordings used to test Playhead on real audio (needs git; about 60 MB).
#   sh tools/fetch-corpus.sh [target-folder]      default: corpus/
# Then: node tools/batch.js corpus/sfx corpus/music --checks --fx --out batch-out
#
# Sources and licences (the recordings are not part of this repository):
#   Sonic Pi samples   CC0 1.0 (etc/samples/README.md in the Sonic Pi repository)
#   librosa example data   per file, see each .toml: CC BY 4.0, CC BY-NC 4.0, CC BY-NC-SA 4.0, public domain mark
set -e
T="${1:-corpus}"
mkdir -p "$T/src" "$T/sfx" "$T/music"
cd "$T/src"
[ -d sonic-pi ] || { git clone --depth 1 --filter=blob:none --sparse https://github.com/sonic-pi-net/sonic-pi.git sonic-pi && (cd sonic-pi && git sparse-checkout set etc/samples); }
[ -d librosa-data ] || git clone --depth 1 https://github.com/librosa/data.git librosa-data
cd ../..
for f in "$T"/src/sonic-pi/etc/samples/*.flac; do ln -sf "$(cd "$(dirname "$f")" && pwd)/$(basename "$f")" "$T/sfx/"; done
for f in "$T"/src/librosa-data/audio/*.hq.ogg; do b=$(basename "$f" .hq.ogg); ln -sf "$(cd "$(dirname "$f")" && pwd)/$(basename "$f")" "$T/music/$b.ogg"; done
echo "sound effects: $(ls "$T/sfx" | wc -l)   music, speech and nature: $(ls "$T/music" | wc -l)"
