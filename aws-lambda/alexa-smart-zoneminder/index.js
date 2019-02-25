'use strict';

/**
 * Lambda function for Zoneminder control and status triggered by Alexa.
 * 
 * For details see https://github.com/goruck.
 * 
 * Copyright (c) 2018 Lindo St. Angel
 */

//==============================================================================
//========================== Setup and Globals  ================================
//==============================================================================
const fs = require('fs');
const Alexa = require('alexa-sdk');
const AWS = require('aws-sdk');
const s3 = new AWS.S3({apiVersion: '2006-03-01'});
const { DateTime } = require('luxon');

// Get configuration and define some constants.
let file = fs.readFileSync('./config.json');
const configObj = safelyParseJSON(file);
if (configObj === null) {
    process.exit(1); // TODO: find a better way to exit. 
}
const S3_BUCKET = configObj.zmS3Bucket; // S3 bucket store of zoneminder alarms images
const USE_LOCAL_PATH = configObj.useLocalPath; // Use local or S3 alarm store
const LOCAL_TZ = configObj.localTimeZone; // Define local time zone

// Get credentials and define some constants.
// 'credentials' are simply some sensitive definitions.
file = fs.readFileSync('./creds.json');
const credsObj = safelyParseJSON(file);
if (credsObj === null) {
    process.exit(1); // TODO: find a better way to exit. 
}
const APP_ID = credsObj.alexaAppId; // Alexa skill ID
const LOCAL_PATH = credsObj.localPath; // Local path to zoneminder alarm images

// Help messages.
const helpMessages = ['Show Last Event',
    'Show Last Video',
    'Show Front Porch Event',
    'Show Back Porch Events from 1 week ago',
    'Show Video from back yard',
    'Show Front Gate Events of Lindo from 1 month ago'];

// Globals for use between intents in a session.
let listItems = []; // Holds list items that can be selected on the display or by voice.
let alarmData = []; // Holds alarm data as queried from the database.

