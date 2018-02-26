/**
 *
 * Configuration for Zoneminder S3 Uploader.
 *
 * Lindo St. Angel 2018.
 *
 * Based on Brian Roy's original work.
 * See https://github.com/briantroy/Zoneminder-Alert-Image-Upload-to-Amazon-S3
 *
 */

var zms3Config = function() {
    const fs = require('fs');
    let zmPass = fs.readFileSync('./zm-pass.txt').toString().replace(/\n$/, '');
    let zmUser = fs.readFileSync('./zm-user.txt').toString().replace(/\n$/, '');

    /*
    * The "type" of frame to look for in the Zoneminder DB
    * This SHOULD NOT be changed.
    */
    this.FTYPE = "Alarm";
    /*
    * Maximum number of alarm frames to fetch from the DB in a single pass.
     */
    this.MAXRECS = 400;
    /* Database host (mysql) - zoneminder DB */
    this.DBHOST = "localhost";
    /* Database user name, must have select on zoneminder tables */
    this.DBUSR = zmUser;
    /* Database user's password */
    this.DBPWD = zmPass;
    /* Database name for zoneminder */
    this.DBNAME = "zm";
    /* Base path where your zoneminder events are stored. */
    this.IMGBASEPATH = "/media/lindo/NVR/zoneminder/events";
    /* Console logging on or off (true or false) */
    this.CONSOLELOGGING = true;
    /* Max concurrent uploads... these will be executed non-blocking
     * and the next batch will wait until this batch has completed.
     */
    this.MAXCONCURRENTUPLOAD = 10;

    /*
     * The base path & file name prefix for your log files.
     * A .log and .err file will be created based on this.
     */
    this.LOGFILEBASE = '/home/lindo/dev/smart-zoneminder/zm-s3-upload/logfile';

    /* Base query used to get alarm frames from the zoneminder DB.
    * Only change this if you:
    * 1) Have customized your zoneminder DB somehow
    * 2) REALLY know what you are doing.
     */
    this.zmQuery = "select f.frameid, f.timestamp as frame_timestamp, f.score, " +
        "e.name as event_name, e.starttime, m.name as monitor_name, " +
        "au.upload_timestamp, f.eventid " +
        "from Frames f " +
        "join Events e on f.eventid = e.id " +
        "join Monitors m on e.monitorid = m.id " +
        "left join alarm_uploaded au on (au.frameid = f.frameid and au.eventid = f.eventid) " +
        "where f.type = ? " +
        "and f.timestamp > '2018-02-04 06:30:00' and upload_timestamp is null limit 0,?";

    return this;
}

module.exports.zms3Config = zms3Config;
