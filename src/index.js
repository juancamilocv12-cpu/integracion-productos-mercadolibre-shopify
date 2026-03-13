const cron = require("node-cron");
const config = require("./config");
const logger = require("./logger");
const { syncOnce } = require("./sync");

let running = false;

async function safeRun() {
    if (running) {
        logger.warn("Previous sync is still running. This cycle is skipped.");
        return;
    }

    running = true;
    try {
        await syncOnce();
    } catch (error) {
        logger.error("Unexpected sync error", {
            message: error.message
        });
    } finally {
        running = false;
    }
}

async function main() {
    const runOnce = process.argv.includes("--once");

    if (runOnce) {
        await safeRun();
        return;
    }

    const expression = `*/${config.sync.intervalMinutes} * * * *`;
    logger.info("Scheduler started", {
        expression,
        intervalMinutes: config.sync.intervalMinutes
    });

    await safeRun();

    cron.schedule(expression, async () => {
        await safeRun();
    });
}

main().catch((error) => {
    logger.error("Fatal startup error", {
        message: error.message
    });
    process.exit(1);
});
