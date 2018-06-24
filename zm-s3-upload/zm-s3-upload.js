'use strict';

/**
 *
 * This will scan for new alarm frames in Zoneminder.
 * If local object detection is enabled then it will upload the image and found objects to S3.
 * If not then it will upload the image where remote object detection will be performed. 
 *
 * Copyright (c) Lindo St. Angel 2018.
 *
 * Inspired by Brian Roy's original work.
 * See https://github.com/briantroy/Zoneminder-Alert-Image-Upload-to-Amazon-S3
 *
 */

// Globals.
const fs = require('fs');
const AWS = require('./node_modules/aws-sdk');
const s3 = new AWS.S3();
let isComplete = true;

// Get configuration details. 
const configObj = JSON.parse(fs.readFileSync('./zm-s3-upload-config.json'));
const zmConfig = configObj.zms3Config;

// mysql database connection.
const mysql = require('./node_modules/mysql');

const client = mysql.createConnection({
    host     : zmConfig.DBHOST,
    user     : zmConfig.DBUSR,
    password : zmConfig.DBPWD,
    database : zmConfig.DBNAME
});

// Set mysql query for ZoneMinder alarm frames. 
const queryStartDate = new Date();
const dateTime = queryStartDate.getFullYear() + '-' +
    ('0' + (queryStartDate.getMonth() + 1)).slice(-2) + '-' +
    ('0' + queryStartDate.getDate()).slice(-2) + ' ' +
    queryStartDate.getHours() + ':' +
    queryStartDate.getMinutes() + ':' +
    queryStartDate.getSeconds();
const zmQuery = 'select f.frameid, f.timestamp as frame_timestamp, f.score, ' +
    'f.delta as frame_delta,' +
    'e.name as event_name, e.starttime, m.name as monitor_name, ' +
    'au.upload_timestamp, f.eventid ' +
    'from Frames f ' +
    'join Events e on f.eventid = e.id ' +
    'join Monitors m on e.monitorid = m.id ' +
    'left join alarm_uploaded au on (au.frameid = f.frameid and au.eventid = f.eventid) ' +
    'where f.type = ? ' +
    'and f.timestamp > \'' + dateTime + '\' and upload_timestamp is null limit 0,?';
const FTYPE = 'Alarm';

// Logger. 
const logger = require('./logger');
console.log('Logger created...');

// Start looking for alarm frames. 
console.log('Waiting for first alarm frames...');
restartProcessing();

function restartProcessing() {
    if(isComplete) {
        logger.debug('Getting more frames to process.');
        var countNotReady = 0;
        isComplete = false;
        getFrames();
        setTimeout(restartProcessing, 500);
    } else {
        logger.debug('Not ready for more frames yet...');
        countNotReady++;
        setTimeout(restartProcessing, 500);
        if(countNotReady > 120) {
            logger.error('Could not restart processing.');
            process.exit(1);
        }
    }
}

