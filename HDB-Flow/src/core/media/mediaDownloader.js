const fs = require('fs/promises');
const path = require('path');

const IMAGE_FIELDS = [
    {
        apiField: 'premise_1',
        fileLabel: 'premise_1',
    },
    {
        apiField: 'premise_2',
        fileLabel: 'premise_2',
    },
    {
        apiField: 'selfie_picture',
        fileLabel: 'selfie',
    },
];

function clean(value) {
    if (value === undefined || value === null) {
        return '';
    }
    return String(value).trim();
}

function sanitizeFolderName(value) {
    return clean(value)
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/\s+/g, ' ')
        .trim();
}

function getExtension(contentType, sourcePath) {
    const normalizedContentType = clean(contentType)
        .toLowerCase()
        .split(';')[0];

    const extensionByMimeType = {
        'image/jpeg': '.jpg',
        'image/jpg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
        'image/gif': '.gif',
        'image/bmp': '.bmp',
        'image/tiff': '.tiff',
    };

    if (extensionByMimeType[normalizedContentType]) {
        return extensionByMimeType[normalizedContentType];
    }

    const sourceExtension = path
        .extname(sourcePath.split('?')[0])
        .toLowerCase();

    return sourceExtension || '.jpg';
}

function createDocumentError(category, message) {
    const error = new Error(message);
    error.category = category;
    return error;
}

async function mediaDownloader(
    request,
    tokenId,
    apiResponse,
    options = {}
) {
    if (!apiResponse || !apiResponse.data) {
        throw createDocumentError(
            'MISSING_DATA',
            `CRM API data is missing for token ${tokenId}`
        );
    }

    const sanitizedTokenId = sanitizeFolderName(tokenId);

    if (!sanitizedTokenId) {
        throw createDocumentError(
            'MISSING_DATA',
            'Token ID is missing or invalid'
        );
    }

    const verificationType = (options.verificationType || 'RV').toUpperCase();
    const data = apiResponse.data;

    const crmBaseUrl =
        options.crmBaseUrl ||
        process.env.CRM_BASE_URL ||
        'https://banradcrm.in/';

    const minimumImages = Number(options.minimumImages ?? 1);

    if (
        !Number.isInteger(minimumImages) ||
        minimumImages < 1 ||
        minimumImages > IMAGE_FIELDS.length
    ) {
        throw createDocumentError(
            'MISSING_DATA',
            `minimumImages must be between 1 and ${IMAGE_FIELDS.length}`
        );
    }

    // Folder: output/Attachments/{tokenId}_RV
    const outputDirectory =
        options.outputDirectory ||
        path.join(
            process.cwd(),
            'output',
            'Attachments',
            `${sanitizedTokenId}_${verificationType}`
        );

    await fs.mkdir(outputDirectory, { recursive: true });

    const downloadedFiles = [];
    const unavailableImages = [];

    for (const imageDefinition of IMAGE_FIELDS) {
        const { apiField, fileLabel } = imageDefinition;

        const sourcePath = clean(data[apiField]);

        if (!sourcePath) {
            unavailableImages.push(`${apiField}: missing CRM path`);
            console.warn(
                `[DOCUMENT_SKIPPED] Token ${tokenId}: ` +
                `${apiField} is missing`
            );
            continue;
        }

        let sourceUrl;
        try {
            sourceUrl = new URL(sourcePath, crmBaseUrl).toString();
        } catch (error) {
            unavailableImages.push(
                `${apiField}: invalid URL (${error.message})`
            );
            console.warn(
                `[DOCUMENT_SKIPPED] Token ${tokenId}: ` +
                `${apiField} has an invalid URL`
            );
            continue;
        }

        // console.log(`Downloading ${apiField} for token ${tokenId}: ${sourceUrl}`);

        let response;
        try {
            response = await request.get(sourceUrl, {
                headers: {
                    Accept: 'image/*',
                    Referer: crmBaseUrl,
                },
                timeout: 30_000,
            });
        } catch (error) {
            unavailableImages.push(
                `${apiField}: request failed (${error.message})`
            );
            console.warn(
                `[DOCUMENT_SKIPPED] Token ${tokenId}: ` +
                `${apiField} request failed: ${error.message}`
            );
            continue;
        }

        if (!response.ok()) {
            unavailableImages.push(
                `${apiField}: HTTP ${response.status()}`
            );
            console.warn(
                `[DOCUMENT_SKIPPED] Token ${tokenId}: ` +
                `${apiField} returned HTTP ${response.status()}`
            );
            continue;
        }

        const headers = response.headers();
        const contentType = clean(headers['content-type']).toLowerCase();

        if (!contentType.startsWith('image/')) {
            unavailableImages.push(
                `${apiField}: invalid content type ` +
                `(${contentType || 'unknown'})`
            );
            console.warn(
                `[DOCUMENT_SKIPPED] Token ${tokenId}: ` +
                `${apiField} returned ${contentType || 'unknown'}`
            );
            continue;
        }

        let imageBuffer;
        try {
            imageBuffer = await response.body();
        } catch (error) {
            unavailableImages.push(
                `${apiField}: response read failed (${error.message})`
            );
            console.warn(
                `[DOCUMENT_SKIPPED] Token ${tokenId}: ` +
                `${apiField} response could not be read`
            );
            continue;
        }

        if (!imageBuffer || imageBuffer.length === 0) {
            unavailableImages.push(`${apiField}: empty image`);
            console.warn(
                `[DOCUMENT_SKIPPED] Token ${tokenId}: ` +
                `${apiField} is empty`
            );
            continue;
        }

        const extension = getExtension(contentType, sourcePath);

        // Filename matches old style: 2748726_RV_premise_1.jpg
        const fileName = `${sanitizedTokenId}_${verificationType}_${fileLabel}${extension}`;
        const absoluteFilePath = path.join(outputDirectory, fileName);

        const temporaryFilePath = `${absoluteFilePath}.part`;

        try {
            await fs.writeFile(temporaryFilePath, imageBuffer);
            await fs.rename(temporaryFilePath, absoluteFilePath);

            downloadedFiles.push({
                field: apiField,
                path: absoluteFilePath,
                url: sourceUrl,
            });
        } catch (error) {
            await fs.unlink(temporaryFilePath).catch(() => { });
            throw createDocumentError(
                'UPLOAD_FAILED',
                `Failed to save ${apiField} for token ${tokenId}: ${error.message}`
            );
        }

        const relativeFilePath = path
            .relative(process.cwd(), absoluteFilePath)
            .split(path.sep)
            .join('/');

        // console.log(`Downloaded ${apiField}: ${relativeFilePath}`);
    }

    if (downloadedFiles.length < minimumImages) {
        throw createDocumentError(
            'MISSING_DOCUMENT',
            `At least ${minimumImages} images are required for token ` +
            `${tokenId}, but only ${downloadedFiles.length} could be ` +
            `downloaded. Unavailable: ${unavailableImages.join('; ')}`
        );
    }

    console.log(
        `Downloaded ${downloadedFiles.length} of ` +
        `${IMAGE_FIELDS.length} available image slots for token ` +
        `${tokenId}: ` +
        path.relative(process.cwd(), outputDirectory).split(path.sep).join('/')
    );

    return downloadedFiles;
}

module.exports = {
    mediaDownloader,
};