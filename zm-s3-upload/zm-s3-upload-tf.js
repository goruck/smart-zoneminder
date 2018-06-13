'use strict';

/**
 *
 * This will scan for new alarm frames in Zoneminder.
 * When it finds them it uploads them to Amazon S3.
 *
 * Lindo St. Angel 2018.
 *
 * Based on Brian Roy's original work.
 * See https://github.com/briantroy/Zoneminder-Alert-Image-Upload-to-Amazon-S3
 *
 */

/* Get our Configuration... */
var zmConfig = require('./zm-s3-upload-config.js').zms3Config();

// Globals.
const fs = require('fs');
const AWS = require('./node_modules/aws-sdk');
var s3 = new AWS.S3();
var isComplete = true;

// DB Connection.
const mysql = require('./node_modules/mysql');

const client = mysql.createConnection({
    host     : zmConfig.DBHOST,
    user     : zmConfig.DBUSR,
    password : zmConfig.DBPWD,
    database : zmConfig.DBNAME
});

var tLog = require('./tLogger').tLogger();
tLog.createLogger(zmConfig.LOGFILEBASE, zmConfig.CONSOLELOGGING);
console.log('Logger created...');

console.log('Waiting for first alarm frames...');
restartProcessing();

function restartProcessing() {
    if(isComplete) {
        //tLog.writeLogMsg("Getting more frames to process.", "info");
        var countNotReady = 0;
        isComplete = false;
        getFrames();
        setTimeout(restartProcessing, 500);
    } else {
        //tLog.writeLogMsg("Not ready for more frames yet...", "info");
        countNotReady++;
        setTimeout(restartProcessing, 500);
        if(countNotReady > 120) {
            tLog.writeErrMsg('Could not restart processing.', 'error');
            process.exit(1);
        }
    }
}