function getFrames() {
    var aryRows;
    var q1s = new Date();
    q1s = q1s.getTime();

    var query = client.query(zmQuery, [FTYPE, zmConfig.MAXRECS]);

    query.on('error', function(err) {
        logger.error('mysql query error: ' + err.stack);
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
        let ms = new Date();
        let dur =  ms.getTime() - q1s;

        if (aryRows.length === 0) {
            // Nothing to upload.
            isComplete = true;
            return;
        } else {
            logger.info(aryRows.length+' un-uploaded frames found in: '+dur+' milliseconds');
        }

        // Determine maximum number of concurrent S3 uploads. 
        let maxInit = 0;
        (aryRows.length < zmConfig.MAXCONCURRENTUPLOAD) ?
            maxInit = aryRows.length : maxInit = zmConfig.MAXCONCURRENTUPLOAD;

        logger.debug('aryRows len: '+aryRows.length+' maxInit: '+maxInit+' isComplete: '+isComplete);

        let uploadCount = 0;

        if (zmConfig.runLocalObjDet === true) {
            logger.info('Running with local object detection enabled.');
            localObjDet();
        } else {
            logger.info('Running with remote object detection enabled.');
            uploadImages();
        }

        // Perform local object detection then upload to S3. 
        function localObjDet() {
            let testImagePaths = [];

            // Add full path of image to alarm frames and build test image path array.
            for (let i = 0; i < maxInit; i++) {
                let imageFullPath = buildFilePath(aryRows[i]);
                testImagePaths.push(imageFullPath);
            }

            // zerorpc connection.
            // Heartbeat should be greater than the time required to run detection on maxInit frames. 
            const zerorpc = require('zerorpc');
            const zerorpcClient = new zerorpc.Client({heartbeatInterval: zmConfig.zerorpcHeartBeat});
            zerorpcClient.connect(zmConfig.zerorpcPipe);

            const zerorpcP = new Promise((resolve, reject) => {
                zerorpcClient.on('error', (error) => {
                    reject(error);
                });

                zerorpcClient.invoke('detect', testImagePaths, (error, data) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve(JSON.parse(data.toString()));
                    }
                });
            });

            zerorpcP.then((result) => {
                const objectsFound = result;

                // Placeholder label objects.
                const labels = {
                    "Labels": [
                        {
                            "Confidence": 90,
                            "Name": "Person"
                        }
                    ]
                };

                // Scan objectsFound array for a person. 
                for (let i = 0; i < maxInit; i++) {
                    let fileName = objectsFound[i].image;
                    let objLabels = objectsFound[i].labels.find(o => o.name === 'person');
                    if (objLabels === undefined) {
                        logger.info('Person NOT found in ' + fileName);
                        aryRows[i].alert = 'false';
                    } else {
                        logger.info('Person found in ' + fileName);
                        aryRows[i].alert = 'true';
                        aryRows[i].objLabels = JSON.stringify(labels);
                    }
                }

                uploadImages();
            }).catch((error) => {
                logger.error('Local object detection error: ' + error);
            });

            return;
        }

        // Upload images to S3.
        function uploadImages() {
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
                        logger.error('Bad image: ' + imgData);
                        return;
                    }

                    // Build S3 path and key.
                    const S3PathKey = buildS3PathKey(imgData);

                    // Path to image file name. 
                    //const fileName = imgData.imageFullPath;
                    const fileName = buildFilePath(imgData);

                    logger.info('The file: ' + fileName + ' will be saved to: ' + S3PathKey);

                    // Read image from filesystem, upload to S3 and mark it as uploaded in ZM's database. 
                    fs.readFile(fileName, (error, data) => {
                        if (error) { 
                            logger.error('readFile error: ' + error);
                            return;
                        }

                        // Calculate frame datetime with ms resolution.
                        const dtFrame = new Date(imgData.frame_timestamp);
                        const timestampMs = (imgData.frame_delta % 1).toFixed(3).substring(2);
                        const dtFrameMs = new Date(dtFrame.getFullYear(), dtFrame.getMonth(),
                            dtFrame.getDate(), dtFrame.getHours(), dtFrame.getMinutes(),
                            dtFrame.getSeconds(), timestampMs);
                    
                        let params = {
                            Bucket: 'zm-alarm-frames',
                            Key: 'upload/' + S3PathKey,
                            Body: data,
                            Metadata: {
                                'zmMonitorName': imgData.monitor_name,
                                'zmEventName': imgData.event_name,
                                'zmEventId': imgData.eventid.toString(),
                                'zmFrameId': imgData.frameid.toString(),
                                'zmFrameDatetime': dtFrameMs.toISOString(),
                                'zmScore': imgData.score.toString()
                            }
                        };

                        // Add metadata for local object detection if it exists. 
                        if (typeof(imgData.alert) !== 'undefined') {
                            params.Metadata.alert = imgData.alert;
                            if (imgData.alert === 'true') {
                                params.Metadata.labels = imgData.objLabels;
                            }
                        }

                        s3.putObject(params, (error) => {
                        // Handle error - try to get alarm frame again by triggering isComplete flag. 
                            if (error) {
                                logger.error('S3 upload error: ' + error);
                                logger.info('Retrying to get alarm frame...');
                                //if (typeof(zerorpcClient) !== 'undefined') zerorpcClient.close();
                                isComplete = true;
                            }

                            logger.info('The file: ' + fileName + ' was saved to ' + S3PathKey);

                            const uploadInsertQuery = 'insert into alarm_uploaded(frameid,eventid,upload_timestamp) ' +
                                                      'values(?,?,now())';
                            var aryBind = new Array(imgData.frameid, imgData.eventid);

                            client.query(uploadInsertQuery, aryBind, (error) => {
                                if (error) {
                                    logger.error('Insert query error: ' + error.stack);
                                    return;
                                }

                                logger.info('Insert Query Complete. FrameID: ' +
                                             imgData.frameid + ' EventID: ' + imgData.eventid);

                                uploadCount++;
                                logger.debug('uploadCount: ' + uploadCount);
                                if (uploadCount > maxInit - 1) {
                                    logger.info(uploadCount + ' image(s) have been uploaded');
                                    logger.info('Ready for new alarm frames...');
                                    //if (typeof(zerorpcClient) !== 'undefined') zerorpcClient.close();
                                    isComplete = true;
                                }
                            });
                        });
                    });
                })(i); // end IIFE with closure
            } // end for loop

            return;
        }

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
