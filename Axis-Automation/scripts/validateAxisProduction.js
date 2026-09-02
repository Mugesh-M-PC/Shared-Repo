const fs = require('node:fs');
const path = require('node:path');
const nodeUtil = require('node:util');
const { chromium } = require('@playwright/test');

const MINIMUM_NODE_MAJOR = 20;
const REQUIRED_ENVIRONMENT_KEYS = [
    'AXIS_PORTAL_URL',
    'CASE_LIST_API',
    'DETAILS_API',
    'CRM_CLIENT_ID',
    'CRM_API_KEY',
    'UPDATE_STATUS_API',
    'FINAL_RECOMMENDATION_ALLOWED_VALUES',
];
const HTTP_URL_KEYS = [
    'AXIS_PORTAL_URL',
    'CASE_LIST_API',
    'DETAILS_API',
    'UPDATE_STATUS_API',
];
const POSITIVE_NUMBER_KEYS = [
    'AXIS_AUTH_CHECK_INTERVAL_MS',
    'AXIS_KEEPALIVE_INTERVAL_MS',
    'POLL_INTERVAL_MS',
];

function parseArguments(argv = []) {
    let envFile = '.env.prod';

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];

        if (argument === '--env-file') {
            index += 1;
            envFile = argv[index];
        } else if (argument.startsWith('--env-file=')) {
            envFile = argument.slice('--env-file='.length);
        } else {
            throw new Error(`Unsupported validation argument: ${argument}`);
        }

        if (!envFile) {
            throw new Error('--env-file requires a file path.');
        }
    }

    return { envFile };
}

function parseEnvironmentText(contents) {
    if (typeof nodeUtil.parseEnv === 'function') {
        return nodeUtil.parseEnv(contents);
    }

    const environment = {};
    for (const sourceLine of String(contents).split(/\r?\n/)) {
        const line = sourceLine.trim();
        if (!line || line.startsWith('#')) continue;

        const separatorIndex = line.indexOf('=');
        if (separatorIndex < 1) continue;

        const key = line.slice(0, separatorIndex).trim().replace(/^export\s+/, '');
        let value = line.slice(separatorIndex + 1).trim();
        const isQuoted =
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"));
        if (isQuoted) value = value.slice(1, -1);
        environment[key] = value;
    }

    return environment;
}

function readEnvironmentFile(envFile, workspaceDirectory = process.cwd()) {
    const resolvedPath = path.resolve(workspaceDirectory, envFile);

    if (!fs.existsSync(resolvedPath)) {
        throw new Error(
            `Environment file was not found: ${resolvedPath}. ` +
            'Copy .env.prod.example to .env.prod and fill the required values.'
        );
    }

    return {
        env: {
            ...process.env,
            ...parseEnvironmentText(fs.readFileSync(resolvedPath, 'utf8')),
        },
        resolvedPath,
    };
}