//==============================================================================
//========================== Event Handlers  ===================================
//==============================================================================
const handlers = {
    'LaunchRequest': function () {
        log('INFO', `LaunchRequest Event: ${JSON.stringify(this.event)}`);

        let sessionAttributes = this.event.session.attributes;

        const welcomeOutput = 'Welcome to zoneminder!';
        const welcomeReprompt = 'You can say Help to see example commands.';

        // Check if user has a display.
        if (!supportsDisplay.call(this) && !isSimulator.call(this)) {
            this.emit(':ask', welcomeOutput, welcomeReprompt);
            return;
        }

        const content = {
            templateToken: 'ShowText',
            title: welcomeOutput,
            hasDisplaySpeechOutput: welcomeOutput,
            hasDisplayRepromptText: welcomeReprompt,
            bodyText: welcomeReprompt,
            backButton: 'HIDDEN',
            hint: 'help',
            askOrTell: ':ask',
            sessionAttributes: sessionAttributes
        };

        renderTemplate.call(this, content);
    },
    // Show the last alarm from a camera or all cameras.
    'LastAlarm': function() {
        log('INFO', `LastAlarm Event: ${JSON.stringify(this.event)}`);

        const personOrThing = this.event.request.intent.slots.PersonOrThing.value;
        log('INFO', `User supplied person or thing: ${personOrThing}`);

        // Determine if user wants to view an alarm due to a specific person or thing.
        // Default is to check for general alarm (not due to a specific person or thing).
        const {findFaceName, findObjectName} = determineFaceAndObjectName(personOrThing);
        log('INFO', `findFaceName: ${findFaceName}, findObjectName: ${findObjectName}`);

        const cameraName = this.event.request.intent.slots.Location.value;
        log('INFO', `User supplied camera name: ${cameraName}`);

        // Determine if user wants latest alarm from a specific camera or from all cameras.
        let cameraConfigArray = configObj.cameras; // default is to check all cameras
        if (typeof cameraName !== 'undefined') { // check specific camera if given
            // Check if user supplied a valid camera name and if so map to zoneminder name.
            const zoneminderCameraName = alexaCameraToZoneminderCamera(cameraName.toLowerCase());
            log('INFO', `ZM camera name: ${zoneminderCameraName}`);
            if (zoneminderCameraName === '') {
                log('ERROR', `Bad camera name: ${cameraName}`);
                this.response.speak('Sorry, I cannot find that camera name.');
                this.emit(':responseReady');
                return;
            }
            cameraConfigArray = [{zoneminderName: zoneminderCameraName}];
        }

        // Set starting query one week in the past.
        const dateTime = new Date();
        const offset = 604800; // 1 week in seconds
        dateTime.setTime(dateTime.getTime() - (offset * 1000));

        const params = {
            cameraName: '',
            faceName: findFaceName,
            objectName: findObjectName,
            numberOfAlarms: 1,
            queryStartDateTime: dateTime.toISOString(),
            sortOrder: 'descending', // from latest to earliest
            skipFrame: true // return only 1st frame of event
        };

        let queryResultArray = [];
        let queryCount = 0;

        // Use .forEach() to iterate since it creates its own function closure.
        // See https://stackoverflow.com/questions/11488014/asynchronous-process-inside-a-javascript-for-loop.
        const forEachCall = cameraConfigArray.forEach((element) => {
            params.cameraName = element.zoneminderName;
            findLatestAlarms(params, (err, data) => {
                if (err) {
                    log('ERROR', `Unable to query. ${JSON.stringify(err, null, 2)}`);
                    this.response.speak('Sorry, I cannot complete the request.');
                    this.emit(':responseReady');
                    return;
                }

                if (data.length !== 0) {
                    // Get latest alarm data from this camera.
                    let alarmData = data[0];
                    alarmData.zoneminderName = element.zoneminderName;
                    queryResultArray.push(alarmData);
                }

                queryCount++;

                if (queryCount < cameraConfigArray.length) return;

                // All queries finished, check if any alarms were found.
                if (queryResultArray.length === 0) {
                    this.response.speak('No alarms were found.');
                    this.emit(':responseReady');
                    return;
                }

                // Sort all alarms by datetime in descending order.
                queryResultArray.sort((a, b) => {
                    const dateTimeA = new Date(a.ZmEventDateTime);
                    const dateTimeB = new Date(b.ZmEventDateTime);
                            
                    if (dateTimeA < dateTimeB) return -1;

                    if (dateTimeA > dateTimeB) return 1;

                    // datetimes must be equal
                    return 0;
                });

                // Get alarm with latest datetime.
                const maxArrElem = queryResultArray.length - 1;
                const {S3Key, ZmLocalEventPath, ZmEventDateTime, zoneminderName} = queryResultArray[maxArrElem];

                // Save alarm data for use later on in session if needed.
                alarmData = [queryResultArray[maxArrElem]];

                // Construct speech and text output.
                let output = `alarm from ${zoneminderName} camera `;
                // Append alarm cause to output if given.
                if (findFaceName || findObjectName) output += `caused by ${personOrThing.toLowerCase()} `;
        
                // Append alarm date and time.
                const dt = DateTime.fromISO(ZmEventDateTime.split('.')[0], { zone: 'utc' });
                const rezoned = dt.setZone(LOCAL_TZ);
                output += `on ${rezoned.toLocaleString(DateTime.DATETIME_MED)}`;
                             
                // Check if user has a display and if not just return alarm info w/o image.
                if (!supportsDisplay.call(this) && !isSimulator.call(this)) {
                    const speechOutput = output;
                    this.response.speak(speechOutput);
                    this.emit(':responseReady');
                    return;
                }

                log('INFO', `S3 Key of latest alarm image: ${S3Key} from ${ZmEventDateTime}`);
                log('INFO', `Local Path of latest alarm image: ${ZmLocalEventPath} from ${ZmEventDateTime}`);

                // Check for valid image.
                if (typeof S3Key === 'undefined') {
                    log('ERROR', 'Bad image file');
                    this.response.speak('Sorry, I cannot complete the request.');
                    this.emit(':responseReady');
                    return;
                }

                const content = {
                    hasDisplaySpeechOutput: output,
                    hasDisplayRepromptText: 'You can ask zone minder for something else.',
                    bodyTemplateContent: output,
                    title: `${zoneminderName}`,
                    templateToken: 'ShowImage',
                    askOrTell: ':ask',
                    sessionAttributes: {
                        // Just a single entry in alarmData so this will point to it. 
                        token: '1',
                        // Save context in case user wants to return to previous screen.
                        context: this.event.context.Display.token
                    } 
                };

                if (USE_LOCAL_PATH) {
                    content['backgroundImageUrl'] = LOCAL_PATH + ZmLocalEventPath;
                } else {
                    const params = {Bucket: S3_BUCKET, Key: S3Key};
                    content['backgroundImageUrl'] = s3.getSignedUrl('getObject', params);
                }

                renderTemplate.call(this, content);
            });
        });

        // Direct Alexa to say a wait message to user since operation may take a while.
        // This may reduce user perceived latency. 
        const waitMessage = 'Please wait.';
        const directiveServiceCall = callDirectiveService(this.event, waitMessage);
        Promise.all([directiveServiceCall, forEachCall]).then(() => {
            log('INFO', 'Generated images with interstitial content.');
        }).catch(err => {
            log('ERROR', err);
        });
    },
    // Show a list of recent alarms on the screen for user selection.
    'Alarms': function() {
        log('INFO', `Alarms Event: ${JSON.stringify(this.event)}`);

        const sessionAttributes = this.event.session.attributes;

        // Check if user has a display.
        if (!supportsDisplay.call(this) && !isSimulator.call(this)) {
            const speechOutput = 'Sorry, I need a display to do that.';
            this.response.speak(speechOutput);
            this.emit(':responseReady');
            return;
        }

        const personOrThing = this.event.request.intent.slots.PersonOrThing.value;
        log('INFO', `User supplied person or thing: ${personOrThing}`);

        // Determine if user wants to view an alarm due to a specific person or thing.
        // Default is to check for general alarm (not due to a specific person or thing).
        const {findFaceName, findObjectName} = determineFaceAndObjectName(personOrThing);
        log('INFO', `findFaceName: ${findFaceName}, findObjectName: ${findObjectName}`);

        const cameraName = this.event.request.intent.slots.Location.value;
        log('INFO', `User supplied camera name: ${cameraName}`);

        // Determine if user wants latest alarm from a specific camera or from all cameras.
        // Default is to check all cameras.
        let cameraConfigArray = configObj.cameras;
        let numberOfAlarmsToFind = 1;
        let sortOrder = 'descending'; // latest alarm first
        let output = 'Showing latest alarms from all cameras ';
        if (typeof cameraName !== 'undefined') { // specific camera was given...
            // Check if user supplied a valid camera name and if so map to zoneminder name.
            const zoneminderCameraName = alexaCameraToZoneminderCamera(cameraName.toLowerCase());
            log('INFO', `ZM camera name: ${zoneminderCameraName}`);
            if (zoneminderCameraName === '') {
                log('ERROR', `Bad camera name: ${cameraName}`);
                this.response.speak('Sorry, I cannot find that camera name.');
                this.emit(':responseReady');
                return;
            }
            cameraConfigArray = [{zoneminderName: zoneminderCameraName}];
            // The ListTemplate2 Display Template has a limitation on total bytes in listitems.
            // Looks like 25 signed S3 urls is about the max. 
            numberOfAlarmsToFind = 25;
            sortOrder = 'ascending'; // earliest alarm first
            output = `Showing oldest alarms first from ${zoneminderCameraName} `;
        }

        // Append alarm cause to output if given.
        if (findFaceName || findObjectName) output += `caused by ${personOrThing.toLowerCase()}`;

        // Calculate query start time.
        const someTimeAgo = this.event.request.intent.slots.SomeTimeAgo.value;
        log('INFO', `User supplied query start: ${someTimeAgo}`);
        let dateTime = new Date(); // current datetime
        if (typeof someTimeAgo === 'undefined') {
            // Default to starting query three days in the past.
            // Note that if any camera has events older then this then they will not be shown.
            const offset = 259200; // 3 days in seconds
            dateTime.setTime(dateTime.getTime() - (offset * 1000));
        } else {
            // Calculate query start time from user supplied duration.
            const duration = parseISO8601Duration(someTimeAgo);
            const offset = (duration.years * 31536000) + (duration.months * 2600640)
                + (duration.weeks * 604800) + (duration.days  * 86400)
                + (duration.hours * 3600) + (duration.minutes * 60) + (duration.seconds);
            dateTime.setTime(dateTime.getTime() - (offset * 1000));
        }
        let queryStartDateTime = dateTime.toISOString();
        log('INFO', `Calculated query start datetime: ${queryStartDateTime}`);

        const params = {
            cameraName: '',
            faceName: findFaceName,
            objectName: findObjectName,
            numberOfAlarms: numberOfAlarmsToFind,
            queryStartDateTime: queryStartDateTime,
            sortOrder: sortOrder,
            skipFrame: true // return only 1st frame of event
        };

        let queryCount = 0;
        let queryResultArray = [];
        const forEachCall = cameraConfigArray.forEach((element) => {
            params.cameraName = element.zoneminderName;
            findLatestAlarms(params, (err, data) => {
                if (err) {
                    log('ERROR', `Unable to query. ${JSON.stringify(err, null, 2)}`);
                    this.response.speak('Sorry, I cannot complete the request.');
                    this.emit(':responseReady');
                    return;
                }

                // Get latest alarm data from this camera.
                data.forEach(item => {
                    let alarmData = item;
                    alarmData.zoneminderName = element.zoneminderName;
                    queryResultArray.push(alarmData);
                });

                queryCount++;

                if (queryCount < cameraConfigArray.length) return;

                // All queries finished, check if any alarms were found.
                if (queryResultArray.length === 0) {
                    this.response.speak('No alarms were found.');
                    this.emit(':responseReady');
                    return;
                }

                // Sort all alarms by datetime in descending order.
                queryResultArray.sort((a, b) => {
                    const dateTimeA = new Date(a.ZmEventDateTime);
                    const dateTimeB = new Date(b.ZmEventDateTime);
                            
                    if (dateTimeA < dateTimeB) return -1;

                    if (dateTimeA > dateTimeB) return 1;

                    // datetimes must be equal
                    return 0;
                });

                let token = 1;
                alarmData = [];
                listItems = [];
                queryResultArray.forEach((item) => {
                    //log('INFO', `S3Key: ${item.S3Key} ZmEventDateTime: ${item.ZmEventDateTime}`);
                    // Add alarm date and time.
                    const dt = DateTime.fromISO(item.ZmEventDateTime.split('.')[0], { zone: 'utc' });
                    const rezoned = dt.setZone(LOCAL_TZ);
                    const datetime = rezoned.toLocaleString(DateTime.DATETIME_MED);

                    let imageUrl = '';
                    if (USE_LOCAL_PATH) {
                        imageUrl = LOCAL_PATH + item.ZmLocalEventPath;
                    } else {
                        const params = {Bucket: S3_BUCKET, Key: item.S3Key};
                        imageUrl = s3.getSignedUrl('getObject', params);
                    }

                    let templateJSON =  {
                        'token': token.toString(),
                        'image': {
                            'contentDescription': item.zoneminderName,
                            'sources': [
                                {
                                    'url': imageUrl
                                }
                            ]
                        },
                        'textContent': {
                            'primaryText': {
                                'text': item.zoneminderName,
                                'type': 'PlainText'
                            },
                            'secondaryText': {
                                'text': datetime,
                                'type': 'PlainText'
                            },
                            'tertiaryText': {
                                'text': '',
                                'type': 'PlainText'
                            }
                        }
                    };

                    listItems.push(templateJSON);

                    alarmData.push(item);
              
                    token++;
                });

                const content = {
                    hasDisplaySpeechOutput: output,
                    hasDisplayRepromptText: 'You can ask to see an alarm by number, or touch it.',
                    templateToken: 'ShowImageList',
                    askOrTell: ':ask',
                    listItems: listItems,
                    hint: 'select number 1',
                    title: output,
                    sessionAttributes: sessionAttributes
                };
        
                renderTemplate.call(this, content);
            });
        });

        // Direct Alexa to say a wait message to user since operation may take a while.
        // This may reduce user perceived latency. 
        const waitMessage = 'Please wait.';
        const directiveServiceCall = callDirectiveService(this.event, waitMessage);
        Promise.all([directiveServiceCall, forEachCall]).then(() => {
            log('INFO', 'Generated images with interstitial content.');
        }).catch(err => {
            log('ERROR', err);
        });
    },
    // Show video of an alarm.
    'AlarmClip': function() {
        log('INFO', `AlarmClip Event: ${JSON.stringify(this.event)}`);

        const sessionAttributes = this.event.session.attributes;

        // Callback to pass to https call that generates alarm clip on server. 
        const showClipCallback = (err, resStr) => {
            if (err) {
                log('ERROR', `PlayBack httpsReq: ${err}`);
                this.response.speak('sorry, I can\'t complete the request');
                this.emit(':responseReady');
                return;
            }

            const result = safelyParseJSON(resStr);
            if (result === null || result.success === false) {
                log('ERROR', `Playback result: ${JSON.stringify(result)}`);
                this.response.speak('sorry, I cannot complete the request');
                this.emit(':responseReady');
                return;
            }

            const content = {
                hasDisplaySpeechOutput: 'Showing clip of selected alarm.',
                uri: credsObj.alarmVideoPath,
                title: 'Alarm Video',
                templateToken: 'ShowVideo',
                sessionAttributes: sessionAttributes
            };

            renderTemplate.call(this, content);
        };

        // Check if session attributes were set.
        // If they were then an alarm was just viewed and user wants to see video.
        // If not then skip this and process request normally. 
        if (Object.keys(sessionAttributes).length !== 0) {
            // item points to latest alarm frame, event ID and datetime.
            const item = parseInt(sessionAttributes.token, 10) - 1;
            const lastEvent = alarmData[item].ZmEventId;
            const ZmEventDateTime = alarmData[item].ZmEventDateTime;
            const lastFrame = alarmData[item].ZmFrameId;
            // Number of frames before last frame to show in video. 
            const IN_SESSION_PRE_FRAMES = 100;
            let startFrame = 0;
            if (lastFrame > IN_SESSION_PRE_FRAMES) {
                startFrame = lastFrame - IN_SESSION_PRE_FRAMES;
            }
            // Number of frames after last frame to show in video.
            const IN_SESSION_POST_FRAMES = 100;
            const endFrame = lastFrame + IN_SESSION_POST_FRAMES;

            log('INFO', 'Showing video in session.');
            log('INFO', `Event ID of latest alarm image: ${lastEvent} from ${ZmEventDateTime}`);
            log('INFO', `Start Frame of latest alarm image: ${startFrame}`);
            log('INFO', `End Frame of latest alarm image: ${endFrame}`);

            const method   = 'GET';
            const path     = '/cgi/gen-vid.py?event='+lastEvent.toString()+
                             '&start_frame='+startFrame.toString()+'&end_frame='+endFrame.toString();
            const postData = '';
            const text     = true;
            const user     = credsObj.cgiUser;
            const pass     = credsObj.cgiPass;
            const httpsCall = httpsReq(method, path, postData, text, user, pass, showClipCallback);

            // Direct Alexa to say a wait message to user since operation may take a while.
            // This may reduce user perceived latency.
            const waitMessage = 'Please wait.';
            const directiveServiceCall = callDirectiveService(this.event, waitMessage);
            Promise.all([directiveServiceCall, httpsCall]).then(() => {
                log('INFO', 'Generated video with interstitial content.');
            });

            return;
        }

        // Delegate to Alexa for camera location slot confirmation.
        let delegateState = delegateToAlexa.call(this);
        if (delegateState == null) return;

        const cameraName = this.event.request.intent.slots.Location.value;

        // Check if user supplied a valid camera name and if so map to zoneminder name.
        const zoneminderCameraName = alexaCameraToZoneminderCamera(cameraName.toLowerCase());
        log('INFO', `ZM camera name: ${zoneminderCameraName}`);
        if (zoneminderCameraName === '') {
            log('ERROR', `Bad camera name: ${cameraName}`);
            this.response.speak('Sorry, I cannot find that camera name.');
            this.emit(':responseReady');
            return;
        }

        // Set starting query one week in the past.
        const dateTime = new Date();
        const offset = 604800; // 1 week in seconds
        dateTime.setTime(dateTime.getTime() - (offset * 1000));

        const params = {
            cameraName: zoneminderCameraName,
            faceName: null,
            objectName: null,
            numberOfAlarms: 100,
            queryStartDateTime: dateTime.toISOString(),
            sortOrder: 'descending', // latest alarm first
            skipFrame: false
        };
        findLatestAlarms(params, (err, data) => {
            if (err) {
                log('ERROR', `Unable to query. ${JSON.stringify(err, null, 2)}`);
                this.response.speak('Sorry, I cannot complete the request.');
                this.emit(':responseReady');
                return;
            }

            if (data.length === 0) {
                this.response.speak('No alarms were found.');
                this.emit(':responseReady');
                return;
            }

            // Check if user has a display and if not return error message.
            if (!supportsDisplay.call(this) && !isSimulator.call(this)) {
                const speechOutput = 'Sorry, I cannot play video on this device';
                this.response.speak(speechOutput);
                this.emit(':responseReady');
                return;
            }

            // Get event id and last frame id of latest alarm.
            const lastEvent = data[0].ZmEventId;
            let endFrame = data[0].ZmFrameId;
            
            // Find the first frame id of the last event.
            let startFrame = 0;
            data.forEach((alarm) => {
                if (alarm.ZmEventId === lastEvent) {
                    startFrame = alarm.ZmFrameId;
                }
            });

            // Pad clip to make sure it not too short. 
            if (startFrame < 20) {
                startFrame -= startFrame;
            } else {
                startFrame -= 20;
            }

            if (endFrame < 20) {
                endFrame += endFrame;
            } else {
                endFrame += 20;
            }

            // Limit clip to make sure its not too long. 
            if ((endFrame - startFrame) > 500) {
                endFrame = startFrame + 500;
                log('INFO', 'Limited duration of clip to 500 frames.');
            }

            const ZmEventDateTime = data[0].ZmEventDateTime;
            log('INFO', `Event ID of latest alarm image: ${lastEvent} from ${ZmEventDateTime}`);
            log('INFO', `Start Frame of latest alarm image: ${startFrame}`);
            log('INFO', `End Frame of latest alarm image: ${endFrame}`);

            const method   = 'GET';
            const path     = '/cgi/gen-vid.py?event='+lastEvent.toString()+
                             '&start_frame='+startFrame.toString()+'&end_frame='+endFrame.toString();
            const postData = '';
            const text     = true;
            const user     = credsObj.cgiUser;
            const pass     = credsObj.cgiPass;
            const httpsCall = httpsReq(method, path, postData, text, user, pass, showClipCallback);

            // Direct Alexa to say a wait message to user since operation may take a while.
            // This may reduce user perceived latency.
            const waitMessage = 'Please wait.';
            const directiveServiceCall = callDirectiveService(this.event, waitMessage);
            Promise.all([directiveServiceCall, httpsCall]).then(() => {
                log('INFO', 'Generated video with interstitial content.');
            }).catch(err => {
                log('ERROR', err);
            });
        });
    },
    // Handle user selecting an item from a list on the screen by touch.
    'ElementSelected': function() {
        log('INFO', `ElementSelected Event: ${JSON.stringify(this.event)}`);

        const token = this.event.request.token;
        const selectedItem = listItems.find(item => item.token === token);

        const content = {
            hasDisplaySpeechOutput: 'Showing selected alarm.',
            hasDisplayRepromptText: 'You can ask zone minder for something else.',
            bodyTemplateContent: selectedItem.textContent.secondaryText.text,
            backgroundImageUrl: selectedItem.image.sources[0].url,
            templateToken: 'ShowImage',
            askOrTell: ':ask',
            sessionAttributes: {
                // Used to view a video of this alarm from here. 
                token: token,
                // Used to return to previous screen from here. 
                context: this.event.context.Display.token
            } 
        };

        renderTemplate.call(this, content);
    },
    // Handle user selecting an item from a list on the screen by voice.
    'SelectItem': function() {
        log('INFO', `SelectItem Event: ${JSON.stringify(this.event)}`);

        const token = this.event.request.intent.slots.number.value;
        if (typeof token === 'undefined') {
            log('ERROR', `Bad value. ${token}`);
            this.response.speak('Sorry, something went wrong. Goodbye');
            this.emit(':responseReady');
            return;
        }

        const selectedItem = listItems.find(item => item.token === token);
        if (typeof selectedItem === 'undefined') {
            log('ERROR', `Bad value. ${token}`);
            this.response.speak('Sorry, that\'s not a valid selection. Goodbye');
            this.emit(':responseReady');
            return;
        }

        const content = {
            hasDisplaySpeechOutput: 'Showing selected alarm.',
            hasDisplayRepromptText: 'You can ask zone minder for something else.',
            bodyTemplateContent: selectedItem.textContent.secondaryText.text,
            backgroundImageUrl: selectedItem.image.sources[0].url,
            templateToken: 'ShowImage',
            askOrTell: ':ask',
            sessionAttributes: {
                // Used to view a video of this alarm from here. 
                token: token,
                // Used to return to previous screen from here. 
                context: this.event.context.Display.token
            } 
        };

        renderTemplate.call(this, content);
    },
    'AMAZON.HelpIntent': function () {
        console.log('Help Event: ' + JSON.stringify(this.event));

        let sessionAttributes = this.event.session.attributes;

        // If user does not have a display then only provide audio help. 
        if (!supportsDisplay.call(this) && !isSimulator.call(this)) {
            const helpOutput = `Here are some example commands ${helpMessages.join(' ')}`;
            const helpReprompt = 'Please say a command.';
            this.emit(':ask', helpOutput, helpReprompt);
            return;
        }

        const helpText = `Here are some example commands: ${helpMessages.join()}`;

        const content = {
            templateToken: 'ShowText',
            title: 'zoneminder help',
            bodyText: helpText,
            hasDisplaySpeechOutput: 'Here are some example commands you can say.',
            hasDisplayRepromptText: 'Please say a command.',
            backButton: 'HIDDEN',
            hint: 'help',
            askOrTell: ':ask',
            sessionAttributes: sessionAttributes
        };

        renderTemplate.call(this, content);
    },
    'AMAZON.CancelIntent': function () {
        console.log('Cancel Event: ' + JSON.stringify(this.event));
        const speechOutput = 'goodbye';
        this.response.speak(speechOutput);
        this.emit(':responseReady');
        return;
    },
    'AMAZON.StopIntent': function () {
        console.log('Stop Event: ' + JSON.stringify(this.event));
        const speechOutput = 'goodbye';
        this.response.speak(speechOutput);
        this.emit(':responseReady');
        return;
    },
    'AMAZON.PreviousIntent': function () {
        console.log(`PreviousIntent Event: ${JSON.stringify(this.event)}`);

        const sessionAttributes = this.event.session.attributes;

        // User wants to return to previously shown list of alarm images.
        if (sessionAttributes.context === 'ShowImageList') {
            const content = {
                hasDisplaySpeechOutput: 'showing previously shown alarms',
                hasDisplayRepromptText: 'You can ask to see an alarm by number, or touch it.',
                templateToken: 'ShowImageList',
                askOrTell: ':ask',
                listItems: listItems,
                hint: 'select number 1',
                title: 'showing previously shown alarms',
                sessionAttributes: {}
            };
    
            renderTemplate.call(this, content);
        }

        const speechOutput = 'Sorry, can\'t go back from here. Goodbye.';
        this.response.speak(speechOutput);
        this.emit(':responseReady');
        return;
    },
    'SessionEndedRequest': function () {
        console.log('Session ended Event: ' + JSON.stringify(this.event));
        const speechOutput = 'goodbye';
        this.response.speak(speechOutput);
        this.emit(':responseReady');
        return;
    },
    'Unhandled': function() {
        console.log('Unhandled Event: ' + JSON.stringify(this.event));
        const speechOutput = 'Something went wrong. Goodbye.';
        this.response.speak(speechOutput);
        this.emit(':responseReady');
        return;
    }
};

