const fs = require('fs');
const path = require('path');

async function saveApiResponse(tokenId, detailsData, rawResponse = false) {
    const outputDir = path.join(process.cwd(), 'output', rawResponse ? 'Raw_ResponseData' : 'Formatted_ResponseData');
    fs.mkdirSync(outputDir, { recursive: true });

    const filePath = path.join(outputDir, `${tokenId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(detailsData, null, 2));

    console.log(`Saved API response to: ${filePath}`);
    return filePath;
}

module.exports = {
    saveApiResponse
};
