/**
 * Lambda function to email alarm frames if person in image matches the env var FIND_FACE.
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

    fs.readFile(ALARM_CACHE, 'utf8', (err, data) => {
        if (err) {
            // Cached alarm does not exist.
            // If alarm meets filter criteria email it to user and then cache it.
            if (findFace(event.Labels)) {
                const cacheObj = [
                    {
                        event: event.metadata.zmeventid,
                        frame: parseInt(event.metadata.zmframeid, 10)
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

            // If alarm already in cache and isn't stale then skip. 
            // Else email the alarm to user if it meets filter criteria and add to cache. 
            const newAlarm = {event:event.metadata.zmeventid, frame:parseInt(event.metadata.zmframeid, 10)};
            if (alarmNotInCacheOrStale(cachedAlarms, newAlarm)) {
                console.log(`Alarm ${event.metadata.zmeventid}:${event.metadata.zmframeid} too new. Skipping.`);
            } else if (findFace(JSON.parse(event.Labels))) {
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
 * Determine if desired face is in alarm image label metadata. 
 * 
 * @param {object} labels - Alarm image label metadata.
 */
function findFace(labels) {
    function hasFace(obj) {
        return typeof(obj.Face) === 'undefined' ? false : obj.Face === process.env.FIND_FACE;
    }

    return labels.some(hasFace);
}

/**
 * Determine if alarm is in cache or stale. 
 * 
 * @param {object} cachedAlarms - Current cache contents. 
 * @param {object} newAlarm - Alarm to check if in cache. 
 */
function alarmNotInCacheOrStale(cachedAlarms, newAlarm) {
    // If alarms are > FRAME_OFFSET old then they are 'stale'.
    // A stale alarm will trigger a refresh of itself in the cache. 
    const FRAME_OFFSET = 600; // 120 secs @ 5 FPS

    const findAlarmEvent = cachedAlarms.find(element => {
        return element.event === newAlarm.event; 
    });

    if (typeof findAlarmEvent === 'undefined') {
        return false; // event not in cache
    } else {
        return newAlarm.frame < findAlarmEvent.frame + FRAME_OFFSET; // event in cache; test if stale
    }
}

/**
 * Updates the cache.
 * If an alarm isn't in the cache it will be added.
 * If the alarm is already in the cache then it will be refreshed. 
 * 
 * @param {object} cachedAlarms - Current cache contents.
 * @param {object} newAlarm - Alarm to add / refresh.
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
    const labels = JSON.parse(alarm.Labels); // an object containing an array of objects

    // Set up HTML Email
    let htmlString = '<pre><u><b>Label&nbsp;&nbsp;&nbsp;&nbsp;'+
        'Face&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;'+
        'Confidence</u></b><br>';
    labels.Labels.forEach(item => {
        htmlString += item.Name + '&nbsp;&nbsp;&nbsp;';
        htmlString += item.Face + '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;';
        htmlString += item.Confidence.toFixed(1) + '</b><br>';
    });
    htmlString += '</pre>';

    // Set up Text Email
    let textString = 'Label    Face      Confidence\n';
    labels.Labels.forEach(item => {
        textString += item.Name + '    ';
        textString += item.Face + '      ';
        textString += item.Confidence.toFixed(1) + '\n';
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