exports.handler = (event, context) => {
    const alexa = Alexa.handler(event, context);
    alexa.appId = APP_ID;
    alexa.registerHandlers(handlers);
    alexa.execute();
};

//==============================================================================
//================== Alarm Processing Helper Functions  ========================
//==============================================================================

/**
 * 
 * Determine if user is asking for an alarm caused by a person or thing.
 * 
 * @param {string} personOrThing 
 */
function determineFaceAndObjectName(personOrThing) {
    let faceName = null;
    let objectName = null;
    if (typeof personOrThing !== 'undefined') {
        // If a specific person or thing was given then figure out what it is.
        if (personOrThing.toLowerCase() === 'stranger') {
            // User requested to see an alarm caused by a stranger.
            // Face detection will tag unrecognized people as 'Unknown'.
            faceName = 'Unknown';
        } else {
            // Check if user asked for a specific person.
            const knownFace = alexaFaceNameToDatabaseName(personOrThing.toLowerCase());
            if (knownFace !== null) {
                // User requested to see an alarm caused by a specific person.
                // Considering our dog to be a person :)
                knownFace === 'dog' ? objectName = 'dog' : faceName = knownFace;
            } else {
                // User requested to see an alarm caused by a thing, not a person.
                objectName = personOrThing.toLowerCase();
            }
        }
    }
    return {findFaceName: faceName, findObjectName: objectName};
}

