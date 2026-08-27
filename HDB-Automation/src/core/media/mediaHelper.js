const fs = require('fs');
const path = require('path');

const MANUAL_IMAGE_EXTENSIONS = new Set([
    '.jpg',
    '.jpeg',
    '.png',
    '.webp',
    '.gif',
    '.bmp',
    '.tif',
    '.tiff',
    '.heic',
    '.heif',
]);
const ADD_ATTACHMENT_SELECTOR = '#addAttachment';
const ATTACHMENT_FILE_INPUT_SELECTOR = [
    'input.single_file[type="file"][name^="attachedFiles"]',
    'input#single_file_0[type="file"]',
    'input[name^="attachedFiles"][type="file"]',
].join(', ');

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeVerificationType(verificationType) {
    const normalizedType = String(verificationType || '')
        .trim()
        .toLowerCase();

    if (!['rv', 'ov'].includes(normalizedType)) {
        const error = new Error(
            'Verification type must be either RV or OV.'
        );
        error.category = 'MISSING_CONFIGURATION';
        throw error;
    }

    return normalizedType;
}

async function findManualAttachments(
    tokenId,
    verificationType,
    options = {}
) {
    const normalizedTokenId = String(tokenId || '').trim();
    const normalizedType = normalizeVerificationType(
        verificationType
    );

    if (!normalizedTokenId) {
        const error = new Error(
            'Token ID is required to find manual attachments.'
        );
        error.category = 'MISSING_DATA';
        throw error;
    }

    const attachmentsDirectory = path.resolve(
        options.attachmentsDirectory ||
        path.join(process.cwd(), 'attachments')
    );
    let directoryEntries;

    try {
        directoryEntries = await fs.promises.readdir(
            attachmentsDirectory,
            { withFileTypes: true }
        );
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.warn(
                `Manual attachments folder does not exist: ` +
                `${attachmentsDirectory}`
            );
            return [];
        }
        throw error;
    }

    const fileNamePattern = new RegExp(
        `^${escapeRegExp(normalizedTokenId)}` +
        `[-_]${normalizedType}(?:[-_](\\d+))?$`,
        'i'
    );
    const matchingFiles = directoryEntries
        .filter(entry => entry.isFile())
        .map(entry => {
            const originalExtension = path.extname(entry.name);
            const extension = originalExtension.toLowerCase();

            if (!MANUAL_IMAGE_EXTENSIONS.has(extension)) {
                return null;
            }

            const baseName = path.basename(entry.name, originalExtension);
            const nameMatch = baseName.match(fileNamePattern);

            if (!nameMatch) {
                return null;
            }

            return {
                fileName: entry.name,
                imageNumber: Number(nameMatch[1] || 0),
                path: path.join(attachmentsDirectory, entry.name),
            };
        })
        .filter(Boolean)
        .sort((first, second) =>
            first.imageNumber - second.imageNumber ||
            first.fileName.localeCompare(second.fileName)
        );

    console.log(
        `Found ${matchingFiles.length} manual ` +
        `${normalizedType.toUpperCase()} image(s) for ` +
        `token ${normalizedTokenId} in ${attachmentsDirectory}`
    );

    return matchingFiles;
}

async function uploadAttachments(
    page,
    filePaths,
    options = {}
) {
    const minimumFiles = Number(
        options.minimumFiles ?? 1
    );

    if (!Number.isInteger(minimumFiles) || minimumFiles < 1) {
        throw new Error(
            'minimumFiles must be a positive integer'
        );
    }

    const suppliedPaths = (filePaths || [])
        .map(file =>
            typeof file === 'string'
                ? file
                : file?.path
        )
        .filter(Boolean)
        .map(filePath => path.resolve(filePath));

    const absolutePaths = [...new Set(
        suppliedPaths
            .filter(filePath => fs.existsSync(filePath))
    )];

    const missingPaths = suppliedPaths.filter(
        filePath => !fs.existsSync(filePath)
    );

    if (missingPaths.length > 0) {
        console.warn(
            'Skipping missing attachment files:',
            missingPaths
        );
    }

    if (absolutePaths.length < minimumFiles) {
        const error = new Error(
            `At least ${minimumFiles} attachment files are required, ` +
            `but only ${absolutePaths.length} valid file(s) were found`
        );
        error.category = 'MISSING_DOCUMENT';
        throw error;
    }

    const addAttachment = page.locator(
        ADD_ATTACHMENT_SELECTOR
    );
    await addAttachment.waitFor({
        state: 'visible',
        timeout: 10_000,
    });

    for (const absolutePath of absolutePaths) {
        const fileChooserPromise =
            typeof page.waitForEvent === 'function'
                ? page.waitForEvent('filechooser', {
                    timeout: 3_000,
                }).catch(() => null)
                : Promise.resolve(null);

        await addAttachment.click({
            timeout: 10_000,
        });

        const fileChooser = await fileChooserPromise;

        if (fileChooser) {
            await fileChooser.setFiles(absolutePath);
            continue;
        }

        const fileInput = page.locator(
            ATTACHMENT_FILE_INPUT_SELECTOR
        ).last();

        await fileInput.waitFor({
            state: 'attached',
            timeout: 10_000,
        });
        await fileInput.setInputFiles(absolutePath);
    }

    console.log(
        `Uploaded ${absolutePaths.length} attachment file(s)`
    );

    return absolutePaths;
}

async function uploadManualAttachments(
    page,
    manualAttachments,
    options = {}
) {
    return uploadAttachments(
        page,
        manualAttachments,
        {
            ...options,
            minimumFiles: options.minimumFiles ?? 1,
        }
    );
}

module.exports = {
    ADD_ATTACHMENT_SELECTOR,
    ATTACHMENT_FILE_INPUT_SELECTOR,
    findManualAttachments,
    uploadManualAttachments,
};
