# ESC-50: do the descriptors add class information?

[ESC-50](https://github.com/karolpiczak/ESC-50) has 2,000 five-second environmental recordings in 50 classes, with an official 5-fold split. It is licensed CC BY-NC 3.0 (the ESC-10 subset CC BY 3.0) and is not part of this repository. The descriptors and their thresholds were designed and calibrated without it (`tools/tune.js` uses label-free self-checks on other files), so no parameter was fitted to these labels.

```sh
git clone --depth 1 https://github.com/karolpiczak/ESC-50.git
node tools/export-features.js ESC-50/audio --out esc50_features.csv --workers 4          # about 9 min on 2 cores
pip install librosa scikit-learn scipy
python3 experiments/esc50/librosa_baseline.py ESC-50/audio --out librosa_features.csv --jobs 4
python3 experiments/esc50/evaluate.py esc50_features.csv ESC-50/meta/esc50.csv --extra librosa_features.csv --out results.json
python3 experiments/esc50/report.py results.json --out esc50_report.html
python3 experiments/esc50/controls.py esc50_features.csv ESC-50/meta/esc50.csv --extra librosa_features.csv --out controls.json
```

## Result (`results.json`)

Accuracy, mean of the five official folds (± sd across folds):

| Features | Count | Random forest | Logistic regression |
|---|---|---|---|
| MFCC 0–12, mean and sd | 26 | 49.2 ± 2.1 % | 46.2 ± 3.8 % |
| librosa set: MFCC 0–19 and deltas, centroid, bandwidth, roll-off, flatness, ZCR, RMS, contrast, chroma | 130 | 60.6 ± 1.2 % | 59.3 ± 3.6 % |
| Psychoacoustic curves | 18 | 43.3 ± 3.5 % | 40.7 ± 2.7 % |
| Descriptors N1–N9 alone | 48 | 55.7 ± 2.5 % | 50.4 ± 3.1 % |
| MFCC + descriptors | 74 | 65.2 ± 2.3 % | 65.7 ± 2.3 % |
| librosa + descriptors | 178 | 66.8 ± 1.9 % | 67.7 ± 3.2 % |
| librosa + curves + descriptors | 196 | 68.2 ± 1.8 % | 70.0 ± 3.1 % |

Paired McNemar tests on the same 2,000 out-of-fold predictions (random forest; logistic regression in `results.json` is stronger in every case):

| From → to | Only first right | Only second right | p |
|---|---|---|---|
| MFCC → MFCC + descriptors | 128 | 447 | 2e-42 |
| librosa → librosa + descriptors | 90 | 215 | 6e-13 |
| librosa + curves → librosa + curves + descriptors | 82 | 169 | 4e-8 |
| librosa (130) → MFCC + descriptors (74) | 197 | 290 | 3e-5 |

Descriptor families added one at a time to the librosa set: repetition +2.6 points (4 features), impulsiveness +2.2, events +1.9, periodicity +1.6, motion +1.4, arrow of time +1.3, interest +1.2, decay +0.9, recurrence +0.3. Dropping any one family from the full set costs at most 0.9 points, so the families overlap. Differences below about one point are within the noise of a single forest.

Classes that gain most (F1, librosa → librosa + descriptors): engine 0.38 → 0.65, coughing 0.43 → 0.64, chainsaw 0.58 → 0.78, drinking/sipping 0.24 → 0.42, sneezing 0.59 → 0.77, car horn 0.31 → 0.46. Classes that lose: hen 0.54 → 0.37, sea waves 0.79 → 0.70.

**Can the test be fooled by extra columns?** `controls.py` adds 48 columns that carry no new information in place of the descriptors, three seeds each (`controls.json`):

| Added to the librosa set (60.6 %) | Accuracy | Real descriptors better |
|---|---|---|
| Gaussian noise | 58.7–59.9 % | p ≤ 4e-15 |
| The real descriptor values, shuffled between clips within each fold | 58.9–59.7 % | p ≤ 5e-15 |
| Copies of loudness statistics (redundant) | 55.8–57.1 % | p ≤ 2e-25 |

No control improves on the baseline; most make it slightly worse. The gain therefore comes from what the descriptors measure, not from their number or their value distributions.

For scale: the dataset's published baseline (MFCC and ZCR, random forest) is 44.3 %, human listeners 81.3 %, pretrained neural networks about 98 %. The claim is that the descriptors carry information that standard hand-crafted features lack, not that they compete with learned representations.