/**
 * Mapping from Alexa returned camera names to zoneminder camera names.
 * 
 * @param {*} alexaCameraName 
 */
function alexaCameraToZoneminderCamera(alexaCameraName) {
    const cameraConfigArray = configObj.cameras;

    let zoneminderCameraName = '';

    cameraConfigArray.forEach((element) => {
        // True if a valid value was passed.
        let isValidCamera = element.friendlyNames.indexOf(alexaCameraName) > -1;
        if (isValidCamera) {
            zoneminderCameraName = element.zoneminderName;
        }
    });

    return zoneminderCameraName;
}

/**
 * Mapping from Alexa returned face names to database face names.
 * 
 * @param {*} alexaFaceName 
 */
function alexaFaceNameToDatabaseName(alexaFaceName) {
    const faceNamesArray = configObj.faces;

    // If a match was not found then look for Unknown faces in database.
    let databaseFaceName = null;

    faceNamesArray.forEach((element) => {
        // True if a valid value was passed.
        const isValidFace = element.friendlyNames.indexOf(alexaFaceName) > -1;
        if (isValidFace) {
            databaseFaceName = element.databaseName;
        }
    });

    return databaseFaceName;
}

/**
  * 
  * Query database for alarm frames matching given parameters. 
  * 
  * @param {object} queryParams - An object with query parameters.
  * @param {string} queryParams.cameraName - oneMinder monitor name to search over.
  * @param {string} queryParams.faceName - Name of a person to search for.
  * @param {string} queryParams.objectName - Name of an object to search for.
  * @param {int} queryParams.numberOfAlarms - Number of alarm frames to find.
  * @param {string} queryParams.queryStartDateTime - Query start datetime in ISO8601 format.
  * @param {string} queryParams.sortOrder - Either 'ascending' or 'descending' query results. 
  * @param {boolean} queryParams.skipFrame - If true return first or last frame in event.
  * @param {function} callback - An array holding found alarms or an error string.
  */
