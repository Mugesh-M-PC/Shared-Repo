const { main } = require('../src/workers/axis/axisVerificationWorker');

main().catch((error) => {
    console.error(`[AxisWorker] Fatal error: ${error.stack ?? error}`);
    process.exitCode = 1;
});
