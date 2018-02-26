/**
 *
 * Logger for Zoneminder S3 Uploader.
 *
 * Lindo St. Angel 2018.
 *
 * Based on Brian Roy's original work.
 * See https://github.com/briantroy/Zoneminder-Alert-Image-Upload-to-Amazon-S3
 *
 */

var tLogger = function() {
    var consoleLog = true;
    var winston = require('./node_modules/winston');
    var lLog;
    var eLog;

    this.createLogger = function(base_name, toConsole) {
        if(typeof(toConsole) !== 'undefined' && toConsole) consoleLog = true;

        winston.loggers.add('logLogger', {
            file: {
                filename: base_name + ".log"
            }
        });

        winston.loggers.add('errLogger', {
            file: {
                filename: base_name + ".err"
            }
        });

        lLog = winston.loggers.get('logLogger');
        eLog = winston.loggers.get('errLogger');
        eLog.handleExceptions();
        eLog.exitOnError = false;

        if(!consoleLog) {
            lLog.remove(winston.transports.Console);
            eLog.remove(winston.transports.Console);
        }

        this.writeErrMsg("Starting error logger...", "info");
        this.writeLogMsg("Starting logging...", "info");
    }

    this.writeLogMsg = function(tMsg, tSev) {
        var meta = new Object;
        meta.timestamp = Date().toString();
        meta.uxts = +new Date();
        meta.severity = tSev;
        lLog.log("info", tMsg, meta);
    }

    this.writeErrMsg = function(tErr, tSev) {
        var meta = new Object;
        meta.timestamp = Date().toString();
        meta.severity = tSev;
        meta.uxts = +new Date()
        eLog.log("error", tErr, meta);
    }

    return this;
}

module.exports.tLogger = tLogger;