function findLatestAlarms(queryParams, callback) {
    const {cameraName, faceName, objectName, numberOfAlarms,
        queryStartDateTime, sortOrder, skipFrame} = queryParams;

    const docClient = new AWS.DynamoDB.DocumentClient(
        {apiVersion: '2012-10-08', region: configObj.awsRegion}
    );

    // Base query looks for true false positives from a named camera.
    // If faceName or objectName is null then any person or object will queried for. 
    let filterExpression = 'Alert = :state';
    let projectionExpression = 'ZmEventDateTime, S3Key, ZmEventId, ZmFrameId, ZmLocalEventPath, Labels';
    const expressionAttributeValues = {
        ':name': cameraName,
        ':state': 'true',
        ':date': queryStartDateTime
    };

    const params = {
        TableName: 'ZmAlarmFrames',
        // ScanIndexForward: false - descending sort order (alarms from latest to earliest)
        // ScanIndexForward: true - ascending sort order (alarms from earliest to latest)
        ScanIndexForward: sortOrder === 'ascending',
        ProjectionExpression: projectionExpression,
        KeyConditionExpression: 'ZmCameraName = :name AND ZmEventDateTime > :date',
        FilterExpression: filterExpression,
        ExpressionAttributeValues: expressionAttributeValues
    };

    let foundAlarms = [];
    let foundAlarmCount = 0;
    let lastZmEventId = -1;
                    
    function queryExecute() {
        docClient.query(params, (err, data) => {
            if (err) {
                return callback(err, null);
            }
      
            // If a query was successful then add to list.
            for (const item of data.Items) {
                // If skipFrame enabled only add first frame of an event; skip all others.
                if (skipFrame && (item.ZmEventId === lastZmEventId)) continue;
                // If a face or object name was given try to find it in item; skip all others.
                // Object name is ignored if face is given since it has to be a person. 
                if (faceName !== null) {
                    if (!item.Labels.some(label => label.Face === faceName)) continue;
                } else if (objectName !== null) {
                    if (!item.Labels.some(label => label.Name === objectName)) continue;
                }
                lastZmEventId = item.ZmEventId;
                foundAlarms.push(item);
                foundAlarmCount++;
                if (foundAlarmCount === numberOfAlarms) {
                    return callback(null, foundAlarms);
                }
            }

            // Query again if there are more records.
            // Else return what was found so far (if anything).
            if (data.LastEvaluatedKey) {
                params.ExclusiveStartKey = data.LastEvaluatedKey;
                queryExecute();
            } else {
                return callback(null, foundAlarms);
            }
        });
    }    
                    
    queryExecute();
}

