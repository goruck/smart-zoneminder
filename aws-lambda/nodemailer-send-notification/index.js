/**
 * Lambda function to email alarm frames if person in image matches the env var FIND_FACES.
 * The code contains logic and uses a cache so that only one alarm image is sent from an event. 
 * The /tmp dir is used as a transient cache to hold information about processed alarms.
 * The Reserve Concurrency for this fn must be set to 1. 
 * This is normally the last task in the state machine.
 * 
 * This is part of the smart-zoneminder project. See https://github.com/goruck/smart-zoneminder.
 * 
 * Copyright (c) 2018, 2019 Lindo St. Angel.
 */

'use strict';

exports.handler = (event, context, callback) => {
    const fs = require('fs');
    const ALARM_CACHE = '/tmp/alarm_cache';

    console.log(`Current event: ${JSON.stringify(event, null, 2)}`);

    // Extract array of faces from event (if they exist).
    const faces = extractFaces(event.Labels);

    fs.readFile(ALARM_CACHE, 'utf8', (err, data) => {
        if (err) {
            // Alarm cache does not exist because this lambda is starting cold. 
            // If alarm meets filter criteria email it to user and then cache it.
            if (findFace(event.Labels)) {
                const cacheObj = [
                    {
                        event: event.metadata.zmeventid,
                        frame: parseInt(event.metadata.zmframeid, 10),
                        faces: faces
                    }
                ];

                fs.writeFile(ALARM_CACHE, JSON.stringify(cacheObj), (err) => {
                    if (err) {
                        console.log(`writeFile error: ${err}`);
                        callback(err);
                    } else {
                        console.log(`Wrote to cache: ${JSON.stringify(cacheObj, null, 2)}`);
                        console.log(`Emailing alarm ${event.metadata.zmeventid}:${event.metadata.zmframeid} to user.`);
                        sendMail(event, callback);
                    }
                });
            } else {
                console.log(`Alarm ${event.metadata.zmeventid}:${event.metadata.zmframeid} does not meet filter criteria.`);
            }
        } else {
            const cachedAlarms = JSON.parse(data); // array of cached alarms
            console.log(`Read alarm(s) from cache: ${JSON.stringify(cachedAlarms, null, 2)}`);

            // If alarm doesn't need to be processed, skip it. 
            // Else email the alarm to user if it meets filter criteria and add to cache. 
            const newAlarm = {
                event: event.metadata.zmeventid,
                frame: parseInt(event.metadata.zmframeid, 10),
                faces: faces
            };
            if (!processAlarm(cachedAlarms, newAlarm)) {
                console.log(`Alarm ${event.metadata.zmeventid}:${event.metadata.zmframeid} does not require processing.`);
            } else if (findFace(event.Labels)) {
                const cacheObj = updateCachedAlarms(cachedAlarms, newAlarm);
                fs.writeFile(ALARM_CACHE, JSON.stringify(cacheObj), (err) => {
                    if (err) {
                        console.log(`writeFile error: ${err}`);
                        callback(err);
                    } else {
                        console.log(`Wrote to cache: ${JSON.stringify(cacheObj, null, 2)}`);
                        console.log(`Emailing alarm ${event.metadata.zmeventid}:${event.metadata.zmframeid} to user.`);
                        sendMail(event, callback);
                    }
                });
            } else {
                console.log(`Alarm ${event.metadata.zmeventid}:${event.metadata.zmframeid} does not meet filter criteria.`);
            }
        }
    });
};

/**
 * Extract faces from event.
 * 
 * @param {object} labels - Alarm image label metadata.
 * @returns {Array} - An array with faces from event. 
 */
function extractFaces(labels) {
    const faces = [];
    labels.forEach(obj => {
        if ('Face' in obj && obj.Face !== null) faces.push(obj.Face);
    });
    return faces;
}

/**
 * Determine if desired face is in alarm image label metadata. 
 * 
 * @param {object} labels - Alarm image label metadata.
 * @returns {boolean} - If true desired face was found in labels. 
 */
function findFace(labels) {
    function hasFace(obj) {
        // Get faces to look for. 
        const faces = process.env.FIND_FACES.split(',');
        // If a face exists in the metadata then check if its one we desire. 
        return 'Face' in obj ? faces.includes(obj.Face) : false;
    }
    // Check if at least one desired face is in metadata. 
    return labels.some(hasFace);
}

/**
 * Determine if a new alarm should be processed based on cached alarms. 
 * 
 * @param {object} cachedAlarms - Current cache contents. 
 * @param {object} newAlarm - Alarm to check.
 * @returns {boolean} - if true new alarm should be processed. 
 */
