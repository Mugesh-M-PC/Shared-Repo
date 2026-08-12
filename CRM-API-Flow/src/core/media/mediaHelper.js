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

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function findManualRvAttachments(
    tokenId,
    options = {}
) {
    const normalizedTokenId = String(tokenId || '').trim();

    if (!normalizedTokenId) {
        const error = new Error(
            'Token ID is required to find manual RV attachments.'
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
        `[-_]rv(?:[-_](\\d+))?$`,
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
        `Found ${matchingFiles.length} manual RV image(s) for ` +
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

    // console.log('Available attachment paths before upload:', absolutePaths);

    if (absolutePaths.length < minimumFiles) {
        const error = new Error(
            `At least ${minimumFiles} attachment files are required, ` +
            `but only ${absolutePaths.length} valid file(s) were found`
        );
        error.category = 'MISSING_DOCUMENT';
        throw error;
    }

    const fileInput = page.locator('input.attachment_file_input[type="file"]');

    await fileInput.waitFor({ state: 'attached', timeout: 10000 });

    // Do not click addAttachment and do not manually dispatch change.
    // setInputFiles already triggers the upload/change event.
    await fileInput.setInputFiles(absolutePaths);

    console.log(
        `Uploaded ${absolutePaths.length} attachment file(s)`
    );

    return absolutePaths;
}

async function uploadManualRvAttachments(
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
    findManualRvAttachments,
    uploadAttachments,
    uploadManualRvAttachments,
};