//==============================================================================
//========================= Alexa Helper Functions =============================
//==============================================================================

/**
 * Send the User a Progressive Response.
 * 
 * @param {*} event 
 * @param {*} message 
 */
function callDirectiveService(event, message) {
    // Instantiate Alexa Directive Service
    const ds = new Alexa.services.DirectiveService();
    // Extract Variables
    const requestId = event.request.requestId;
    const endpoint = event.context.System.apiEndpoint;
    const token = event.context.System.apiAccessToken;
    // Instantiate Progressive Response Directive
    const directive = new Alexa.directives.VoicePlayerSpeakDirective(requestId, message);
    // Store functions as data in queue
    return ds.enqueue(directive, endpoint, token);
}

/**
 * Delegate response to Alexa.
 */
function delegateToAlexa() {
    //console.log("in delegateToAlexa");
    //console.log("current dialogState: "+ this.event.request.dialogState);

    if (this.event.request.dialogState === 'STARTED') {
        //console.log("in dialog state STARTED");
        const updatedIntent = this.event.request.intent;
        //optionally pre-fill slots: update the intent object with slot values for which
        //you have defaults, then return Dialog.Delegate with this updated intent
        // in the updatedIntent property
        this.emit(':delegate', updatedIntent);
    } else if (this.event.request.dialogState !== 'COMPLETED') {
        //console.log("in dialog state COMPLETED");
        // Return a Dialog.Delegate directive with no updatedIntent property
        this.emit(':delegate');
    } else {
        //console.log("dialog finished");
        //console.log("returning: "+ JSON.stringify(this.event.request.intent));
        // Dialog is now complete and all required slots should be filled,
        // so call your normal intent handler.
        return this.event.request.intent;
    }
}