function processAlarm(cachedAlarms, newAlarm) {
    // If alarms are > FRAME_OFFSET old then they are 'stale'.
    // A stale alarm will trigger a refresh of itself in the cache. 
    const FRAME_OFFSET = 600; // 120 secs @ 5 FPS

    // Scan cache for same event as in the new alarm. 
    const findAlarmEvent = cachedAlarms.find(element => {
        return element.event === newAlarm.event; 
    });

    // Scan cache for same faces as in the new alarm.
    const findSameFaces = () => {
        let same = false;
        cachedAlarms.forEach(obj => {
            same = same || obj.faces.every(face => newAlarm.faces.includes(face));
        });
        return same;
    };

    if (typeof findAlarmEvent === 'undefined') {
        return true; // event not in cache, alarm should be processed
    } else if (!findSameFaces()) {
        return true; // faces not in cache, alarm should be processed
    } else {
        // event and faces in cache; test if stale and if so, process it
        return newAlarm.frame > findAlarmEvent.frame + FRAME_OFFSET;
    }
}

/**
 * Updates the cache.
 * If an alarm isn't in the cache it will be added.
 * If the alarm is already in the cache then it will be refreshed. 
 * 
 * @param {object} cachedAlarms - Current cache contents.
 * @param {object} newAlarm - Alarm to add / refresh.
 * @returns {object} - Updated alarms to be cached. 
 */
function updateCachedAlarms(cachedAlarms, newAlarm) {
    const findAlarmEvent = cachedAlarms.find(element => {
        return element.event === newAlarm.event; 
    });

    // If alarm is not in cache then add it. Else refresh it.
    if (typeof findAlarmEvent === 'undefined') {
        cachedAlarms.push(newAlarm);
        return cachedAlarms; // return updated array
    } else {
        return cachedAlarms.map(obj => { // return a new array
            if (obj.event === newAlarm.event) {
                return newAlarm;
            } else {
                return obj;
            }
        });
    }
}

/**
 * Email alarm image. 
 * 
 * @param {object} alarm - Alarm to email. 
 */
function sendMail(alarm, callback) {
    const aws = require('aws-sdk');
    const nodemailer = require('nodemailer');
    const sesTransport = require('nodemailer-ses-transport');
    const ses = new aws.SES({apiVersion: '2010-12-01', region: process.env.AWS_REGION});
    const s3 = new aws.S3({apiVersion: '2006-03-01', region: process.env.AWS_REGION});

    // Set up ses as transport for email.
    const transport = nodemailer.createTransport(sesTransport({
        ses: ses
    }));

    // Pickup parameters from calling event.
    const bucket = alarm.bucket;
    const filename = alarm.newFilename;
    const labels = alarm.Labels;

    // Set up HTML Email
    let htmlString = '<pre><u><b>Label&nbsp;'+
        '(Conf)&nbsp;'+
        'Face&nbsp;'+
        '(Conf)</u></b><br>';
    labels.forEach(item => {
        htmlString += item.Name + '&nbsp;';
        htmlString += '(' + item.Confidence.toFixed(0) + ')&nbsp;';
        if ('Face' in item && item.Face !== null) { // check for valid face
            htmlString += item.Face + '&nbsp;';
            htmlString += '(' + item.FaceConfidence.toFixed(0) + ')';
        }
        htmlString += '</b><br>';
    });
    htmlString += '</pre>';

    // Set up Text Email
    let textString = 'Label (Conf) Face (Conf)\n';
    labels.forEach(item => {
        textString += item.Name + ' ';
        textString += '(' + item.Confidence.toFixed(0) + ') ';
        if ('Face' in item && item.Face !== null) {
            textString += item.Face + ' ';
            textString += '(' + item.FaceConfidence.toFixed(0) + ')';
        }
        textString += '\n';
    });

    // Set up email parameters
    const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: process.env.EMAIL_RECIPIENT,
        subject: '⏰ Alarm Event detected! ⏰',
        text: textString,
        html: htmlString,
        attachments: [
            {
                filename: filename.replace('upload/', ''),
                // Get a presigned S3 URL that will expire after one minute.
                path: s3.getSignedUrl('getObject', {Bucket: bucket, Key: filename, Expires: 60})
            }
        ]
    };

    return transport.sendMail(mailOptions, (error, info) => {
        if (error) {
            const errorMessage =  'Error in [nodemailer-send-notification].\r' +
                              '   Function input ['+JSON.stringify(alarm, null, 2)+'].\r' +
                              '   Error ['+error + '].';
            console.log(errorMessage);
            callback(errorMessage);
        } else {
            console.log('Message sent: ' + info.messageId);
        }
    });
}