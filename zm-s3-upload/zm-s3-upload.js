'use strict';

/**
 *
 * This will scan for new alarm frames in ZoneMinder.
 * If local object detection is enabled then it will upload the image and found objects to S3.
 * If not then it will upload the image where remote object detection will be performed. 
 *
 * Copyright (c) 2018, 2019 Lindo St. Angel.
 *
 * Inspired by Brian Roy's original work.
 * See https://github.com/briantroy/Zoneminder-Alert-Image-Upload-to-Amazon-S3
 *
 */

const fs = require('fs');
const util = require('util');

// AWS config.
const awsCreds = JSON.parse(fs.readFileSync('./aws-creds.json'));
const AWS = require('aws-sdk');
const s3 = new AWS.S3(awsCreds);

// Get configuration details.
const configObj = JSON.parse(fs.readFileSync('./zm-s3-upload-config.json'));
const zmConfig = configObj.zms3Config;

// Zoneminder's mysql database connection config.
const DB_HOST = zmConfig.DBHOST;
const DB_USR = zmConfig.DBUSR;
const DB_PWD = zmConfig.DBPWD;
const DB_NAME = zmConfig.DBNAME;

// Limit of records returned by mysql queries.
const MAX_RECS = zmConfig.MAXRECS;

// Filesystem path to where ZoneMinder events are stored.
const IMG_BASE_PATH = zmConfig.IMGBASEPATH;

// As event images are captured they are stored to the filesystem with a numerical index.
// This defines the number of digits in that index which must match your ZoneMinder configuration.
const ZM_EVENT_IMAGE_DIGITS = zmConfig.zmEventImageDigits;

// The maximum allowable concurrent uploads to S3.
// This also sets the number of images submitted for local object detection.
const MAX_CONCURRENT_UPLOAD = zmConfig.MAXCONCURRENTUPLOAD;

// Heartbeat interval for zerorpc client in ms.
// This should be greater than the time required to run local detection on MAX_CONCURRENT_UPLOAD frames.
// This must match the zerorpc server config. 
const ZERORPC_HEARTBEAT = zmConfig.zerorpcHeartBeat;

// IPC (or TCP) socket for zerorpc.
// This must match the zerorpc server config.
const ZERORPC_PIPE = zmConfig.zerorpcPipe;

// Number of frames to skip for each one processed.
// Meant to save processing and upload time (possibly with lower accuracy).
const FRAME_SKIP = zmConfig.frameSkip;

// Flag to upload false positives to S3. 
const UPLOAD_FALSE_POSITIVES = zmConfig.uploadFalsePositives;

// Flag to run local (Tensorflow) instead of remote (Amazon Rekognition) object detection.
const RUN_LOCAL_OBJ_DET = zmConfig.runLocalObjDet;

// How often to check for ZoneMinder alarm frames (in ms).
const CHECK_FOR_ALARMS_INTERVAL = zmConfig.checkForAlarmsInterval;

// Flag to run local face detection / recognition on people detected. 
const RUN_FACE_DET_REC = zmConfig.runFaceDetRec;

// The python virtual environment to run the face det / rec script in. 
const FACE_DET_REC_VIRTENV = zmConfig.faceDetRecVirtenv;

// Path to the face det / rec script. 
const FACE_DET_REC_PATH = zmConfig.faceDetRecPath;

// mongodb
// Log the disposition of all alarm frames to a mongo database?
const USE_MONGO = zmConfig.useMongo;
// URL of mongo server.
const MONGO_URL = zmConfig.mongoUrl;
// mongo collection name.
const MONGO_COLLECTION = zmConfig.mongoCollection;

// mysql database connection.
const mysql = require('mysql');
const dbConfig = {
    host: DB_HOST,
    user: DB_USR,
    password: DB_PWD,
    database: DB_NAME
};
let client = mysql.createConnection(dbConfig);

// Set mysql query constants to find ZoneMinder alarm frames.
// Queries will start from the current date and time. 
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

/**
 * Returns an array with string and int representations of the
 * difference between start and current process.hrtime().
 * 
 * @param {int} start - Start time in ns from process.hrtime()
 */
const parseHrtime = start => {
    const diff = process.hrtime(start);
    const PRECISION = 1;
    const MS_PER_NS = 1e6;
    const NS_PER_S = 1e9;
    const diffSecs = diff[0] + (diff[1] / NS_PER_S);
    const diffString = `${diff[0]} s ${(diff[1] / MS_PER_NS).toFixed(PRECISION)} ms`;
    return [diffString, diffSecs];
};