/**
 * Determine if device has a screen.
 */
function supportsDisplay() {
    const hasDisplay =
    this.event.context &&
    this.event.context.System &&
    this.event.context.System.device &&
    this.event.context.System.device.supportedInterfaces &&
    this.event.context.System.device.supportedInterfaces.Display;

    return hasDisplay;
}

/**
 * Determine is simulator is being used.
 */
function isSimulator() {
    const isSimulator = !this.event.context; //simulator doesn't send context
    return isSimulator;
}

/**
 * 
 * Generate display templates for Alexa device with a screen.
 * 
 * @param {*} content 
 */
function renderTemplate(content) {
    log('INFO', `renderTemplate ${content.templateToken}`);

    let response = {};
   
    switch(content.templateToken) {
    case 'ShowVideo':
        response = {
            'version': '1.0',
            'sessionAttributes': content.sessionAttributes,
            'response': {
                'outputSpeech': {
                    'type': 'SSML',
                    'ssml': '<speak>'+content.hasDisplaySpeechOutput+'</speak>'
                },
                'reprompt': null,
                'card': null, // TODO: get cards to work.
                'directives': [
                    {
                        'type': 'VideoApp.Launch',
                        'videoItem': {
                            'source': content.uri,
                            'metadata': {
                                'title': content.title,
                                'subtitle': ''
                            }
                        }
                    }
                ]
            }
        };
        // Send the response to Alexa.
        this.context.succeed(response);
        break;
    case 'ShowImageList':
        response = {
            'version': '1.0',
            'response': {
                'directives': [
                    {
                        'type': 'Display.RenderTemplate',
                        'template': {
                            'type': 'ListTemplate2',
                            'backButton': 'VISIBLE',
                            'title': content.title,
                            'token': content.templateToken,
                            'listItems': content.listItems
                        }
                    },
                    {
                        'type': 'Hint',
                        'hint': {
                            'type': 'PlainText',
                            'text': content.hint
                        }
                    }
                ],
                'outputSpeech': {
                    'type': 'SSML',
                    'ssml': '<speak>'+content.hasDisplaySpeechOutput+'</speak>'
                },
                'reprompt': {
                    'outputSpeech': {
                        'type': 'SSML',
                        'ssml': '<speak>'+content.hasDisplayRepromptText+'</speak>'
                    }
                },
                'card': null, // TODO: get cards to work.
                'shouldEndSession': content.askOrTell === ':tell'
            },
            'sessionAttributes': content.sessionAttributes
        };

        if(content.backgroundImageUrl) {
            let sources = [
                {
                    'url': content.backgroundImageUrl
                }
            ];
            response['response']['directives'][0]['template']['backgroundImage'] = {};
            response['response']['directives'][0]['template']['backgroundImage']['sources'] = sources;
        }

        // Send the response to Alexa.
        this.context.succeed(response);
        break;
    case 'ShowTextList':
        response = {
            'version': '1.0',
            'response': {
                'directives': [
                    {
                        'type': 'Display.RenderTemplate',
                        'template': {
                            'type': 'ListTemplate1',
                            'backButton': 'HIDDEN',
                            'title': content.title,
                            'token': content.templateToken,
                            'listItems': content.listItems
                        }
                    }
                ],
                'outputSpeech': {
                    'type': 'SSML',
                    'ssml': '<speak>'+content.hasDisplaySpeechOutput+'</speak>'
                },
                'reprompt': {
                    'outputSpeech': {
                        'type': 'SSML',
                        'ssml': '<speak>'+content.hasDisplayRepromptText+'</speak>'
                    }
                },
                'card': null, // TODO: get cards to work.
                'shouldEndSession': content.askOrTell === ':tell'
            },
            'sessionAttributes': content.sessionAttributes
        };

        if(content.backgroundImageUrl) {
            let sources = [
                {
                    'url': content.backgroundImageUrl
                }
            ];
            response['response']['directives'][0]['template']['backgroundImage'] = {};
            response['response']['directives'][0]['template']['backgroundImage']['sources'] = sources;
        }

        // Send the response to Alexa.
        this.context.succeed(response);
        break;
    case 'ShowImage':
        response = {
            'version': '1.0',
            'response': {
                'directives': [
                    {
                        'type': 'Display.RenderTemplate',
                        'template': {
                            'type': 'BodyTemplate6',
                            'backButton': 'VISIBLE',
                            'title': content.title,
                            'token': content.templateToken,
                            'textContent': {
                                'primaryText': {
                                    'type': 'RichText',
                                    'text': '<font size = \'3\'>'+content.bodyTemplateContent+'</font>'
                                }
                            }
                        }
                    },
                    {
                        'type': 'Hint',
                        'hint': {
                            'type': 'PlainText',
                            'text': content.hint
                        }
                    }
                ],
                'outputSpeech': {
                    'type': 'SSML',
                    'ssml': '<speak>'+content.hasDisplaySpeechOutput+'</speak>'
                },
                'reprompt': {
                    'outputSpeech': {
                        'type': 'SSML',
                        'ssml': '<speak>'+content.hasDisplayRepromptText+'</speak>'
                    }
                },
                'card': null, // TODO: get cards to work.
                'shouldEndSession': content.askOrTell === ':tell',
            },
            'sessionAttributes': content.sessionAttributes
        };

        if(content.backgroundImageUrl) {
            let sources = [
                {
                    'url': content.backgroundImageUrl
                }
            ];
            response['response']['directives'][0]['template']['backgroundImage'] = {};
            response['response']['directives'][0]['template']['backgroundImage']['sources'] = sources;
        }

        //Send the response to Alexa
        this.context.succeed(response);
        break;
    case 'ShowText':
        response = {
            'version': '1.0',
            'response': {
                'directives': [
                    {
                        'type': 'Display.RenderTemplate',
                        'template': {
                            'type': 'BodyTemplate1',
                            'backButton': content.backButton,
                            'title': content.title,
                            'token': content.templateToken,
                            'textContent': {
                                'primaryText': {
                                    'type': 'RichText',
                                    'text': '<font size = \'7\'>'+content.bodyText+'</font>'
                                }
                            }
                        }
                    },
                    {
                        'type': 'Hint',
                        'hint': {
                            'type': 'PlainText',
                            'text': content.hint
                        }
                    }
                ],
                'outputSpeech': {
                    'type': 'SSML',
                    'ssml': '<speak>'+content.hasDisplaySpeechOutput+'</speak>'
                },
                'reprompt': {
                    'outputSpeech': {
                        'type': 'SSML',
                        'ssml': '<speak>'+content.hasDisplayRepromptText+'</speak>'
                    }
                },
                'card': null, // TODO: get cards to work.
                'shouldEndSession': content.askOrTell === ':tell',
            },
            'sessionAttributes': content.sessionAttributes
        };

        if(content.backgroundImageUrl) {
            let sources = [
                {
                    'url': content.backgroundImageUrl
                }
            ];
            response['response']['directives'][0]['template']['backgroundImage'] = {};
            response['response']['directives'][0]['template']['backgroundImage']['sources'] = sources;
        }

        //Send the response to Alexa
        this.context.succeed(response);
        break;
    default:
        this.response.speak('Thanks for using zone minder, goodbye');
        this.emit(':responseReady');
    }
}

