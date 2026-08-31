// Chooses the PDF uploaded to the Axis portal. Dynamic mode uses a
// <loan-number>-<RV|OV>.pdf file; dummy mode always uses dummypdf.pdf.
const fs = require('node:fs');
const path = require('node:path');

/** Locate the newest exact case PDF for a loan and verification type. */
function findCasePdf(documentsDirectory, loanNumber, verificationType) {
    if (!fs.existsSync(documentsDirectory)) {
        throw new Error(`Documents folder does not exist: ${documentsDirectory}`);
    }

    // Escape regex characters so a loan number is always matched literally.
    const escapedLoanNumber = String(loanNumber).replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&'
    );
    const normalizedVerificationType = verificationType.toUpperCase();
    const fileNamePattern = new RegExp(
        `^${escapedLoanNumber}-${normalizedVerificationType}\\.pdf$`
    );
    // Sort newest-first in case more than one filesystem entry could match.
    const matchingFiles = fs
        .readdirSync(documentsDirectory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && fileNamePattern.test(entry.name))
        .map((entry) => {
            const filePath = path.join(documentsDirectory, entry.name);
            return { filePath, modifiedTime: fs.statSync(filePath).mtimeMs };
        })
        .sort((a, b) => b.modifiedTime - a.modifiedTime);

    if (matchingFiles.length === 0) {
        throw new Error(
            `No PDF for loan ${loanNumber} ending in ` +
            `-${normalizedVerificationType}.pdf was found in: ${documentsDirectory}`
        );
    }

    return matchingFiles[0].filePath;
}

/** Resolve either a dynamic case PDF or the configured dummy PDF. */
function resolveDocumentUploadPath({
    documentsDirectory,
    loanNumber,
    verificationType,
    useDynamicPdf,
}) {
    const normalizedFlag = String(useDynamicPdf ?? '').trim().toLowerCase();
    if (!['true', 'false'].includes(normalizedFlag)) {
        throw new Error('USE_DYNAMIC_PDF must be either true or false.');
    }

    if (normalizedFlag === 'true') {
        if (!loanNumber) {
            throw new Error('A loan number is required when USE_DYNAMIC_PDF=true.');
        }
        return findCasePdf(
            documentsDirectory,
            String(loanNumber).trim(),
            verificationType
        );
    }

    const dummyPdfPath = path.join(documentsDirectory, 'dummypdf.pdf');
    if (!fs.existsSync(dummyPdfPath)) {
        throw new Error(`Dummy PDF does not exist: ${dummyPdfPath}`);
    }
    return dummyPdfPath;
}

module.exports = { findCasePdf, resolveDocumentUploadPath };
