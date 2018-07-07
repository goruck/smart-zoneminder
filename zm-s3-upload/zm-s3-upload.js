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

// Main function to get alarm frames from zm's database. 
const getFrames = () => {
    let aryRows = [];
    let q1s = new Date();
    q1s = q1s.getTime();

    const query = client.query(zmQuery, [FTYPE, zmConfig.MAXRECS]);

    query.on('error', (err) => {
        logger.error('mysql query error: ' + err.stack);
        process.exit(1);
    });

    /*query.on('fields', function(fields) {
        console.log('query1 fields: ' +fields);
    });*/

    var idx = 0;
    aryRows = new Array();

    query.on('result', (row) => {
        row.image_base_path = zmConfig.IMGBASEPATH;
        aryRows[idx] = row;
        idx++;
    });

    query.on('end', () => {
        let ms = new Date();
        let dur =  ms.getTime() - q1s;

        if (aryRows.length === 0) {
            // Nothing to upload, get more frames. 
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

        // Build S3 path and key.
        const buildS3PathKey= (imgData) => {
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
        };

        // Build path to image file name.
        const buildFilePath = imgData => {
            const dtFrame = new Date(imgData.starttime);
            let frameId = imgData.frameid;
            const monitorName = imgData.monitor_name;
            /* get a two digit year for the file path */
            let tYear = dtFrame.getFullYear();
            tYear = String(tYear).slice(2);
            /* Month with leading zeros */
            let tMonth = String(dtFrame.getMonth() + 1);
            if (tMonth.length == 1) tMonth = '0' + tMonth;
            /* Day with leading zeros */
            let tDay = String(dtFrame.getDate());
            if (tDay.length == 1) tDay = '0' + tDay;
            /* Hours with leading zeros */
            let tHour = String(dtFrame.getHours());
            if (tHour.length == 1) tHour = '0' + tHour;
            /* Minutes... */
            let tMin = String(dtFrame.getMinutes());
            if (tMin.length == 1) tMin = '0' + tMin;
            /* Seconds ... */
            let tSec = String(dtFrame.getSeconds());
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
        };

        /**
         * Upload an image to S3 and mark in zm's database.
         * Returns a Promise of a pending upload. 
         * 
         * @param {int} index Index of image in aryRows to process.
         * @param {boolean} skipUpload If true upload should be skipped and marked only.
         * @returns {Promise} Pending upload of image. 
         */
        const uploadImage = (index, skipUpload) => {
            // Get image data object.
            let imgData = aryRows[index];

            // Check for bad image file.
            if (typeof(imgData) === 'undefined' || typeof(imgData.frame_timestamp) === 'undefined') {
                logger.error('Bad upload image: ' + imgData);
                return new Promise.reject(new Error('Bad upload image: ' + imgData));
            }

            // Get path to image file name. 
            const fileName = buildFilePath(imgData);

            // Read image from filesystem.
            const getImage = file => {
                return new Promise((resolve, reject) => {
                    fs.readFile(file, (error, data) => {
                        error ? reject(error) : resolve(data);
                    });
                });
            };

            // Mark an alarm frame as uploaded in ZoneMinder's database and increment upload counter.
            const markAsUploaded = imgData => {
                const uploadInsertQuery = 'insert into alarm_uploaded(frameid,eventid,upload_timestamp) ' +
                                          'values(?,?,now())';
                const aryBind = new Array(imgData.frameid, imgData.eventid);

                return new Promise((resolve, reject) => {
                    client.query(uploadInsertQuery, aryBind, (error) => {
                        if (error) {
                            logger.error('markAsUpload error: ' + error.stack);
                            reject(error);
                        } else {
                            logger.debug('Insert Query Complete. FrameID: ' +
                                        imgData.frameid + ' EventID: ' + imgData.eventid);
                            resolve(true);
                        }
                    });
                });
            };

            const uploadToS3 = data => {
                // Build S3 path and key.
                const S3PathKey = buildS3PathKey(imgData);
                logger.info('The file: ' + fileName + ' will be saved to: ' + S3PathKey);

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

                // Add metadata for local object detection if it exists from local obj det.
                if (typeof(imgData.alert) !== 'undefined') {
                    params.Metadata.alert = imgData.alert;
                    if (imgData.alert === 'true') {
                        params.Metadata.labels = imgData.objLabels;
                    }
                }

                // Actual upload.
                return new Promise((resolve, reject) => {
                    s3.putObject(params, (error, result) => {
                        error ? reject(error) : resolve(result);
                    });
                });
            };

            // Chain promises and return the last one. 
            const firstPromise = getImage(fileName).then(result => {
                if (!skipUpload) return uploadToS3(result);
                return false;
            });
            return firstPromise.then(result => {
                logger.debug('uploadToS3 result: '+result);
                return markAsUploaded(imgData);
            });
        };

        // Perform local object detection then upload to S3.
        const localObjDet = () => {
            return new Promise((resolve, reject) => {
                let testImagePaths = [];

                // Add full path of image to alarm frames and build test image path array.
                for (let i = 0; i < maxInit; i++) {
                    let imageFullPath = buildFilePath(aryRows[i]);
                    testImagePaths.push(imageFullPath);
                }

                // zerorpc connection.
                // Heartbeat should be greater than the time required to run detection on maxInit frames. 
                const zerorpc = require('./node_modules/zerorpc');
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
                    zerorpcClient.close();

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

                    // Scan objectsFound array for a person and upload alarms to S3.
                    let skipObj = {};
                    let promises = [];
                    for (let i = 0; i < maxInit; ++i) {
                        // Frames to skip for each one processed.
                        // In general alarms from multiple monitors need to be handled.
                        const monitor = aryRows[i].monitor_name;
                        const monitorExists = skipObj.hasOwnProperty(monitor);
                        monitorExists ? skipObj[monitor]++ : skipObj[monitor] = 0;
                        const skip = skipObj[monitor] % (zmConfig.frameSkip + 1);

                        // Scan for detected objects and trigger uploads. 
                        const fileName = objectsFound[i].image;
                        const objLabels = objectsFound[i].labels.find(o => o.name === 'person');
                        if (objLabels === undefined) {
                            logger.info('Person NOT found in ' + fileName);
                            aryRows[i].alert = 'false';
                            if (zmConfig.uploadFalsePositives === false) {
                                logger.info('False positives will NOT be uploaded.');
                                // Mark as uploaded in zm db but don't actually upload image.
                                promises.push(uploadImage(i, true));
                            } else {
                                if (skip) logger.info('Skipping next upload. frameSkip: '+zmConfig.frameSkip);
                                promises.push(uploadImage(i, skip));
                            }
                        } else {
                            if (skip) logger.info('Skipping next upload. frameSkip: '+zmConfig.frameSkip);
                            logger.info('Person found in ' + fileName);
                            aryRows[i].alert = 'true';
                            aryRows[i].objLabels = JSON.stringify(labels);
                            promises.push(uploadImage(i, skip));
                        }
                    }

                    // Wait until all uploads complete. 
                    Promise.all(promises).then(() => {
                        resolve(true);
                    }).catch((error) => {
                        reject(new Error('upload error: '+error));
                    });
                }).catch((error) => {
                    reject(new Error('zerorpc error: ' + error));
                });
            }); 
        }; // end localObjDet

        // Upload to S3 to trigger remote object detection.
        // TODO - combine with local object detect and simplify. 
        const remoteObjDet = () => {
            return new Promise((resolve, reject) => {
                let promises = [];
                let skipObj = {};
                for (let i = 0; i < maxInit; i++) {
                    const monitor = aryRows[i].monitor_name;
                    const monitorExists = skipObj.hasOwnProperty(monitor);
                    monitorExists ? skipObj[monitor]++ : skipObj[monitor] = 0;
                    const skip = skipObj[monitor] % (zmConfig.frameSkip + 1);
                    if (skip) logger.info('Skipping next upload. frameSkip: '+zmConfig.frameSkip);
                    promises.push(uploadImage(i, skip));
                }
                Promise.all(promises).then(() => {
                    resolve(true);
                }).catch((error) => {
                    reject(new Error('upload error: '+error));
                });
            }); 
        }; // end remoteObjDet

        if (zmConfig.runLocalObjDet === true) {
            logger.info('Running with local object detection enabled.');
            localObjDet().then(() => {
                logger.info(maxInit + ' image(s) have been processed.');
                logger.info('Ready for new alarm frames...');
                // Get more frames to process.
                isComplete = true;
                return;
            }).catch(error => {
                logger.error('localObjDetect error: '+error);
                // Just die on error. 
                process.exit(1);
            });
        } else {
            logger.info('Running with remote object detection enabled.');
            remoteObjDet().then(() => {
                logger.info(maxInit + ' image(s) have been processed.');
                logger.info('Ready for new alarm frames...');
                isComplete = true;
                return;
            }).catch(error => {
                logger.error('remoteObjDetect error: '+error);
                process.exit(1);
            });
        }
    });
}; // end getFrames()

// State machine to fetch more alarm frames. 
const processAlarms = () => {
    if(isComplete) {
        logger.debug('Getting more frames to process.');
        var countNotReady = 0;
        isComplete = false;
        getFrames();
        setTimeout(processAlarms, zmConfig.checkForAlarmsInterval);
    } else {
        logger.debug('Not ready for more frames yet...');
        countNotReady++;
        setTimeout(processAlarms, zmConfig.checkForAlarmsInterval);
        if(countNotReady > zmConfig.checkForAlarmsAttempts) {
            logger.error('Could not restart processing.');
            process.exit(1);
        }
    }
};

// Start looking for alarm frames. 
logger.info('Waiting for first alarm frames...');
processAlarms();