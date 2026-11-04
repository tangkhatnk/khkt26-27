# Người bạn học Evaluation Protocol

**Related issues:** [#76](https://github.com/tangkhatnk/khkt26-27/issues/76), [#72](https://github.com/tangkhatnk/khkt26-27/issues/72).

**Status:** Protocol and source review only. The CC0 synthetic snapshot is pinned; no OCR benchmark or human review has run, and no participant or production data is included. Recheck terms and pin any additional dataset revision before use.

## Evidence boundary

Separate three kinds of evidence in every report:

1. **Product activity:** focus time, distractions, valid study time, points, and completion, defined by the current session rules. These are activity measurements, not proof of improved learning.
2. **Technical pilot:** repeatable checks of AI schemas, source support, question quality, OCR, layout, latency, and cost on frozen synthetic or licensed held-out inputs. These findings describe only the tested tasks, model versions, data, and hardware.
3. **Participant study:** pre-registered comparisons of learning and retention after real participants complete the study. No outcome can be reported before participants, permissions, and measurements exist.

Do not compare app-only metrics such as Viễn Du points directly with another tool's counts. Use common assessment outcomes and equal study time/materials for cross-tool comparisons. Report product metrics separately unless equivalent instrumentation exists in every condition.

## Repeatable technical pilot

### AI tasks and question quality

- Keep a versioned JSON suite of synthetic, de-identified cases across grade, subject, Vietnamese/English, short and long source text, and ordinary and edge-case requests. Each case contains a source, intended task, expected schema, and source-grounded answer criteria; never put private learner material in the suite.
- Exercise each route family separately: Learning Tutor, Document AI, Question Generator, and Evaluation Engine. Record selected model/version, request size, latency, provider cost where available, timeout/fallback, schema pass, and grounding pass. Select the least expensive configured model that meets that task's acceptance criteria; record any task that lacks a suitable model rather than silently routing all work to a premium model.
- For generated questions, score: schema validity; source evidence supports the stem and key; key is correct; distractors are plausible but unambiguously wrong; wording is clear and suitable for the requested grade; and the item assesses one stated objective. Automated checks can establish structure and evidence presence, not subjective clarity or factual correctness.
- For human quality review, sample outputs across grade/subject/task/model. Two reviewers independently rate each item while blinded to model and condition; adjudicate disagreements and report sample counts, raw agreement, and an appropriate inter-rater statistic. Do not publish human scores before real reviews are complete.
- Keep mock-provider contract checks separate from real-provider pilots. A mock response proves routing/validation behavior only; it does not prove Gemini quality, latency, availability, or cost.

### OCR and document structure

Freeze the OCR engine, model files, language packs, preprocessing, and input manifest. Use Unicode NFC, preserve Vietnamese diacritics, and publish normalization/tokenization rules. Report CER and WER by language, modality, and layout stratum, with sample counts, timeouts/failures, runtime, and version/hardware details. For Vietnamese, a whitespace-token WER counts syllable-like units unless a named Vietnamese tokenizer is used; label it accordingly. Report both micro and per-document macro aggregates, and use source-page clustered uncertainty intervals when page identifiers exist.

Do not present one corpus as covering all OCR cases. The primary-source review found these candidates and limits:

| Stratum | Candidate and observed terms | Use and limitation |
|---|---|---|
| Vietnamese handwriting | [VietHTR-Line](https://huggingface.co/datasets/5CD-AI/VietHTR-Line/blob/main/README.md): 60,247 line/transcription pairs, including a fixed 1,000-row test split; test/train source pages are separated. Access is gated and may be reviewed; the card states research/education use and CC BY-NC-ND 4.0. | Best candidate for a held-out Vietnamese handwriting recognition run after access is approved. It is line crops, not full-page OCR; do not redistribute images/transcriptions or treat the visible-condition labels as validated difficulty strata. |
| Printed Vietnamese and English | [CAMIO Transcription Languages (LDC2022T07)](https://catalog.ldc.upenn.edu/LDC2022T07): machine-printed images; 1,250 images per language have line transcripts and reading order, with train/validation/test partitions. The catalog lists the LDC User Agreement for non-members. | Best matched candidate for printed VI/EN, subject to access, license, and any fee approval. Use its held-out test partitions and retain per-language results. |
| Vietnamese synthetic-print smoke test | [vn-synthetic-ocr](https://huggingface.co/datasets/nrl-ai/vn-synthetic-ocr), pinned to revision [`7c1c9114c610150b8b36783f089199eee62348b2`](https://huggingface.co/datasets/nrl-ai/vn-synthetic-ocr/tree/7c1c9114c610150b8b36783f089199eee62348b2): CC0-1.0, 20 clean and 20 matched noisy Vietnamese line crops with UTF-8 NFC ground truth. | Use the 40 cases for an immediate local Tesseract-path smoke/CER regression check. This is synthetic text-line printing only, not real scans, handwriting, page layout, or an adoption benchmark. Keep corpus files out of the repository; retain only revision, row IDs, and aggregate/error metadata allowed by CC0. |
| Vietnamese handwriting alternate | [UIT-HWDB authors' repository](https://github.com/nghiangh/UIT-HWDB-dataset) reports 110,745 word, 7,273 line, and 1,144 paragraph samples but gives Google Drive links without license or terms in the repository. | Do not use until the original maintainers confirm permission and terms. A third-party Hugging Face conversion's CC BY claim does not establish rights in the original images. |
| Printed Vietnamese fallback | [vn_documents_ocr_v2](https://github.com/nrl-ai/nom-vn/tree/main/benchmarks/data/vn_documents_ocr_v2) describes public-domain government scans and per-record CC0/public-domain and other source licenses. | Possible narrow fallback after pinning a revision, reconciling its README's approximate total with the listed config counts, and selecting only records whose per-item rights and provenance are verified. It does not cover handwriting or provide a matched printed English set. |
| Unverified natural-image alternate | [VietnameseOCRdataset](https://huggingface.co/datasets/brianhuster/VietnameseOCRdataset) reports Apache-2.0 on the dataset card and about 7.3k rows. Its README is empty and it exposes only a `train` split. | Do not use yet: provenance and the basis for the dataset license are undocumented, and there is no published held-out split. |
| Layout, tables, formulas | [DocLayNet](https://huggingface.co/datasets/docling-project/DocLayNet): 80,863 pages, 11 layout classes including tables and formulas, fixed train/validation/test splits, and CDLA-Permissive-1.0. | Useful for layout detection only. It does not supply full OCR transcription ground truth and is not a Vietnamese benchmark. |
| Mixed document parsing | [OmniDocBench](https://github.com/opendatalab/OmniDocBench): current repository describes 1,651 pages with text, table, formula/LaTeX, layout, and reading-order annotations, including textbooks and handwritten notes. The dataset statement says research-only and non-commercial; language attributes shown are English, Chinese, and mixed, not Vietnamese. | Strong optional offline structure pilot only if the research-only terms fit. Do not use it for Vietnamese accuracy or redistribute its corpus. Its Apache-2.0 code license is not the dataset's license. |

There is no single reviewed source in this set that covers printed VI/EN, Vietnamese handwriting, page layout, formulas, tables, and charts under one clearly reusable license. PP-StructureV3's [official documentation](https://www.paddleocr.ai/main/en/version3.x/algorithm/PP-StructureV3/PP-StructureV3.html) describes layout detection, tables, formulas, chart understanding, and reading-order restoration, but that capability claim is not a Vietnamese chart accuracy result. Use chart/table/formula cases only when they have independently licensed ground truth; label synthetic layout cases as synthetic. Do not commit corpus files; record dataset revision, license, split, row/page identifiers or hashes, and ground-truth source in the manifest.

The [VietOCR repository](https://github.com/pbcquoc/vietocr) is Apache-2.0 code and describes Vietnamese printed/handwriting text recognition. Evaluate it as an optional line-recognition component, with the same frozen inputs and environment as the existing OCR path. The [PP-StructureV3 pipeline](https://www.paddleocr.ai/main/en/version3.x/algorithm/PP-StructureV3/PP-StructureV3.html) is a separate optional offline layout/parser comparison; neither tool's documentation is evidence of Viễn Du's accuracy.

The CC0 dataset's current `main` was resolved to commit `7c1c9114c610150b8b36783f089199eee62348b2` on 2026-11-04. The companion [SHA-256 manifest](vn-synthetic-ocr-7c1c9114.sha256) contains expected checksums for both metadata files and all 40 PNG LFS objects. To reproduce the fetch without committing the corpus:

```sh
manifest="$PWD/docs/research/vn-synthetic-ocr-7c1c9114.sha256"
data_dir="$(mktemp -d)"
GIT_LFS_SKIP_SMUDGE=1 git clone https://huggingface.co/datasets/nrl-ai/vn-synthetic-ocr "$data_dir"
git -C "$data_dir" checkout --detach 7c1c9114c610150b8b36783f089199eee62348b2
git -C "$data_dir" lfs pull --include='clean/*.png,noisy/*.png'
(cd "$data_dir" && shasum -a 256 -c "$manifest")
```

The local application pilot should run the existing Tesseract path on all 40 pinned rows, plus any natural rows whose license and held-out split have been verified by that point. Report synthetic and natural strata separately; if no natural rows are approved, say that natural-document accuracy remains unmeasured. Store only dataset revision, IDs, engine versions, CER/WER summaries, timings, failures, and allowed error metadata; do not commit corpus images or ground-truth transcripts.

## Reproducible workflow comparison

Use the same synthetic learning packet, task list, and time budget for a scripted functional comparison of:

1. Viễn Du's goal → material → focus → retrieval → evaluation flow.
2. A 25-minute timer plus ordinary review. Call this a timer baseline, not the full Pomodoro Technique: [Francesco Cirillo's official description](https://www.pomodorotechnique.com/francesco-cirillo/) says a timer alone is only one expression of the broader method.
3. Anki, with the exact app version, deck contents, options, and scheduler settings pinned. The [Anki study guide](https://docs.ankiweb.net/studying.html) describes showing an answer before a recall rating; [deck options](https://docs.ankiweb.net/deck-options.html) explain that scheduling configuration affects review intervals.

Record task completion, errors, time on the fixed tasks, and achieved score on a common assessment. This is a reproducible functional pilot, not a user study or a superiority claim. Cite [Roediger & Karpicke (2006)](https://pubmed.ncbi.nlm.nih.gov/16507066/) only as background for retrieval practice: their prose-passage experiments are not evidence about Viễn Du.

## Controlled study to preregister

- **Conditions:** Viễn Du; a 25-minute timer plus ordinary review; and Anki using a pinned version/configuration and the same learning materials. Allocate equal study minutes and matched material across arms. Do not describe the timer arm as a test of the full branded Pomodoro method.
- **Assignment:** Randomize learners within strata for grade, subject, baseline assessment score, and prior Anki familiarity. Calculate sample size before recruitment from a pilot-based variance estimate and a predeclared smallest educationally meaningful effect.
- **Timeline:** Day 0 baseline assessment; a fixed intervention period with equal scheduled study minutes/materials; immediate post-intervention assessment; then parallel-form retrieval assessments 7 and 30 days after the final study session.
- **Outcomes:** Predeclare 30-day recall accuracy as the primary endpoint for Viễn Du versus the timer baseline; 7-day recall, immediate score, completion, and Anki comparisons are secondary or exploratory. Assessors should not know the assigned condition. Keep the same assessment rules across groups.
- **Analysis:** Pre-register exclusions, outcomes, comparisons, and missing-data handling. Report group sizes, attrition, protocol deviations, raw scores, effect sizes, and 95% intervals. Use a repeated-measures model with participant and question clustering where the sample supports it; otherwise report the simpler planned estimator and its limits. Do not interpret underpowered or selectively complete results as proof.
- **Permissions and privacy:** Before enrolling secondary-school students, obtain applicable ethics/school approval and guardian consent/student assent. Use study IDs, keep contact/consent records separate from answers, and do not export real learning content into benchmark fixtures.

The delayed-test rationale is supported by the testing-effect literature, including the one-week retention condition in the cited paper, but it does not establish that this product or its AI improves retention. Until the study runs and its results are reviewed, keep #72 open and report only technical-pilot evidence.

## Primary sources checked on 2026-11-04

- [Francesco Cirillo: Pomodoro Technique](https://www.pomodorotechnique.com/francesco-cirillo/)
- [Anki: Studying](https://docs.ankiweb.net/studying.html) and [Deck Options](https://docs.ankiweb.net/deck-options.html)
- [Roediger & Karpicke, Test-Enhanced Learning (PubMed)](https://pubmed.ncbi.nlm.nih.gov/16507066/)
- [VietOCR repository and Apache-2.0 license](https://github.com/pbcquoc/vietocr)
- [PaddleOCR PP-StructureV3 documentation](https://www.paddleocr.ai/main/en/version3.x/algorithm/PP-StructureV3/PP-StructureV3.html)
- [VietHTR-Line dataset card](https://huggingface.co/datasets/5CD-AI/VietHTR-Line/blob/main/README.md), [CAMIO LDC catalog](https://catalog.ldc.upenn.edu/LDC2022T07), [vn-synthetic-ocr dataset card](https://huggingface.co/datasets/nrl-ai/vn-synthetic-ocr) and [pinned revision](https://huggingface.co/datasets/nrl-ai/vn-synthetic-ocr/tree/7c1c9114c610150b8b36783f089199eee62348b2), [UIT-HWDB authors' repository](https://github.com/nghiangh/UIT-HWDB-dataset), [vn_documents_ocr_v2 README](https://github.com/nrl-ai/nom-vn/tree/main/benchmarks/data/vn_documents_ocr_v2), [VietnameseOCRdataset card](https://huggingface.co/datasets/brianhuster/VietnameseOCRdataset), [DocLayNet dataset card](https://huggingface.co/datasets/docling-project/DocLayNet), and [OmniDocBench README](https://github.com/opendatalab/OmniDocBench).