/**
 * Main function to get and process alarm frames from zm's database.
 */
const getFrames = () => {
    // startTime used to time code performance. 
    const startTime = process.hrtime();

    // Initialize some variables to generate stats. 
    let alarmsProcessed = 0;
    let alarmsFound = 0;
    let alarmsSkipped = 0;

    // Start the query.
    const query = client.query(zmQuery, [FTYPE, MAX_RECS]);

    query.on('error', err => {
        logger.error(`mysql query error: ${err.stack}`);
        // Restart processing if the mysql server disconnects. 
        // Connection to the MySQL server is usually lost due to either server restart, or a
        // connection idle timeout (the wait_timeout server variable configures this)
        if (err.code === 'PROTOCOL_CONNECTION_LOST') {
            logger.error('Mysql connection lost...restarting processing.');
            client = mysql.createConnection(dbConfig);
            return setTimeout(getFrames, CHECK_FOR_ALARMS_INTERVAL);
        } else {
            // Die if not a mysql server disconnect.
            process.exit(1);
        }
    });
    
    // Get alarm frames row by row from mysql.
    // Add image path base and skip info to the alarm then push to aryRows.
    const alarmsFromMonitor = {}; // alarms per monitor, used for frame skip
    const aryRows = []; // array that holds the alarm images read from zm
    query.on('result', row => {
        row.image_base_path = IMG_BASE_PATH;
        // Calculate which frames should be skipped.
        // Need to keep track of alarms on a monitor basis since they arrive async.
        const monitor = row.monitor_name;
        const monitorExists = alarmsFromMonitor.hasOwnProperty(monitor);
        monitorExists ? alarmsFromMonitor[monitor]++ : alarmsFromMonitor[monitor] = 1;
        row.skip = !(alarmsFromMonitor[monitor] % (FRAME_SKIP + 1));
        aryRows.push(row); // add alarm to array
    });

    // When query ends start processing the alarm images. 
    query.on('end', () => {
        if (aryRows.length === 0) {
            // Nothing to upload, get more frames.
            logger.debug('Getting more frames to process.');
            return setTimeout(getFrames, CHECK_FOR_ALARMS_INTERVAL);
        } else {
            logger.info(`${aryRows.length} un-uploaded frames found in ${parseHrtime(startTime)[0]}.`);
            alarmsFound = aryRows.length;
        }

        /**
         * Build S3 path and key.
         * 
         * @param {object} imgData - Object describing image.
         * @returns {string} - S3 path and key. 
         */
        const buildS3PathKey = imgData => {
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

        /**
         * Build filesystem path to image.
         * 
         * Currently this only supports events stored with "deep" paths, e.g., 
         *     ../events/1/18/10/17/14/30/20/00102-capture.jpg
         * 
         * @param {Object} imgData - Object describing image.
         * @returns {string} - Filesystem path to image in "deep" format. 
         */
        const buildFilePath = imgData => {
            const dtFrame = new Date(imgData.starttime);
            // Get a two digit year for the file path.
            const tYear = dtFrame.getFullYear().toString().slice(2);
            // Month with leading zero.
            let tMonth = (dtFrame.getMonth() + 1).toString();
            if (tMonth.length === 1) tMonth = '0' + tMonth;
            // Day...
            let tDay = dtFrame.getDate().toString();
            if (tDay.length === 1) tDay = '0' + tDay;
            // Hours...
            let tHour = dtFrame.getHours().toString();
            if (tHour.length === 1) tHour = '0' + tHour;
            // Minutes...
            let tMin = dtFrame.getMinutes().toString();
            if (tMin.length === 1) tMin = '0' + tMin;
            // Seconds ...
            let tSec = dtFrame.getSeconds().toString();
            if (tSec.length === 1) tSec = '0' + tSec;

            // Add leading zero(s) to frame ID to match ZoneMinder configuration. 
            let frameId = imgData.frameid.toString();
            frameId = '0'.repeat(ZM_EVENT_IMAGE_DIGITS - frameId.length) + frameId;

            /* 
               Check if default monitor names are being used.
               If so then just use monitor number in the image path.
               If not then use the name the user gave the monitor.
               Default monitor names are in the form "Monitor-N",
               where N is the monitor number.
               
               Zoneminder creates symlinks between default monitor numbers
               and non-default monitor names in the image store directory.
            */
            const re = /Monitor-\d+/;
            const monitorName = re.test(imgData.monitor_name) ?
                imgData.monitor_name.split('-')[1] : imgData.monitor_name;

            return imgData.image_base_path + '/' + monitorName +
               '/' + tYear + '/' + tMonth +
               '/' + tDay + '/' + tHour + '/' + tMin +
               '/' + tSec + '/' + frameId + '-capture.jpg';
        };

        /**
         * Write documents to a mongo database.
         * Returns a promise for a mongodb write.
         * 
         * @param {array} documents - An array of documents to write to mongo.
         * @returns {Promise} - Pending write of documents. 
         */
        const writeToMongodb = documents => {
            logger.debug(`mongodb docs: ${util.inspect(documents, false, null)}`);
            const mongoClient = require('mongodb').MongoClient;
            return new Promise((resolve, reject) => {
                mongoClient.connect(MONGO_URL, (error, client) => {
                    if (error) reject(`writeToMongodb error: ${error}`);
                    const collection = client.db().collection(MONGO_COLLECTION);
                    collection.insertMany(documents, (error, result) => {
                        if (error) reject(`writeToMongodb error: ${error}`);
                        logger.debug(`mongodb result: ${util.inspect(result, false, null)}`);
                        logger.info(`Wrote ${result.insertedCount} doc(s) to mongodb.`);
                        client.close();
                        resolve();
                    });
                });
            });
        };

        /**
         * Upload an image to S3 and mark in zm's database.
         * Returns a Promise of a pending upload. 
         * 
         * @param {int} index - Index of image in aryRows to process.
         * @param {boolean} skipUpload - If true upload should be skipped and marked only.
         * @returns {Promise} - Pending upload of image. 
         */
        const uploadImage = (index, skipUpload) => {
            // Get image data object.
            let imgData = aryRows[index];

            // Check for bad image file.
            if (typeof(imgData) === 'undefined' || typeof(imgData.frame_timestamp) === 'undefined') {
                logger.error(`Bad upload image: ${imgData}`);
                return Promise.reject(new Error('Bad upload image: ' + imgData));
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
                            logger.error(`markAsUpload error: ${error.stack}`);
                            reject(error);
                        } else {
                            logger.debug(`Insert Query Complete. FrameID: ${imgData.frameid} EventID: ${imgData.eventid}`);
                            resolve(true);
                        }
                    });
                });
            };

            /**
            * Upload image and metadata to an S3 bucket.
            * 
            * @param {Buffer} data - the data to be uploaded.
            * @param {Object} imgData - alarm metadata from ZoneMinder.
            * 
            */
            const uploadToS3 = (data, imgData) => {
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
                    StorageClass: 'STANDARD_IA',
                    Metadata: {
                        'zmMonitorName': imgData.monitor_name,
                        'zmEventName': imgData.event_name,
                        'zmEventId': imgData.eventid.toString(),
                        'zmFrameId': imgData.frameid.toString(),
                        'zmFrameDatetime': dtFrameMs.toISOString(),
                        'zmScore': imgData.score.toString(),
                        'zmLocalEventPath': fileName.toString()
                    }
                };

                // Add metadata for local object detection if it exists from local obj det.
                if (typeof(imgData.alert) !== 'undefined') {
                    params.Metadata.alert = imgData.alert;
                    if (imgData.alert === 'true') {
                        params.Metadata.labels = JSON.stringify(imgData.objLabels);
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
                if (!skipUpload) return uploadToS3(result, imgData);
                return false;
            });

            const secondPromise = firstPromise.then(result => {
                logger.debug('uploadToS3 result: '+util.inspect(result, false, null));
                return markAsUploaded(imgData);
            });

            return secondPromise;
        };

        /**
         * Perform local or remote object detection on images.
         * If enabled, also perform local face detection and recognition.
         * Parse results and finally upload everything to S3.
         * 
         * @param {int} alarms - Number of new alarm images to process.
         * @param {boolean} local - If true run local obj det, else remote.
         */
        const detect = (alarms = 0, local = true) => {
            logger.debug(`aryRows len: ${aryRows.length} alarms: ${alarms} alarmsProcessed: ${alarmsProcessed}`);

            // Limit number of alarms concurrently processed.
            aryRows.length < MAX_CONCURRENT_UPLOAD ?
                alarms = aryRows.length : alarms = MAX_CONCURRENT_UPLOAD;

            logger.info(`Processing ${alarms} alarm frame(s)...`);

            const promises = []; // holds upload and mongodb promises
            const mongodbDoc = []; // for local database of all alarm frame disposition
            let skipped = 0; // alarm frames skipped during this run

            // Perform face detection and recognition via external python script. 
            const faceDetRec = detectedObjects => {
                // Return a resolved Promise with an empty array if detectedObjects is empty.
                if (detectedObjects.length === 0) return Promise.resolve([]);

                // Construct args for script.
                // The first arg is the script name. 
                // Each detected image is a separate arg on the command line. 
                const spawnArgs = [];
                spawnArgs.push(FACE_DET_REC_PATH);
                detectedObjects.forEach(item =>{
                    spawnArgs.push(JSON.stringify(item));
                });

                return new Promise((resolve, reject) => {
                    const { spawn } = require('child_process');
                    const faceDetRecPy = spawn(FACE_DET_REC_VIRTENV, spawnArgs);

                    faceDetRecPy.stdout.on('data', (data) => {
                        resolve(JSON.parse(data.toString()));
                    });
                
                    faceDetRecPy.stderr.on('data', (error) => {
                        reject(error.toString());
                    });
                });
            };

            // zerorpc connection to object detection server. 
            const objDetServer = imagePaths => {
                // Return a resolved Promise with an empty array if imagePath is empty.
                if (imagePaths.length === 0) return Promise.resolve([]);

                const zerorpc = require('zerorpc');
                // Heartbeat must be greater than the time required to run detection on maxInit frames.
                const zerorpcClient = new zerorpc.Client({heartbeatInterval: ZERORPC_HEARTBEAT});
                zerorpcClient.connect(ZERORPC_PIPE);

                return new Promise((resolve, reject) => {
                    zerorpcClient.on('error', (error) => {
                        reject(error);
                    });

                    zerorpcClient.invoke('detect', imagePaths, (error, data) => {
                        zerorpcClient.close();
                        if (error) {
                            reject(error);
                        } else {
                            resolve(JSON.parse(data.toString()));
                        }
                    });
                });
            };

            /**
             * Wait for uploads to complete.
             * Then check for new alarms else finish existing alarms in array.
             */
            const waitForUploads = () => {
                return Promise.all(promises).then(() => {
                    aryRows.splice(0, alarms); // Remove processed alarms from the array.
                    alarmsProcessed += alarms;
                    alarmsSkipped += skipped;
                    if (aryRows.length === 0) {
                        const dur = parseHrtime(startTime);
                        const fps = (alarmsProcessed / dur[1]).toFixed(1);
                        logger.info(`${alarmsProcessed} / ${alarmsFound} image(s) processed in ${dur[0]} (${fps} fps).`);
                        logger.info(`${alarmsProcessed - alarmsSkipped} image(s) uploaded.`);
                        logger.info(`${alarmsSkipped} image(s) skipped.`);
                        logger.info('Waiting for new alarm frame(s)...');
                        return getFrames();
                    } else {
                        logger.info(`${alarmsProcessed} / ${alarmsFound} image(s) processed.`);
                        return detect(MAX_CONCURRENT_UPLOAD, local);
                    }
                }).catch(error => {
                    logger.error(`waitForUploads error: ${error.stack}`);
                    process.exit(1); // die on error
                });
            };

            /**
             * Generate mongodb doc for image disposition stored locally.
             * 
             * @param {string} image - Path to image.
             * @param {object} labels - Image metadata.
             * @param {string} status - Indicates if image was skipped or processed.
             * @param {string} method - Indicates if local or remote obj dectection was used. 
             */
            const genMongodbDoc = (image, labels, status, method) => {
                const doc = {'image': image, 'labels': labels, 'status': status, 'objDet': method};
                mongodbDoc.push(doc);
                return;
            };

            // Run local object detection, then run face detection / recognition if enabled. 
            // After detection / recognition, parse results and upload to S3.
            // Alarm images (number defined by the alarm variable) will be concurrently uploaded.
            if (local) {
                // Build set of test image paths.
                const imagePaths = [];
                for (let i = 0; i < alarms; i++) {
                    logger.debug(`Alarm frame info: ${util.inspect(aryRows[i], false, null)}`);
                    if (aryRows[i].skip) continue;
                    imagePaths.push(buildFilePath(aryRows[i]));
                }
                
                objDetServer(imagePaths).then((detObjArr) => {
                    // detObjArr is an array containing objects detected in image(s).
                    // The ordering of items in the array matches the order that they were submitted.
                    logger.debug(`Obj detect results: ${util.inspect(detObjArr, false, null)}`);
                    if (RUN_FACE_DET_REC) return faceDetRec(detObjArr);
                    return detObjArr;
                }).then((objectsFound) => {
                    // objectsFound is an array of detected objects and recognized faces (if enabled).
                    // The ordering of items in the array matched the order that they were submitted.
                    logger.debug(`Face + Obj detect results: ${util.inspect(objectsFound, false, null)}`);

                    // Scan objectsFound array for detected objects and upload true alarms to S3.
                    for (let i = 0; i < alarms; i++) {
                        const fileName = buildFilePath(aryRows[i]);

                        // Find alarm frames that were never sent for object detection and skip past those.
                        if (aryRows[i].skip) {
                            logger.info(`Skipped processing of ${fileName}`);
                            if (USE_MONGO) genMongodbDoc(fileName, [], 'skipped', 'local');
                            // Mark as uploaded in zm db but don't actually upload image.
                            promises.push(uploadImage(i, true));
                            skipped++;
                            continue;
                        }

                        const labels = []; // holds detected object and face labels

                        // Scan for detected objects and trigger uploads.
                        // ObjectsFound index must be adjusted for images skipped.
                        const numObjDet = objectsFound[i - skipped].labels.length;
                        if (!numObjDet) {
                            logger.info(`No objects detected in ${fileName}`);
                            aryRows[i].alert = 'false';
                            if (UPLOAD_FALSE_POSITIVES === false) {
                                logger.info('False positives will NOT be uploaded.');
                                // Mark as uploaded in zm db but don't actually upload image.
                                promises.push(uploadImage(i, true));
                            } else {
                                // Upload and mark in db as so. 
                                promises.push(uploadImage(i, false));
                            }
                        } else {
                            logger.info(`Processed ${fileName}.`);
                            objectsFound[i - skipped].labels.forEach(item => {
                                const labelData = {
                                    'Confidence': (100 * item.score),
                                    'Name': item.name,
                                    'Box': item.box
                                };
                                    // If a person was detected then add (any) face data. 
                                if (typeof(item.face) !== 'undefined') labelData.Face = item.face;
                                labels.push(labelData);
                                logger.info(`Image labels: ${util.inspect(labelData, false, null)}`);
                            });
                            aryRows[i].alert = 'true';
                            aryRows[i].objLabels = labels;
                            promises.push(uploadImage(i, false));
                        }

                        if (USE_MONGO) genMongodbDoc(fileName, labels, 'processed', 'local');
                    }

                    // Log the disposition of all alarms to mongodb.
                    if (USE_MONGO) promises.push(writeToMongodb(mongodbDoc));

                    // Wait until all uploads complete.
                    waitForUploads();
                }).catch((error) => {
                    logger.error(new Error(`local object detect error: ${error.stack}`));
                    process.exit(1); // just die on error
                });
            } else {
                // If not local then use remote object detection. 
                for (let i = 0; i < alarms; i++) {
                    logger.debug(`Alarm frame info: ${util.inspect(aryRows[i], false, null)}`);
                    const fileName = buildFilePath(aryRows[i]);
                    const skip = aryRows[i].skip;
                    if (skip) {
                        skipped++;
                        logger.info(`Skipped processing of ${fileName}`);
                        if (USE_MONGO) genMongodbDoc(fileName, [], 'skipped', 'remote');
                    } else {
                        if (USE_MONGO) genMongodbDoc(fileName, [], 'processed', 'remote');
                    }
                    promises.push(uploadImage(i, skip));
                }
                // Log the disposition of all alarms to mongodb.
                if (USE_MONGO) promises.push(writeToMongodb(mongodbDoc));

                waitForUploads();
            }
            return;
        }; // end detect

        // Start local or remote alarm frame detection and upload.
        if (RUN_LOCAL_OBJ_DET) {
            logger.info('Running with local object detection enabled.');
            if (RUN_FACE_DET_REC) logger.info('Running with local face det / rec enabled.');
            detect(MAX_CONCURRENT_UPLOAD, true);
        } else {
            logger.info('Running with remote object detection enabled.');
            detect(MAX_CONCURRENT_UPLOAD, false);
        }
    });
}; // end getFrames()

// Start looking for alarm frames. 
logger.info('Waiting for first alarm frame(s)...');
getFrames();