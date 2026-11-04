# Người bạn học: technical pilot results

**Date:** 2026-11-05
**Related issues:** [#76](https://github.com/tangkhatnk/khkt26-27/issues/76), [#72](https://github.com/tangkhatnk/khkt26-27/issues/72).
**Protocol:** [2026-11-04 evaluation protocol](2026-11-04-nguoi-ban-hoc-evaluation-protocol.md).

## Scope and limits

This pilot contains an OCR smoke run on 40 pinned CC0 synthetic Vietnamese text-line images, a separate nine-page natural printed-Vietnamese OCR stratum, 10 synthetic QA fixtures, and scripted functional tasks. No learner or production data was used. No participant study ran; Day 7 and Day 30 outcomes remain unmeasured, so #72 remains open.

The synthetic stratum contains synthetic Vietnamese print only. The separate natural stratum measures page-level text recognition on nine first-page scans of Vietnamese government documents. Natural printed English, handwriting, page-layout/structure accuracy, and multi-page document accuracy remain unmeasured. No gated or terms-restricted corpus was accessed: VietHTR-Line and CAMIO remain subject to their access terms, and UIT-HWDB remains unused unless its maintainers confirm reuse terms. These small OCR strata do not establish general real-document accuracy or that Viễn Du improves learning.

## OCR path

The runner invoked the existing `extractImageWithOcr()` from `src/material/ocrMaterial.mjs` with the app's local Tesseract.js worker and language data. It processed all 40 `nrl-ai/vn-synthetic-ocr` cases at immutable revision [`7c1c9114c610150b8b36783f089199eee62348b2`](https://huggingface.co/datasets/nrl-ai/vn-synthetic-ocr/tree/7c1c9114c610150b8b36783f089199eee62348b2), 20 clean and 20 noisy. SHA-256 checks matched the 42-file manifest at `docs/research/vn-synthetic-ocr-7c1c9114.sha256`; images and transcripts were stored under `/tmp`, not in Git.

| Stratum | n | Micro CER | Macro CER | Micro WER | Macro WER | Mean time/image | Median | P95 | Failures / timeouts |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Clean synthetic print | 20 | 2.273% | 2.401% | 9.160% | 9.257% | 463.11 ms | 458.20 ms | 518.96 ms | 0 / 0 |
| Noisy synthetic print | 20 | 3.846% | 3.890% | 14.504% | 14.332% | 449.32 ms | 451.495 ms | 500.77 ms | 0 / 0 |
| Combined | 40 | 3.059% | 3.145% | 11.832% | 11.794% | 456.21 ms | 458.20 ms | 507.32 ms | 0 / 0 |

CER uses Unicode code-point edit distance; WER uses whitespace-delimited tokens. For Vietnamese, those tokens are syllable-like units, not word-segmented words. Text was normalized to NFC and line endings, outer whitespace was trimmed, while case, punctuation, diacritics, and internal whitespace were retained. Micro rates pool edits over all reference units; macro rates average per-image rates. Mean Tesseract confidence was 95.15 clean, 93.80 noisy, and 94.48 combined. Each image used a fresh worker. Time runs from immediately before `extractImageWithOcr()` until it returns, including worker startup and OCR, but excluding asynchronous shutdown completion. Timings below come from one saved run recorded at 2026-11-04 18:51:37 UTC. Even-sample medians average the two middle observations.

The clean and noisy rows share all 20 metadata IDs. The mean paired per-image CER difference (clean minus noisy) was −1.489 percentage points; a deterministic paired percentile bootstrap (100,000 resamples, seed `20261105`) gave a 95% interval of [−2.808, −0.232] percentage points. This descriptive interval is based on only 20 synthetic pairs and does not estimate natural-document performance.

Engine/runtime: Tesseract.js 7.0.0, `tesseract.js-core` 7.0.0, `@tesseract.js-data/eng` 1.0.0, `@tesseract.js-data/vie` 1.0.0, trained data `4.0.0_best_int`, languages `eng+vie`, LSTM OEM 1; Node 24.16.0 on `darwin-x64`, Darwin 25.6.0. Language files were generated under local `public/ocr/lang`; no CDN was used. The app's OCR result remained marked `needs-review` for all cases.

Reproduce from the repository root after installing dependencies and preparing local OCR assets:

```sh
data_dir="$(mktemp -d)"
GIT_LFS_SKIP_SMUDGE=1 git clone https://huggingface.co/datasets/nrl-ai/vn-synthetic-ocr "$data_dir"
git -C "$data_dir" checkout --detach 7c1c9114c610150b8b36783f089199eee62348b2
node scripts/prepare-material-worker.mjs
node scripts/evaluation/run-ocr.mjs \
  --dataset-dir "$data_dir" \
  --manifest docs/research/vn-synthetic-ocr-7c1c9114.sha256 \
  --output /tmp/viendu-ocr-results.json
```

The runner hydrates Git LFS pointer files from the same immutable Hugging Face revision and verifies every manifest hash before OCR.

## Natural printed-Vietnamese OCR

The app's existing `extractImageWithOcr()` path was run against all nine rows in the `real` / `test` config of [`nrl-ai/vn-ocr-documents-eval` at revision `36f3060fd7628937c77c1b1e2a95892f24f562e0`](https://huggingface.co/datasets/nrl-ai/vn-ocr-documents-eval/tree/36f3060fd7628937c77c1b1e2a95892f24f562e0). Each row contains a page-1 image and a reference transcription. The pinned [README](https://huggingface.co/datasets/nrl-ai/vn-ocr-documents-eval/blob/36f3060fd7628937c77c1b1e2a95892f24f562e0/README.md) says the reference text is a human-verified visual transcription and notes that only page 1 is included. All nine metadata `license` fields declare Public Domain and cite Luật SHTT Việt Nam, Điều 15; the pinned [dataset LICENSE](https://huggingface.co/datasets/nrl-ai/vn-ocr-documents-eval/blob/36f3060fd7628937c77c1b1e2a95892f24f562e0/LICENSE) repeats that per-record basis. This report relies on those dataset-author declarations and cited law, and is not an independent legal opinion. The source entries and upstream PDFs were checked one by one; all nine official source URLs returned HTTP 200 with `application/pdf` on 2026-11-05. No source PDF was downloaded. The dataset author's README/LICENSE says the records contain no personal data and that any named officials appear in official capacity. Review of row titles, issuers, and source descriptions found government acts from chinhphu.vn or hanoi.gov.vn; none of the nine rows was excluded.

The current-law references are the [Intellectual Property Law, Article 15](https://vbpl.moj.gov.vn/bovanhoathethao/pages/vbpqen-toanvan.aspx?ItemID=5978) and [Law 131/2025/QH15](https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/01/luat131-2025.pdf). They are included for provenance only; this pilot does not independently determine the legal status of any work.

| Dataset row | Pinned upstream source | Per-row dataset declaration | CER | WER | Mean confidence | Time / page | Failure / timeout |
|---|---|---|---:|---:|---:|---:|---:|
| `real_qd_729_ttg` | [chinhphu.vn PDF](https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/4/729-ttg.signed.pdf) | Author-declared Public Domain¹ | 19.53% | 28.65% | 89 | 4,114.49 ms | 0 / 0 |
| `real_cv_3722_metro` | [chinhphu.vn PDF](https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/4/3722-cn.signed.pdf) | Author-declared Public Domain¹ | 24.04% | 40.73% | 87 | 3,699.50 ms | 0 / 0 |
| `real_nq_115_ba_vi` | [chinhphu.vn PDF](https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/4/115-nqcp.signed.pdf) | Author-declared Public Domain¹ | 9.51% | 14.93% | 92 | 3,255.88 ms | 0 / 0 |
| `real_qd_707_ttg` | [chinhphu.vn PDF](https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/4/707-ttg.signed.pdf) | Author-declared Public Domain¹ | 10.35% | 17.61% | 87 | 3,021.31 ms | 0 / 0 |
| `real_tt_21_bct_fuel` | [chinhphu.vn PDF](https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/4/21-bct.signed.pdf) | Author-declared Public Domain¹ | 13.79% | 29.10% | 86 | 4,049.53 ms | 0 / 0 |
| `real_hanoi_qd_2280_water` | [hanoi.gov.vn PDF](https://datafiles.hanoi.gov.vn/gov-hni/6244/VanBan/2026/4/29/QD-2280-2026.pdf) | Author-declared Public Domain¹ | 13.70% | 25.00% | 92 | 3,208.40 ms | 0 / 0 |
| `real_hanoi_tb_453_flag` | [hanoi.gov.vn PDF](https://datafiles.hanoi.gov.vn/gov-hni/6235/VanBan/2026/4/29/TB-453-2026.pdf) | Author-declared Public Domain¹ | 23.29% | 35.89% | 92 | 3,158.18 ms | 0 / 0 |
| `real_hanoi_kh_173_festival` | [hanoi.gov.vn PDF](https://datafiles.hanoi.gov.vn/gov-hni/6249/VanBan/2026/4/28/KH-173-2026.pdf) | Author-declared Public Domain¹ | 10.43% | 15.51% | 95 | 3,557.71 ms | 0 / 0 |
| `real_tt_37_bca_vehicle` | [chinhphu.vn PDF](https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/4/37-bca.pdf) | Author-declared Public Domain¹ | 12.01% | 29.81% | 93 | 3,951.23 ms | 0 / 0 |

¹ Each row's metadata carries the same declaration and a `source_url`; see the pinned manifest and [per-item metadata](https://huggingface.co/datasets/nrl-ai/vn-ocr-documents-eval/blob/36f3060fd7628937c77c1b1e2a95892f24f562e0/real/metadata.jsonl).

| Natural stratum summary | Result |
|---|---:|
| Rows included / excluded | 9 / 0 |
| Micro CER / macro CER | 14.493% / 15.182% |
| Micro WER / macro WER | 25.426% / 26.357% |
| Mean / median / P95 time | 3,557.36 / 3,557.71 / 4,114.49 ms |
| Mean Tesseract confidence | 90.33 |
| Failures / timeouts | 0 / 0 |

CER is Unicode code-point Levenshtein distance divided by reference length; WER uses whitespace tokens, which are syllable-like rather than word-segmented units for Vietnamese. Both use NFC normalization, collapse all whitespace, trim ends, and preserve case, punctuation, and diacritics. The results file records per-page counts and metrics but contains no OCR transcript or image. The app marked all nine OCR results `needs-review`. The app's OCR limit is 120 seconds; no case timed out. Runtime was Tesseract.js 7.0.0, `tesseract.js-core` 7.0.0, English and Vietnamese language packages 1.0.0, trained data `4.0.0_best_int`, languages `eng+vie`, LSTM OEM 1, Node 24.16.0 on `darwin-x64` / Darwin 25.6.0. Locally generated language data was used without a CDN request. Timing includes worker startup and OCR through `extractImageWithOcr()` return, and excludes asynchronous worker shutdown. Results came from the saved run at 2026-11-04 19:26:41 UTC. With n=9, these descriptive measurements are not an estimate of broad document accuracy. No handwriting, layout, table, formula, or English accuracy was measured.

The checked-file manifest [`vn-ocr-documents-real-36f3060.sha256`](vn-ocr-documents-real-36f3060.sha256) covers the nine page images and `real/metadata.jsonl`; its SHA-256 is `cdfde136202d63d7a7168ab4490da65b9e93fc5c918bc5c3e3d7cb2eb4a2a220`. Every listed file matched. Images, metadata, transcripts, and OCR output stayed under `/tmp` and are not committed.

Reproduce from the repository root after installing dependencies:

```sh
dataset_dir="/tmp/vn-ocr-documents-eval-36f3060"
GIT_LFS_SKIP_SMUDGE=1 git clone https://huggingface.co/datasets/nrl-ai/vn-ocr-documents-eval "$dataset_dir"
git -C "$dataset_dir" checkout --detach 36f3060fd7628937c77c1b1e2a95892f24f562e0
node scripts/prepare-material-worker.mjs
node scripts/evaluation/run-natural-ocr.mjs \
  --dataset-dir "$dataset_dir" \
  --manifest docs/research/vn-ocr-documents-real-36f3060.sha256 \
  --output /tmp/viendu-natural-ocr-results-36f3060.json
```

The runner refuses any other dataset revision, checks the row-level category/license/source filters, hydrates only the nine image LFS pointers from the pinned revision when necessary, verifies the manifest hashes, and reports metadata and metrics without printing transcript text.

## Synthetic AI QA

`scripts/evaluation/ai-qa-cases.json` contains eight authored positive cases spanning Learning Tutor, Document AI, Question Generator, and Evaluation Engine, with Vietnamese and English items for grade bands 7–9. Two negative controls cover a three-option schema and an evidence excerpt absent from the source. The runner validates the app's `geminiQuestionSchema` and checks literal evidence-span presence after NFC and whitespace normalization.

| Automated check | Pass | Fail | Interpretation |
|---|---:|---:|---|
| App schema shape | 9 | 1 | The intentionally malformed schema control was rejected. |
| Literal evidence span | 9 | 1 | The intentionally absent evidence control was rejected. |
| Expected controls | 10 / 10 | — | Both negative controls triggered their expected check. |

These checks do not establish semantic evidence support, answer-key correctness, distractor plausibility, clarity, grade suitability, or learning effect. No provider was called; model/version, provider latency, and cost were unavailable. The cases are synthetic fixtures, not model outputs. No human ratings were collected.

For a future independent quality review, select and freeze a sample across all four task families, both languages, and the represented grade bands. Give two reviewers randomized items with source and objective while hiding model and condition labels. Have each reviewer independently rate evidence support, answer-key correctness, distractor plausibility/unambiguousness, clarity/grade suitability, and alignment to one stated objective on a shared 0–2 rubric (`0` incorrect/unsupported/unusable, `1` partially acceptable or needs revision, `2` meets the criterion). Report sample counts, per-dimension raw agreement and weighted Cohen's kappa before unblinding; send disagreements to a third reviewer for adjudication. This review has not been performed, and no human score is reported.

To pilot a real model later, save a separate permitted, de-identified input JSON with the same `suiteId`/case fields. Each case should retain its approved source and case metadata; set `item` to the model response (`question`, `options`, `correctAnswerIndex`, `explanation`, and `sourceExcerpt` are accepted) and omit `expectedAutomated` unless checking a predeclared control. Pass the file with `--cases /path/to/private-cases.json`. Keep provider, selected model/version, fallback, latency, and cost metadata in an adjacent private record; the current evaluator deliberately does not claim or synthesize them. It reports only app schema acceptance and literal evidence-span presence. Record human ratings in a separate blinded file keyed by random case/reviewer codes and the five rubric dimensions; unblind only after both reviewers submit. Do not commit learner material, identifiers, raw provider transcripts, or unreviewed private model outputs.

Run the suite with:

```sh
npm --prefix backend run evaluation:qa -- --output /tmp/viendu-ai-qa-results.json
```

## Fixed synthetic functional tasks

The scripted task used five positive synthetic questions and one fixed answer vector (`0, 1, 1, 0, 0`), which yields 3/5 against the fixture keys. This is an input to the harness, not an observed learner score.

| Condition | Scripted operations | Result | Timing / interpretation |
|---|---|---|---|
| Viễn Du guest flow | Seven injected HTTP steps: issue consented guest credential, read a synthetic document, summarize it, create a guide, start the configured timer, generate a five-item quiz, and grade it. All returned expected 2xx responses. | Script completed; 3/5 fixed assessment. | Timer target was 1,500 seconds; no wall-clock wait occurred. AI methods returned fixed synthetic responses; no Gemini/provider quality, latency, or cost was measured. |
| Timer plus ordinary review | Three computed checks in a declared local reference harness: configure 1,500 seconds, load the same five source cases, and submit the same answer vector. | All three harness checks completed; zero check failures; 3/5 fixed assessment derived from the fixture keys. | No timer app or real timer interval was run; elapsed study time was zero. This is not the full Pomodoro Technique; [Cirillo's description](https://www.pomodorotechnique.com/francesco-cirillo/) describes the broader method beyond a timer. |
| Anki | Five synthetic cards added and rated through the official Python headless library; all five scheduler answers were accepted. | Five cards processed; scheduler listed five learning cards afterward; zero harness errors; 3/5 fixed assessment. | Anki 25.9.5 headless library, scheduler v2, Basic note type, FSRS weights not configured; default learning steps 1 and 10 minutes, 20 new cards/day, 200 reviews/day, 60-second answer-time cap, desired retention 0.9. No desktop UI or elapsed study period was measured. |

The Anki run used a temporary collection and the pinned official [Anki 25.9.5 Python library](https://pypi.org/project/anki/25.9.5/) ([library source](https://github.com/ankitects/anki/tree/main/pylib)), not a learner's collection. [Anki's studying guide](https://docs.ankiweb.net/studying.html) describes revealing an answer before choosing a recall rating; [deck options](https://docs.ankiweb.net/deck-options.html) document how scheduling settings affect reviews. The app's UI was unavailable on the host, so this result covers its headless scheduler only. A timer-only baseline is intentionally not represented as a full Pomodoro implementation.

Reproduce the app route and timer-checklist harness with:

```sh
npm --prefix backend run evaluation:functional -- --output /tmp/viendu-functional-results.json
```

Reproduce the Anki scheduler operation in an isolated target directory with Python 3:

```sh
python3 -m pip install --target /tmp/anki-pilot anki==25.9.5
PYTHONPATH=/tmp/anki-pilot python3 backend/scripts/evaluation/run-anki-task.py \
  --output /tmp/viendu-anki-results.json
```

The tested host used Python 3.9.6 and emitted urllib3's LibreSSL compatibility warning during Anki import; the synthetic collection and five scheduling operations completed. The installed wheel SHA-256 was `7902f27ccf947e7c78cb34c481cf8904bc91a02f66262fbe29ccffe8128537ca`.

## Evidence status

The QA and workflow runners exercise local schemas, routes, scheduler operations, and fixed fixtures only. Their passing checks are functional evidence for the harness, not evidence that generated AI answers are correct or that any study method is superior. The planned participant comparison and immediate, 7-day, and 30-day assessment protocol remain unrun pending the permissions and recruitment described in the evaluation protocol.
