const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.bmp', '.webp', '.tiff'];
const DEFAULT_IMAGES_FOLDER = path.resolve(__dirname, '..', 'attachments');
const DEFAULT_API_RESPONSE_PATH = path.join(__dirname, 'response.json');

function normalizeKey(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeAttachmentAddtype(value) {
  const addType = normalizeKey(value).replace(/\s+/g, ' ');

  if (['RV', 'RESIDENCE', 'RESIDENCE VERIFICATION'].includes(addType)) {
    return 'RV';
  }
  if (['OV', 'BV', 'OFFICE', 'OFFICE VERIFICATION', 'BUSINESS', 'BUSINESS VERIFICATION'].includes(addType)) {
    return 'OV';
  }

  return '';
}

function readApiData(apiDataOrJsonPath) {
  if (typeof apiDataOrJsonPath !== 'string') {
    return apiDataOrJsonPath;
  }

  if (!fs.existsSync(apiDataOrJsonPath)) {
    throw new Error(`CRM response file was not found: ${apiDataOrJsonPath}`);
  }

  const raw = fs.readFileSync(apiDataOrJsonPath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Could not parse API JSON from ${apiDataOrJsonPath}: ${error.message}`);
  }
}

/**
 * Copies the parent image named "test" to token-specific RV or OV filenames.
 *
 * @param {string} folderPath folder that contains the parent image, for example test.jpg
 * @param {object|string} apiDataOrJsonPath CRM list response object or a JSON/text-file path
 * @param {object} [options]
 * @param {string[]} [options.imageExtensions]
 * @param {boolean} [options.overwrite=false] replace an existing destination file
 * @returns {string[]} absolute paths of the created copies
 */
function duplicateImagesByTokenAndAddtype(folderPath, apiDataOrJsonPath, options = {}) {
  const imageExtensions = new Set(
    (options.imageExtensions || DEFAULT_IMAGE_EXTENSIONS).map((extension) => extension.toLowerCase()),
  );
  const overwrite = options.overwrite === true;
  const apiData = readApiData(apiDataOrJsonPath);
  const records = Array.isArray(apiData?.data) ? apiData.data : [];

  if (records.length === 0) {
    console.log('No records found in API data. No images were copied.');
    return [];
  }

  const targets = [];

  for (const record of records) {
    const tokenId = String(record.tokenid || '').trim();
    const rawAddType = normalizeKey(record.addtype);
    const addType = normalizeAttachmentAddtype(rawAddType);

    if (!tokenId || !addType) {
      console.log(`[SKIP RECORD] Missing tokenid or unsupported addtype: ${rawAddType || '(empty)'}.`);
      continue;
    }

    targets.push({ tokenId, addType });
  }

  const sourceFolder = path.resolve(folderPath);
  if (!fs.existsSync(sourceFolder) || !fs.statSync(sourceFolder).isDirectory()) {
    throw new Error(`Image folder does not exist or is not a folder: ${sourceFolder}`);
  }

  if (targets.length === 0) {
    console.log('No records with both tokenid and addtype were found. No images were copied.');
    return [];
  }

  const parentImages = fs.readdirSync(sourceFolder).filter((fileName) => {
    const imagePath = path.join(sourceFolder, fileName);
    const extension = path.extname(fileName).toLowerCase();
    return fs.statSync(imagePath).isFile()
      && imageExtensions.has(extension)
      && path.basename(fileName, extension).toLowerCase() === 'test';
  });

  if (parentImages.length === 0) {
    throw new Error(`Parent image not found in ${sourceFolder}. Add one image named test.jpg, test.png, or another supported image extension.`);
  }
  if (parentImages.length > 1) {
    throw new Error(`More than one parent image named "test" was found: ${parentImages.join(', ')}. Keep only one.`);
  }

  const parentFileName = parentImages[0];
  const parentPath = path.join(sourceFolder, parentFileName);
  const parentExtension = path.extname(parentFileName).toLowerCase();
  const createdFiles = [];
  const skippedExisting = [];
  console.log(`Using parent image: ${parentFileName}`);

  for (const { tokenId, addType } of targets) {
    const destinationName = `${tokenId}_${addType}${parentExtension}`;
    const destinationPath = path.join(sourceFolder, destinationName);

    if (fs.existsSync(destinationPath) && !overwrite) {
      skippedExisting.push(destinationPath);
      console.log(`[SKIP EXISTS] ${destinationName} (use --overwrite to replace it)`);
      continue;
    }

    fs.copyFileSync(parentPath, destinationPath);
    createdFiles.push(destinationPath);
    console.log(`[CREATED] ${parentFileName} -> ${destinationName}`);
  }

  console.log(`\nDone. Created ${createdFiles.length} image duplicate(s); skipped ${skippedExisting.length} existing file(s).`);
  return createdFiles;
}

function printUsage() {
  console.log(`
Setup:
  1. Put the source image(s) in: ${DEFAULT_IMAGES_FOLDER}
  2. Paste the CRM list API response into: ${DEFAULT_API_RESPONSE_PATH}
  3. Run: npm run dev:duplicate-images

The source image must be named test, for example:
  test.jpg  ->  2768307_RV.jpg
  test.png  ->  2768307_RV.png

Use this only when you intentionally want to replace already-created files:
  npm run dev:duplicate-images -- --overwrite
`);
}

function main() {
  const argumentsList = process.argv.slice(2);
  if (argumentsList.includes('--help') || argumentsList.includes('-h')) {
    printUsage();
    return;
  }

  const overwrite = argumentsList.includes('--overwrite');
  const positionalArguments = argumentsList.filter((argument) => argument !== '--overwrite');

  if (positionalArguments.length > 0) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  console.log(`Using image folder: ${DEFAULT_IMAGES_FOLDER}`);
  console.log(`Using CRM response: ${DEFAULT_API_RESPONSE_PATH}`);
  duplicateImagesByTokenAndAddtype(DEFAULT_IMAGES_FOLDER, DEFAULT_API_RESPONSE_PATH, { overwrite });
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Image duplication failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  duplicateImagesByTokenAndAddtype,
};
