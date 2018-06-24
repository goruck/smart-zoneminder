/**
 *
 * Logger for Zoneminder S3 Uploader.
 *
 * Copyright (c) Lindo St. Angel 2018.
 *
 */

const logConfig = {
    level: 'info', // error (0), warn, info, verbose, debug, silly (5)
    silent: false, // Turn off all logging if true. 
    consoleLog: true, // Log to console if true. 
    baseName: '/home/lindo/develop/smart-zoneminder/zm-s3-upload/'
};

const { createLogger, format, transports } = require('./node_modules/winston');
const { simple, json, combine, timestamp } = format;

const logger = createLogger({
    level: logConfig.level,
    silent: logConfig.silent,
    transports: [
        //
        // Write to all logs with level `info` and below to `combined.log` 
        // Write all errors to `error.log`.
        //
        new transports.File({
            filename: logConfig.baseName + 'error.log',
            level: 'error',
            format: combine(
                timestamp(),
                json()
            )
        }),
        new transports.File({
            filename: logConfig.baseName + 'combined.log',
            format: combine(
                timestamp(),
                json()
            ),
        })
    ]
});
          
//
// If we're not in production then log to the `console` with the format:
// `${info.level}: ${info.message} JSON.stringify({ ...rest }) `
// 
if (logConfig.consoleLog) {
    logger.add(new transports.Console ({
        format: simple()
    }));
}

module.exports = logger;