//==============================================================================
//======================== Other Helper Functions  =============================
//==============================================================================

/**
 * 
 * POST or GET from an https endpoint.
 * 
 * @param {*} method 
 * @param {*} path 
 * @param {*} postData 
 * @param {*} text 
 * @param {*} user 
 * @param {*} pass 
 * @param {*} callback 
 */
function httpsReq(method, path, postData, text, user, pass, callback) {
    // If environment variables for host and port exist then override configuration. 
    let HOST = '';
    if (process.env.host) {
        HOST = process.env.host;
    } else {
        HOST = credsObj.host;
    }

    let PORT = '';
    if (process.env.port) {
        PORT = process.env.port;
    } else {
        PORT = credsObj.port;
    }

    const https = require('https'),
        Stream = require('stream').Transform,
        zlib = require('zlib');

    let options = {
        hostname: HOST,
        port: PORT,
        path: path,
        method: method,
        headers: {
            'Content-Type': (text ? 'application/json' : 'image/png'),
            'Content-Length': postData.length,
            'accept-encoding' : 'gzip,deflate'
        }
    };

    if (user && pass) {
        const auth = 'Basic ' + Buffer.from(user + ':' + pass).toString('base64');
        options.headers.Authorization = auth;
    }

    const req = https.request(options, (result) => {
        const data = new Stream();
        data.setEncoding('utf8'); // else a buffer will be returned

        result.on('data', (chunk) => {
            data.push(chunk);
            //console.log("chunk: " +chunk);
        });

        result.on('end', () => {
            //console.log("STATUS: " + result.statusCode);
            //console.log("HEADERS: " + JSON.stringify(result.headers));

            var encoding = result.headers['content-encoding'];
            if (encoding == 'gzip') {
                zlib.gunzip(data.read(), function(err, decoded) {
                    callback(null, decoded); // TODO: add error handling.
                });
            } else if (encoding == 'deflate') {
                zlib.inflate(data.read(), function(err, decoded) {
                    callback(null, decoded);
                });
            } else {
                callback(null, data.read());
            }
        });
    });

    // Set timeout on socket inactivity. 
    req.on('socket', function (socket) {
        socket.setTimeout(45000); // 45 sec timeout. 
        socket.on('timeout', function() {
            req.abort();
        });
    });

    req.write(postData);

    req.end();

    req.on('error', (e) => {
        log('ERROR', 'https request: ' + e.message);
        callback(e.message, null);
    });
}

/**
  * 
  * Parse ISO8501 duration string.
  * See https://stackoverflow.com/questions/27851832/how-do-i-parse-an-iso-8601-formatted-duration-using-moment-js
  * 
  * @param {*} durationString 
  */
function parseISO8601Duration(durationString) {
    // regex to parse ISO8501 duration string.
    // TODO: optimize regex since it matches way more than needed.
    var iso8601DurationRegex = /P((([0-9]*\.?[0-9]*)Y)?(([0-9]*\.?[0-9]*)M)?(([0-9]*\.?[0-9]*)W)?(([0-9]*\.?[0-9]*)D)?)?(T(([0-9]*\.?[0-9]*)H)?(([0-9]*\.?[0-9]*)M)?(([0-9]*\.?[0-9]*)S)?)?/;

    var matches = durationString.match(iso8601DurationRegex);
    //console.log("parseISO8601Duration matches: " +matches);

    return {
        years: matches[3] === undefined ? 0 : parseInt(matches[3]),
        months: matches[5] === undefined ? 0 : parseInt(matches[5]),
        weeks: matches[7] === undefined ? 0 : parseInt(matches[7]),
        days: matches[9] === undefined ? 0 : parseInt(matches[9]),
        hours: matches[12] === undefined ? 0 : parseInt(matches[12]),
        minutes: matches[14] === undefined ? 0 : parseInt(matches[14]),
        seconds: matches[16] === undefined ? 0 : parseInt(matches[16])
    };
}

/**
  * 
  * Checks for valid JSON and parses it.
  * 
  * @param {*} json 
  */
function safelyParseJSON(json) {
    try {
        return JSON.parse(json);
    } catch (e) {
        log('ERROR', `JSON parse error: ${e}`);
        return null;
    }
}

/**
  * 
  * Basic logger.
  * 
  * @param {*} title 
  * @param {*} msg 
  */
function log(title, msg) {
    console.log(`[${title}] ${msg}`);
}