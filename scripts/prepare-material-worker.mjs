import { copyFile, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function prepareMaterialWorker(projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')) {
  const officeParserPackage = JSON.parse(await readFile(path.join(projectRoot, 'node_modules/officeparser/package.json'), 'utf8'));
  const pdfJsPackagePath = path.join(projectRoot, 'node_modules/pdfjs-dist/package.json');
  const pdfJsPackage = JSON.parse(await readFile(pdfJsPackagePath, 'utf8'));
  const tesseractPackage = JSON.parse(await readFile(path.join(projectRoot, 'node_modules/tesseract.js/package.json'), 'utf8'));
  const tesseractCorePackage = JSON.parse(await readFile(path.join(projectRoot, 'node_modules/tesseract.js-core/package.json'), 'utf8'));
  const expectedPdfJsVersion = officeParserPackage.dependencies?.['pdfjs-dist'];

  if (!expectedPdfJsVersion || pdfJsPackage.version !== expectedPdfJsVersion) {
    throw new Error(
      `PDF worker mismatch: officeparser expects pdfjs-dist ${expectedPdfJsVersion ?? '(unknown)'}, ` +
      `but ${pdfJsPackage.version ?? '(unknown)'} is installed.`,
    );
  }
  if (!tesseractPackage.version || tesseractPackage.version !== tesseractCorePackage.version) {
    throw new Error(
      `Tesseract worker mismatch: tesseract.js ${tesseractPackage.version ?? '(unknown)'} ` +
      `does not match tesseract.js-core ${tesseractCorePackage.version ?? '(unknown)'}.`,
    );
  }

  const workerSource = path.join(projectRoot, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs');
  const publicDirectory = path.join(projectRoot, 'public');
  const workerDestination = path.join(publicDirectory, 'pdf.worker.min.mjs');
  await mkdir(publicDirectory, { recursive: true });
  await copyFile(workerSource, workerDestination);

  const ocrRoot = path.join(publicDirectory, 'ocr');
  const ocrCoreRoot = path.join(ocrRoot, 'core');
  const ocrLangRoot = path.join(ocrRoot, 'lang');
  await rm(ocrRoot, { recursive: true, force: true });
  await Promise.all([
    mkdir(ocrCoreRoot, { recursive: true }),
    mkdir(ocrLangRoot, { recursive: true }),
  ]);

  const tesseractWorkerSource = path.join(projectRoot, 'node_modules/tesseract.js/dist/worker.min.js');
  const tesseractWorkerDestination = path.join(ocrRoot, 'worker.min.js');
  await copyFile(tesseractWorkerSource, tesseractWorkerDestination);

  const coreSourceRoot = path.join(projectRoot, 'node_modules/tesseract.js-core');
  const availableCoreFiles = new Set(await readdir(coreSourceRoot));
  const coreFiles = [
    'tesseract-core-relaxedsimd-lstm.wasm.js',
    'tesseract-core-relaxedsimd-lstm.wasm',
    'tesseract-core-simd-lstm.wasm.js',
    'tesseract-core-simd-lstm.wasm',
    'tesseract-core-lstm.wasm.js',
    'tesseract-core-lstm.wasm',
  ];
  for (const required of coreFiles) {
    if (!availableCoreFiles.has(required)) throw new Error(`Missing required local OCR core file: ${required}`);
  }
  await Promise.all(coreFiles.map((name) => copyFile(path.join(coreSourceRoot, name), path.join(ocrCoreRoot, name))));

  const languages = ['eng', 'vie'];
  await Promise.all(languages.map(async (language) => {
    const packagePath = path.join(projectRoot, 'node_modules', '@tesseract.js-data', language, 'package.json');
    const languagePackage = JSON.parse(await readFile(packagePath, 'utf8'));
    if (!languagePackage.version) throw new Error(`Missing version for ${language} OCR language data.`);
    const source = path.join(projectRoot, 'node_modules', '@tesseract.js-data', language, '4.0.0_best_int', `${language}.traineddata.gz`);
    await copyFile(source, path.join(ocrLangRoot, `${language}.traineddata.gz`));
  }));

  return {
    workerDestination,
    version: pdfJsPackage.version,
    ocrAssets: [tesseractWorkerDestination, ...coreFiles.map((name) => path.join(ocrCoreRoot, name)), ...languages.map((language) => path.join(ocrLangRoot, `${language}.traineddata.gz`))],
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { version, ocrAssets } = await prepareMaterialWorker();
  console.log(`Prepared same-origin PDF.js worker (${version}), local bilingual OCR worker, core, and language data (${ocrAssets.length} OCR assets).`);
}
