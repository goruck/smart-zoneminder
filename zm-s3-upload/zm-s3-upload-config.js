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
    // Get ZoneMinder MySql user name and password.
    // zmUserPassArr[0] will contain ZoneMinder MySql user name.
    // zmUserPassArr[1] will contain ZoneMinder MySql password.
    const fs = require('fs');
    const text = fs.readFileSync('/home/lindo/develop/smart-zoneminder/zm-s3-upload/zm-user-pass.txt', 'utf-8');
    const zmUserPassArr = text.split('\n');

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
    this.DBUSR = zmUserPassArr[0];
    /* Database user's password */
    this.DBPWD = zmUserPassArr[1];
    /* Database name for zoneminder */
    this.DBNAME = "zm";
    /* Base path where your zoneminder events are stored. */
    this.IMGBASEPATH = '/nvr/zoneminder/events';
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
    this.LOGFILEBASE = '/home/lindo/develop/smart-zoneminder/zm-s3-upload/logfile';

    // Get current datetime and format for MySql query.
    const date = new Date();
    const dateTime = date.getFullYear() + '-' +
                     ('0' + (date.getMonth() + 1)).slice(-2) + '-' +
                     ('0' + date.getDate()).slice(-2) + ' ' +
                     date.getHours() + ':' + date.getMinutes() + ':' + date.getSeconds();
    //const dateTime = "'2018-04-21 20:30:00'";

    /* Base query used to get alarm frames from the zoneminder DB.
     * Only change this if you:
     * 1) Have customized your zoneminder DB somehow
     * 2) REALLY know what you are doing.
     */
    this.zmQuery = "select f.frameid, f.timestamp as frame_timestamp, f.score, " +
        "f.delta as frame_delta," +
        "e.name as event_name, e.starttime, m.name as monitor_name, " +
        "au.upload_timestamp, f.eventid " +
        "from Frames f " +
        "join Events e on f.eventid = e.id " +
        "join Monitors m on e.monitorid = m.id " +
        "left join alarm_uploaded au on (au.frameid = f.frameid and au.eventid = f.eventid) " +
        "where f.type = ? " +
        "and f.timestamp > '" + dateTime + "' and upload_timestamp is null limit 0,?";

    return this;
}

module.exports.zms3Config = zms3Config;