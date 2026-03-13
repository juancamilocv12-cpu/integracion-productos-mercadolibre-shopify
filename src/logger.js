function log(level, message, metadata) {
    const timestamp = new Date().toISOString();
    const meta = metadata ? ` ${JSON.stringify(metadata)}` : "";
    console.log(`[${timestamp}] [${level}] ${message}${meta}`);
}

module.exports = {
    info: (message, metadata) => log("INFO", message, metadata),
    warn: (message, metadata) => log("WARN", message, metadata),
    error: (message, metadata) => log("ERROR", message, metadata)
};