function isHttpUrl(value) {
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

function collectAxisEnvironmentErrors(env = process.env) {
    const errors = [];

    for (const key of REQUIRED_ENVIRONMENT_KEYS) {
        if (!String(env[key] ?? '').trim()) {
            errors.push(`${key} is required and cannot be empty.`);
        }
    }

    for (const key of HTTP_URL_KEYS) {
        const value = String(env[key] ?? '').trim();
        if (value && !isHttpUrl(value)) {
            errors.push(`${key} must be a valid HTTP or HTTPS URL.`);
        }
    }

    for (const key of POSITIVE_NUMBER_KEYS) {
        const configured = String(env[key] ?? '').trim();
        if (!configured) continue;

        const value = Number(configured);
        if (!Number.isFinite(value) || value <= 0) {
            errors.push(`${key} must be a positive number.`);
        }
    }

    const slowMo = String(env.AXIS_SLOW_MO_MS ?? '').trim();
    if (slowMo && (!Number.isFinite(Number(slowMo)) || Number(slowMo) < 0)) {
        errors.push('AXIS_SLOW_MO_MS must be a non-negative number.');
    }

    const processLimit = String(env.PROCESS_LIMIT ?? '').trim();
    if (
        processLimit &&
        (!Number.isInteger(Number(processLimit)) || Number(processLimit) < 0)
    ) {
        errors.push('PROCESS_LIMIT must be a non-negative whole number.');
    }

    const dynamicPdf = String(env.USE_DYNAMIC_PDF ?? '').trim().toLowerCase();
    if (dynamicPdf && !['true', 'false'].includes(dynamicPdf)) {
        errors.push('USE_DYNAMIC_PDF must be true or false.');
    }

    return errors;
}

function assertAxisEnvironment(env = process.env) {
    const errors = collectAxisEnvironmentErrors(env);
    if (errors.length > 0) {
        throw new Error(
            `Invalid Axis runtime configuration:\n- ${errors.join('\n- ')}`
        );
    }
}

function assertSupportedNodeVersion(nodeVersion = process.versions.node) {
    const majorVersion = Number(String(nodeVersion).split('.')[0]);
    if (!Number.isInteger(majorVersion) || majorVersion < MINIMUM_NODE_MAJOR) {
        throw new Error(
            `Node.js ${MINIMUM_NODE_MAJOR} or newer is required; ` +
            `current version is ${nodeVersion}.`
        );
    }
}

function assertBrowserInstalled() {
    const executablePath = chromium.executablePath();
    if (!executablePath || !fs.existsSync(executablePath)) {
        throw new Error(
            'Playwright Chromium is not installed. Run ' +
            '`npx playwright install chromium` before starting the worker.'
        );
    }
    return executablePath;
}

function assertWritableDirectory(workspaceDirectory, configuredDirectory) {
    const workspacePath = path.resolve(workspaceDirectory);
    const directoryPath = path.resolve(workspacePath, configuredDirectory);
    const workspacePrefix = `${workspacePath}${path.sep}`;

    if (
        directoryPath !== workspacePath &&
        !directoryPath.startsWith(workspacePrefix)
    ) {
        throw new Error(
            `Refusing to use a directory outside the Axis workspace: ${directoryPath}`
        );
    }

    fs.mkdirSync(directoryPath, { recursive: true });
    const probePath = path.join(
        directoryPath,
        `.axis-write-check-${process.pid}-${Date.now()}`
    );

    try {
        fs.writeFileSync(probePath, 'ok', { flag: 'wx' });
    } finally {
        if (fs.existsSync(probePath)) fs.unlinkSync(probePath);
    }

    return directoryPath;
}

function validateProduction(options = {}) {
    const workspaceDirectory = path.resolve(
        options.workspaceDirectory || process.cwd()
    );
    const loaded = readEnvironmentFile(
        options.envFile || '.env.prod',
        workspaceDirectory
    );

    assertSupportedNodeVersion();
    assertAxisEnvironment(loaded.env);
    const browserExecutablePath = assertBrowserInstalled();
    const documentsPath = assertWritableDirectory(
        workspaceDirectory,
        'documents'
    );
    const reportsPath = assertWritableDirectory(
        workspaceDirectory,
        'reports'
    );
    const csvPath = assertWritableDirectory(
        workspaceDirectory,
        loaded.env.AXIS_AUTOMATION_CSV_DIR || 'output'
    );

    if (
        String(loaded.env.USE_DYNAMIC_PDF ?? 'false').toLowerCase() !== 'true' &&
        !fs.existsSync(path.join(documentsPath, 'dummypdf.pdf'))
    ) {
        throw new Error(
            'documents/dummypdf.pdf is required when USE_DYNAMIC_PDF is false.'
        );
    }

    return {
        browserExecutablePath,
        csvPath,
        documentsPath,
        environmentPath: loaded.resolvedPath,
        reportsPath,
    };
}

if (require.main === module) {
    try {
        const arguments_ = parseArguments(process.argv.slice(2));
        const result = validateProduction(arguments_);

        console.log('Axis production validation passed.');
        console.log(`Environment: ${result.environmentPath}`);
        console.log(`Chromium: ${result.browserExecutablePath}`);
        console.log(`Documents: ${result.documentsPath}`);
        console.log(`Reports: ${result.reportsPath}`);
        console.log(`Automation CSV: ${result.csvPath}`);
    } catch (error) {
        console.error(`Axis production validation failed: ${error.message}`);
        process.exitCode = 1;
    }
}

module.exports = {
    MINIMUM_NODE_MAJOR,
    assertAxisEnvironment,
    assertBrowserInstalled,
    assertSupportedNodeVersion,
    assertWritableDirectory,
    collectAxisEnvironmentErrors,
    isHttpUrl,
    parseArguments,
    parseEnvironmentText,
    readEnvironmentFile,
    validateProduction,
};