function getFrames() {
    var aryRows;
    var q1s = new Date();
    q1s = q1s.getTime();

    var query = client.query(zmConfig.zmQuery, [zmConfig.FTYPE, zmConfig.MAXRECS]);

    query.on('error', function(err) {
        tLog.writeErrMsg('mysql query error: '+err.stack, 'error');
    });

    /*query.on('fields', function(fields) {
        console.log('query1 fields: ' +fields);
    });*/

    var idx = 0;
    aryRows = new Array();

    query.on('result', function(row) {
        row.image_base_path = zmConfig.IMGBASEPATH;
        aryRows[idx] = row;
        idx++;
    });

    query.on('end', function () {
        var ms = new Date();
        var dur =  ms.getTime() - q1s;

        if (aryRows.length !== 0) {
            tLog.writeLogMsg(aryRows.length+' un-uploaded frames found in: '+dur+' milliseconds', 'info');
        }

        var maxInit;
        if (aryRows.length === 0) {
            // Nothing to upload.
            maxInit = -1;
            isComplete = true;
            return;
        } else if(aryRows.length < zmConfig.MAXCONCURRENTUPLOAD) {
            maxInit = aryRows.length;
        } else {
            maxInit = zmConfig.MAXCONCURRENTUPLOAD;
        }

        let uploadCount = 0;

        let testImagePaths = [];

        // Add full path of image to alarm frames and build test image path array.
        for (let i = 0; i < maxInit; i++) {
            let imageFullPath = buildFilePath(aryRows[i]);
            aryRows[i].imageFullPath = imageFullPath;
            testImagePaths.push(imageFullPath);
        }

        // Convert aryRows to object using imageFullPath as object key.
        // This will allow us to select an alarm frame image by full path name.
        // See https://medium.com/dailyjs/rewriting-javascript-converting-an-array-of-objects-to-an-object-ec579cafbfc7.
        const arrayToObject = (array, keyField) =>
            array.reduce((obj, item) => {
                obj[item[keyField]] = item;
                return obj;
            }, {});
        let aryRowsObject = arrayToObject(aryRows.slice(0, maxInit), 'imageFullPath');

        // Run Tensorflow-GPU people detection script.
        // See https://stackoverflow.com/questions/23450534/how-to-call-a-python-function-from-node-js
        const { spawn } = require('child_process');
        const pyProg = spawn('/home/lindo/develop/tensorflow/models/research/object_detection/object_detection_lindo.py',
            testImagePaths);

        /*pyProg.stderr.on('data', function(data) {
            console.log(data.toString());
        });*/

        pyProg.stdout.on('data', function(data) {
            //tLog.writeLogMsg('aryRows len: '+aryRows.length+' maxInit: '+maxInit+' isComplete: '+isComplete, 'info')

            const objectsFound = JSON.parse(data.toString());

            for (let testImage in objectsFound) {
                let obj = objectsFound[testImage].find(o => o.name === 'person');
                if (obj === undefined) {
                    tLog.writeLogMsg('Person NOT found in '+testImage, 'info');
                    aryRowsObject[testImage].alert = 'false';
                } else {
                    tLog.writeLogMsg('Person found in '+testImage, 'info');
                    aryRowsObject[testImage].alert = 'true';
                }
            }

            //console.log(aryRowsObject);

            // Upload images.
            // Asynchronous Process inside a javascript for loop.
            // Using IIFE (Immediately Invoked Function Expression) with closure.
            // See https://stackoverflow.com/questions/11488014/asynchronous-process-inside-a-javascript-for-loop.
            for (var i = 0; i < maxInit; i++) {
                (function(cntr) {
                // here the value of i was passed into as the argument cntr
                // and will be captured in this function closure so each
                // iteration of the loop can have it's own value

                    let imgData = aryRows[cntr];

                    // Check for bad image file.
                    if (typeof(imgData) === 'undefined' || typeof(imgData.frame_timestamp) === 'undefined') {
                        tLog.writeLogMsg('This Image is bad:', 'warning');
                        tLog.writeLogMsg(imgData, 'warning');
                        return;
                    }

                    // Build S3 path and key.
                    var S3PathKey = buildS3PathKey(imgData);

                    // Path to image file name. 
                    const fileName = imgData.imageFullPath;

                    tLog.writeLogMsg('The file: ' + fileName + ' will be saved to: ' + S3PathKey, 'info');

                    // Read image from filesystem, upload to S3 and mark it as uploaded in ZM's database. 
                    fs.readFile(fileName, (error, data) => {
                    // Handle error - try to get alarm frame again by triggering isComplete flag.
                        if (error) { 
                            tLog.writeErrMsg('readFile error: '+error, 'error');
                            tLog.writeLogMsg('Retry to get alarm frame...', 'info');
                            isComplete = true;
                            return;
                        }

                        // Calculate frame datetime with ms resolution.
                        const dtFrame = new Date(imgData.frame_timestamp);
                        const timestampMs = (imgData.frame_delta % 1).toFixed(3).substring(2);
                        const dtFrameMs = new Date(dtFrame.getFullYear(), dtFrame.getMonth(),
                            dtFrame.getDate(), dtFrame.getHours(), dtFrame.getMinutes(),
                            dtFrame.getSeconds(), timestampMs);
                    
                        const params = {
                            Bucket: 'zm-alarm-frames',
                            Key: 'upload/' + S3PathKey,
                            Body: data,
                            Metadata: {
                                'zmMonitorName': imgData.monitor_name,
                                'zmEventName': imgData.event_name,
                                'zmEventId': imgData.eventid.toString(),
                                'zmFrameId': imgData.frameid.toString(),
                                'zmFrameDatetime': dtFrameMs.toISOString(),
                                'zmScore': imgData.score.toString(),
                                'alert': imgData.alert
                            }
                        };
                        s3.putObject(params, (error, data) => {
                        // Handle error - try to get alarm frame again by triggering isComplete flag. 
                            if (error) {
                                tLog.writeErrMsg('S3 upload error: '+error, 'error');
                                tLog.writeLogMsg('Retrying to get alarm frame...', 'info');
                                isComplete = true;
                                return;
                            }

                            tLog.writeLogMsg('The file: ' + fileName + ' was saved to ' + S3PathKey, 'info');

                            const uploadInsertQuery = 'insert into alarm_uploaded(frameid,eventid,upload_timestamp) ' +
                                                  'values(?,?,now())';
                            var aryBind = new Array(imgData.frameid, imgData.eventid);

                            client.query(uploadInsertQuery, aryBind, (error, results, fields) => {
                                if (error) {
                                    tLog.writeErrMsg('Insert query error: '+error.stack, 'error');
                                    return;
                                }

                                tLog.writeLogMsg('Insert Query Complete. FrameID: ' +
                                             imgData.frameid + ' EventID: ' + imgData.eventid, 'info');

                                uploadCount++;
                                //tLog.writeLogMsg('uploadCount: '+uploadCount, 'info');
                                if (uploadCount > maxInit - 1) {
                                    tLog.writeLogMsg(uploadCount+' image(s) have been uploaded', 'info');
                                    tLog.writeLogMsg('Ready for new alarm frames...', 'info');
                                    isComplete = true;
                                }
                            });
                        });
                    });
                })(i); // end IIFE with closure
            } // end for loop
        });

        // Build S3 path and key.
        function buildS3PathKey(imgData) {
            const dtFrame = new Date(imgData.frame_timestamp);

            // Fractional part of frame delta is the number of milliseconds into a ZoneMinder Section Length.
            // See http://zoneminder.readthedocs.io/en/stable/userguide/definemonitor.html#monitor-tab.
            // Required since frame_timestamp does not have ms resolution which is needed for unique timestamps.
            // NB: this assumes all ZoneMinder monitors are in Record’ or ‘Mocord’ mode.
            // NB: resolution is limited to 10 ms due to default definition of ZM mysql delta field (decimal(8,2)). 
            const timestampMilliseconds = (imgData.frame_delta % 1).toFixed(3).substring(2);

            const S3Path = imgData.monitor_name + '/' + dtFrame.getFullYear() +
                '-' + (dtFrame.getMonth() + 1) + '-' + dtFrame.getDate() + '/hour-' + dtFrame.getHours();

            if (imgData.event_name === 'New Event') {
                imgData.event_name = 'New_Event';
            } else {
                imgData.event_name = imgData.event_name.replace('-', '_');
            }

            const S3Key = imgData.event_name + '-' + 'ID_' + imgData.eventid + '-' +
                'Frame_' + imgData.frameid + '-' +
                dtFrame.getHours() + '-' + dtFrame.getMinutes() + '-' +
                dtFrame.getSeconds() + '-' + timestampMilliseconds + '.jpg';

            return S3Path + '/' + S3Key;
        }

        // Build path to image file name.
        function buildFilePath(imgData) {
            var dtFrame = new Date(imgData.starttime);
            var frameId = imgData.frameid;
            var monitorName = imgData.monitor_name;
            /* get a two digit year for the file path */
            var tYear = dtFrame.getFullYear();
            tYear = String(tYear).slice(2);
            /* Month with leading zeros */
            var tMonth = String(dtFrame.getMonth() + 1);
            if (tMonth.length == 1) tMonth = '0' + tMonth;
            /* Day with leading zeros */
            var tDay = String(dtFrame.getDate());
            if (tDay.length == 1) tDay = '0' + tDay;
            /* Hours with leading zeros */
            var tHour = String(dtFrame.getHours());
            if (tHour.length == 1) tHour = '0' + tHour;
            /* Minutes... */
            var tMin = String(dtFrame.getMinutes());
            if (tMin.length == 1) tMin = '0' + tMin;
            /* Seconds ... */
            var tSec = String(dtFrame.getSeconds());
            if (tSec.length == 1) tSec = '0' + tSec;

            frameId = String(frameId);
            if (frameId.length == 1) frameId = '0000' + frameId;
            if (frameId.length == 2) frameId = '000' + frameId;
            if (frameId.length == 3) frameId = '00' + frameId;
            if (frameId.length == 4) frameId = '0' + frameId;

            return imgData.image_base_path + '/' + monitorName +
                   '/' + tYear + '/' + tMonth +
                   '/' + tDay + '/' + tHour + '/' + tMin +
                   '/' + tSec + '/' + frameId + '-capture.jpg';
        }
    });

    return;
} // end getFrames()
