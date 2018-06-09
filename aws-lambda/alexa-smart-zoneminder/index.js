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
'use strict';
const fs = require('fs');
const Alexa = require('alexa-sdk');

// Get configuration. 
let file = fs.readFileSync('./config.json');
const configObj = safelyParseJSON(file);
if (configObj === null) {
    process.exit(1); // TODO: find a better way to exit. 
}

// Get credentials.
file = fs.readFileSync('./creds.json');
const credsObj = safelyParseJSON(file);
if (credsObj === null) {
    process.exit(1); // TODO: find a better way to exit. 
}

const APP_ID = credsObj.alexaAppId;
let speechOutput = '';
let welcomeOutput = 'Please ask zone minder something.';
let welcomeReprompt = 'Please ask zone minder something.';
/*If you don't want to use cards in your skill, set the USE_IMAGES_FLAG to false.
If you set it to true, you will need an image for each item in your data.*/
const USE_IMAGES_FLAG = true;

// Holds json for items to be displayed on screen, used by several handlers. 
let listItems = [];

//==============================================================================
//========================== Event Handlers  ===================================
//==============================================================================
var handlers = {
    'LaunchRequest': function () {
        this.emit(':ask', welcomeOutput, welcomeReprompt);
    },
    // Show last alarm from a camera or all cameras.
    'LastAlarm': function() {
        log('INFO', `LastAlarm Event: ${JSON.stringify(this.event)}`);

        const cameraName = this.event.request.intent.slots.Location.value;

        log('INFO', `User supplied camera name: ${cameraName}`);

        // If user did not give a camera name then report latest alarm of all cameras.
        if (typeof cameraName === 'undefined') {
            const cameraConfigArray = configObj.cameras;
            let queryResultArray = [];
            let queryCount = 0;

            // Use .forEach() to iterate since it creates its own function closure.
            // See https://stackoverflow.com/questions/11488014/asynchronous-process-inside-a-javascript-for-loop.
            cameraConfigArray.forEach((element) => {
                findLatestAlarms(element.zoneminderName, 1, (err, data) => {
                    if (err) {
                        log('ERROR', `Unable to query. ${JSON.stringify(err, null, 2)}`);
                        this.response.speak('Sorry, I cannot complete the request.');
                        this.emit(':responseReady');
                        return;
                    }

                    if (data.length !== 0) {
                        // Get latest alarm from this camera.
                        const S3Key = data[0].S3Key;
                        const ZmEventDateTime = data[0].ZmEventDateTime;
                        queryResultArray.push({'S3Key': S3Key, 'ZmEventDateTime': ZmEventDateTime,
                            'zoneminderName': element.zoneminderName});
                    }

                    queryCount++;

                    if (queryCount < cameraConfigArray.length) { return; }

                    // All queries finished, check if any alarms were found.
                    if (queryResultArray.length === 0) {
                        this.response.speak('No alarms were found.');
                        this.emit(':responseReady');
                        return;
                    }

                    // Sort all alarms by datetime in decending order.
                    queryResultArray.sort((a, b) => {
                        const dateTimeA = new Date(a.ZmEventDateTime);
                        const dateTimeB = new Date(b.ZmEventDateTime);
                            
                        if (dateTimeA < dateTimeB) { return -1; }

                        if (dateTimeA > dateTimeB) { return 1; }

                        // datetimes must be equal
                        return 0;
                    });

                    // Get alarm with latest datetime.
                    const maxArrElem = queryResultArray.length - 1;
                    const S3Key = queryResultArray[maxArrElem].S3Key;
                    const ZmEventDateTime = queryResultArray[maxArrElem].ZmEventDateTime;
                    const ZmCameraName = queryResultArray[maxArrElem].zoneminderName;
                             
                    // Check if user has a display and if not just return alarm info w/o image.
                    if (!supportsDisplay.call(this) && !isSimulator.call(this)) {
                        speechOutput = 'Last alarm was from '+ZmCameraName+' on '+
                            timeConverter(Date.parse(ZmEventDateTime));
                        this.response.speak(speechOutput);
                        this.emit(':responseReady');
                        return;
                    }

                    log('INFO', `S3 Key of latest alarm image: ${S3Key} from ${ZmEventDateTime}`);

                    // Check for valid image.
                    if (typeof S3Key === 'undefined') {
                        log('ERROR', 'Bad image file');
                        this.response.speak('Sorry, I cannot complete the request.');
                        this.emit(':responseReady');
                        return;
                    }

                    const S3Path = 'https://s3-' + configObj.awsRegion +
                        '.amazonaws.com/' + configObj.zmS3Bucket + '/';

                    const content = {
                        hasDisplaySpeechOutput: 'Showing most recent alarm from '+ZmCameraName+' camera.',
                        bodyTemplateContent: timeConverter(Date.parse(ZmEventDateTime)),
                        templateToken: 'ShowImage',
                        askOrTell: ':tell',
                        sessionAttributes: this.attributes
                    };

                    if (USE_IMAGES_FLAG) {
                        content['backgroundImageUrl'] = S3Path + S3Key;
                    }

                    renderTemplate.call(this, content);

                    return;
                });
            });
        } else {
            // Check if user supplied a valid camera name and if so map to zoneminder name.
            const zoneminderCameraName = alexaCameraToZoneminderCamera(cameraName.toLowerCase());
            log('INFO', `ZM camera name: ${zoneminderCameraName}`);
            if (zoneminderCameraName === '') {
                log('ERROR', `Bad camera name: ${cameraName}`);
                this.response.speak('Sorry, I cannot find that camera name.');
                this.emit(':responseReady');
                return;
            }

            findLatestAlarms(zoneminderCameraName, 1, (err, data) => {
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

                const S3Key = data[0].S3Key;
                const ZmEventDateTime = data[0].ZmEventDateTime;

                // Check if user has a display and if not just return alarm info w/o image.
                if (!supportsDisplay.call(this) && !isSimulator.call(this)) {
                    speechOutput = 'Last alarm from '+cameraName+' was on '+
                        timeConverter(Date.parse(ZmEventDateTime));
                    this.response.speak(speechOutput);
                    this.emit(':responseReady');
                    return;
                }

                log('INFO', `S3 Key of latest alarm image: ${S3Key} from ${ZmEventDateTime}`);

                // Check for valid image.
                if (typeof S3Key === 'undefined') {
                    log('ERROR', 'Bad image file');
                    this.response.speak('Sorry, I cannot complete the request.');
                    this.emit(':responseReady');
                    return;
                }

                const S3Path = 'https://s3-' + configObj.awsRegion +
                    '.amazonaws.com/' + configObj.zmS3Bucket + '/';

                const content = {
                    hasDisplaySpeechOutput: 'Showing most recent alarm from '+cameraName+' camera.',
                    bodyTemplateContent: timeConverter(Date.parse(ZmEventDateTime)),
                    templateToken: 'ShowImage',
                    askOrTell: ':tell',
                    sessionAttributes: this.attributes
                };

                if (USE_IMAGES_FLAG) {
                    content['backgroundImageUrl'] = S3Path + S3Key;
                }

                renderTemplate.call(this, content);

                return;
            });
        }
    },
    // Show a list of recent alarms on the screen for user selection.
    'Alarms': function() {
        log('INFO', `Alarm Events: ${JSON.stringify(this.event)}`);

        // Check if user has a display.
        if (!supportsDisplay.call(this) && !isSimulator.call(this)) {
            speechOutput = 'Sorry, I need a display to do that.';
            this.response.speak(speechOutput);
            this.emit(':responseReady');
            return;
        }

        const cameraName = this.event.request.intent.slots.Location.value;
        log('INFO', `User supplied camera name: ${cameraName}`);

        // Check if user supplied a valid camera name and if so map to zoneminder name.
        const zoneminderCameraName = alexaCameraToZoneminderCamera(cameraName.toLowerCase());
        log('INFO', `ZM camera name: ${zoneminderCameraName}`);
        if (zoneminderCameraName === '') {
            log('ERROR', `Bad camera name: ${cameraName}`);
            this.response.speak('Sorry, I cannot find that camera name.');
            this.emit(':responseReady');
            return;
        }

        findLatestAlarms(zoneminderCameraName, 10, (err, data) => {
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

            let jsonData = {};
            let token = 1;
            listItems = [];
            const S3Path = 'https://s3-' + configObj.awsRegion +
                '.amazonaws.com/' + configObj.zmS3Bucket + '/';

            data.forEach((item) => {
                //log('INFO', `S3Key: ${item.S3Key} ZmEventDateTime: ${item.ZmEventDateTime}`);
                const datetime = timeConverter(Date.parse(item.ZmEventDateTime));
                const imageUrl = S3Path + item.S3Key;
              
                jsonData = {
                    'token': token.toString(),
                    'image': {
                        'contentDescription': cameraName,
                        'sources': [
                            {
                                'url': imageUrl
                            }
                        ]
                    },
                    'textContent': {
                        'primaryText': {
                            'text': datetime,
                            'type': 'PlainText'
                        },
                        'secondaryText': {
                            'text': '',
                            'type': 'PlainText'
                        },
                        'tertiaryText': {
                            'text': '',
                            'type': 'PlainText'
                        }
                    }
                };

                listItems.push(jsonData);

                token++;
            });

            const content = {
                hasDisplaySpeechOutput: 'Showing most recent alarms from '+cameraName,
                templateToken: 'ShowImageList',
                askOrTell: ':ask',
                listItems: listItems,
                hint: 'select number 1',
                title: 'Most recent alarms from '+cameraName+'.',
                sessionAttributes: this.attributes
            };

            /*if (USE_IMAGES_FLAG) {
                content['backgroundImageUrl'] = S3Path + S3Key;
            }*/

            renderTemplate.call(this, content);
        });
    },
    // Handle user selecting an item on the screen by touch.
    'ElementSelected': function() {
        log('INFO', `ElementSelected: ${JSON.stringify(this.event)}`);

        const item = parseInt(this.event.request.token, 10);
        const itemUrl = listItems[item - 1].image.sources[0].url;
        const itemDateTime = listItems[item - 1].textContent.primaryText.text;

        const content = {
            hasDisplaySpeechOutput: 'Showing selected alarm.',
            bodyTemplateContent: itemDateTime,
            backgroundImageUrl: itemUrl,
            templateToken: 'ShowImage',
            askOrTell: ':tell',
            sessionAttributes: this.attributes
        };

        renderTemplate.call(this, content);
    },
    // Handle user selecting an item on the screen by voice.
    'SelectItem': function() {
        log('INFO', `SelectItem: ${JSON.stringify(this.event)}`);

        let item = undefined;

        if (isNaN(this.event.request.intent.slots.number.value)) {
            log('ERROR', `Bad value. ${this.event.request.intent.slots.number.value}`);
            this.response.speak('Sorry, I cannot complete the request.');
            this.emit(':responseReady');
            return;
        } else {
            item = parseInt(this.event.request.intent.slots.number.value, 10);
        }

        const itemUrl = listItems[item - 1].image.sources[0].url;
        const itemDateTime = listItems[item - 1].textContent.primaryText.text;

        const content = {
            hasDisplaySpeechOutput: 'Showing selected alarm.',
            bodyTemplateContent: itemDateTime,
            backgroundImageUrl: itemUrl,
            templateToken: 'ShowImage',
            askOrTell: ':tell',
            sessionAttributes: this.attributes
        };

        renderTemplate.call(this, content);
    },
    // Show video of an alarm.
    //'AMAZON.PlaybackAction<object@VideoCreativeWork>': function() {
    'AlarmClip': function() {
        log('INFO', `AMAZON.PlaybackAction: ${JSON.stringify(this.event)}`);

        //let cameraName = this.event.request.intent.slots['object.name'].value;

        const cameraName = this.event.request.intent.slots.Location.value;
        console.log(cameraName);

        // Check if user supplied a valid camera name and if so map to zoneminder name.
        const zoneminderCameraName = alexaCameraToZoneminderCamera(cameraName.toLowerCase());
        log('INFO', `ZM camera name: ${zoneminderCameraName}`);
        if (zoneminderCameraName === '') {
            log('ERROR', `Bad camera name: ${cameraName}`);
            this.response.speak('Sorry, I cannot find that camera name.');
            this.emit(':responseReady');
            return;
        }

        findLatestAlarms(zoneminderCameraName, 100, (err, data) => {
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
                speechOutput = 'Sorry, I cannot play video on this device';
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

            // Pad clip.
            if (startFrame < 20) {
                startFrame-= startFrame;
            } else {
                startFrame-= 20;
            }

            if (endFrame < 20) {
                endFrame+= endFrame;
            } else {
                endFrame+= 20;
            }

            const ZmEventDateTime = data[0].ZmEventDateTime;
            log('INFO', `Event ID of latest alarm image: ${lastEvent} from ${ZmEventDateTime}`);
            log('INFO', `Start Frame of latest alarm image: ${startFrame} from ${ZmEventDateTime}`);
            log('INFO', `End Frame of latest alarm image: ${endFrame} from ${ZmEventDateTime}`);

            const method   = 'GET';
            const path     = '/cgi/gen-vid.py?event='+lastEvent.toString()+
                             '&start_frame='+startFrame.toString()+'&end_frame='+endFrame.toString();
            const postData = '';
            const text     = true;
            const user     = credsObj.cgiUser;
            const pass     = credsObj.cgiPass;

            httpsReq (method, path, postData, text, user, pass, (err, resStr) => {
                if (err) {
                    console.log('ERROR PlayBack httpsReq: ' + err);
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
                    sessionAttributes: this.attributes
                };

                renderTemplate.call(this, content);
        
            });
        });
    },
    'AMAZON.HelpIntent': function () {
        console.log('Help event: ' + JSON.stringify(this.event));
        if (supportsDisplay.call(this) || isSimulator.call(this)) {
            let content = {
                'hasDisplaySpeechOutput' : welcomeReprompt,
                'title' : 'Help Information.',
                'textContent' : welcomeReprompt,
                'templateToken' : 'SingleItemView',
                'askOrTell': ':ask',
                'sessionAttributes' : this.attributes
            };
            renderTemplate.call(this, content);
        } else {
            this.emit(':ask', welcomeReprompt);
        }
    },
    'AMAZON.CancelIntent': function () {
        console.log('Cancel event: ' + JSON.stringify(this.event));
        speechOutput = 'goodbye';
        this.emit(':tell', speechOutput);
    },
    'AMAZON.StopIntent': function () {
        console.log('Stop event: ' + JSON.stringify(this.event));
        speechOutput = 'goodbye';
        this.emit(':tell', speechOutput);
    },
    'SessionEndedRequest': function () {
        console.log('Session ended event: ' + JSON.stringify(this.event));
        speechOutput = 'goodbye';
        this.emit(':tell', speechOutput);
    },
    'Unhandled': function() {
        console.log('Unhandled event: ' + JSON.stringify(this.event));
        speechOutput = 'goodbye';
        this.emit(':tell', speechOutput);
    },
};

exports.handler = (event, context) => {
    var alexa = Alexa.handler(event, context);
    alexa.appId = APP_ID;
    // To enable string internationalization (i18n) features, set a resources object.
    //alexa.resources = languageStrings;
    alexa.registerHandlers(handlers);
    alexa.execute();
};

//==============================================================================
//===================== Zoneminder Helper Functions  ===========================
//==============================================================================

/**
 * Mapping from Alexa returned camera names to zoneminder camera names.
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
 * Callback for latest alarms.
 *
 * @callback latestAlarmCallback
 * @param {string} err - An error message.
 * @param {array} truePositiveAlarms - An array holding true pos alarms.
 * 
 */

/**
 * Find most recent true positive alarm frames for a given camera name.
 * 
 * @param {string} cameraName - Zone minder monitor name.
 * @param {int} nuberofAlarms - Number of alarm frames to find.
 * @param {latestAlarmCallback} callback - A callback fn.
 */
function findLatestAlarms(cameraName, numberOfAlarams, callback) {
    const docClient = new AWS.DynamoDB.DocumentClient(
        {apiVersion: '2012-10-08', region: configObj.awsRegion}
    );

    let params = {
        TableName: 'ZmAlarmFrames',
        ScanIndexForward: false, // Descending sort order.
        ProjectionExpression: 'ZmEventDateTime, S3Key, ZmEventId, ZmFrameId',
        KeyConditionExpression: 'ZmCameraName = :name',
        FilterExpression: 'Alert = :state',
        ExpressionAttributeValues: {
            ':name': cameraName,
            ':state': 'true'
        }
    };

    let truePositiveAlarms = [];
    let truePositiveAlarmCount = 0;
                    
    function queryExecute() {
        docClient.query(params, (err, data) => {
            if (err) {
                return callback(err, null);
            }
      
            // Look for true positive alarms (Alert = true).
            for (const item of data.Items) {
                truePositiveAlarms.push(item);
                truePositiveAlarmCount++;
                if (truePositiveAlarmCount === numberOfAlarams) {
                    return callback(null, truePositiveAlarms);
                }
            }

            // Query again if there are more records else return what was found so far (if anything).
            if (data.LastEvaluatedKey) {
                params.ExclusiveStartKey = data.LastEvaluatedKey;
                queryExecute();
            } else {
                return callback(null, truePositiveAlarms);
            }
        });
    }    
                    
    queryExecute();
}

//==============================================================================
//==================== Alexa Delegate Helper Functions  ========================
//==============================================================================
function delegateToAlexa() {
    //console.log("in delegateToAlexa");
    //console.log("current dialogState: "+ this.event.request.dialogState);

    if (this.event.request.dialogState === 'STARTED') {
        //console.log("in dialog state STARTED");
        var updatedIntent = this.event.request.intent;
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

//==============================================================================
//============================ S3 Helper Functions  ============================
//==============================================================================
var AWS = require('aws-sdk');
var s3 = new AWS.S3();

// Get file from S3
function getS3File(bucketName, fileName, versionId, callback) {
    var params = {
        Bucket: bucketName,
        Key: fileName
    };
    if (versionId) {
        params.VersionId = versionId;
    }
    s3.getObject(params, function (err, data) {
        callback(err, data);
    });
}

// Put file into S3
function putS3File(bucketName, fileName, data, callback) {
    var expirationDate = new Date();
    // Assuming a user would not remain active in the same session for over 1 hr.
    expirationDate = new Date(expirationDate.setHours(expirationDate.getHours() + 1));
    var params = {
        Bucket: bucketName,
        Key: fileName,
        Body: data,
        ACL: 'public-read', // TODO: find way to restrict access to this lambda function
        Expires: expirationDate
    };
    s3.putObject(params, function (err, data) {
        callback(err, data);
    });
}

// Upload object to S3
function uploadS3File(bucketName, fileName, data, callback) {
    var params = {
        Bucket: bucketName,
        Key: fileName,
        Body: data,
        ACL: 'public-read', // TODO: find way to restrict access to this lambda function
    };
    s3.upload(params, function(err, data) {
        callback(err, data);
    });
}

//==============================================================================
//===================== Echo Show Helper Functions  ============================
//==============================================================================
function supportsDisplay() {
    var hasDisplay =
    this.event.context &&
    this.event.context.System &&
    this.event.context.System.device &&
    this.event.context.System.device.supportedInterfaces &&
    this.event.context.System.device.supportedInterfaces.Display;

    return hasDisplay;
}

function isSimulator() {
    var isSimulator = !this.event.context; //simulator doesn't send context
    return false;
}

function renderTemplate (content) {
    console.log('renderTemplate' + content.templateToken);

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
                'reprompt': {
                    'outputSpeech': {
                        'type': 'SSML',
                        'ssml': ''
                    }
                },
                'card': null,
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
                        'backButton': 'HIDDEN',
                        'template': {
                            'type': 'ListTemplate2',
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
                        'ssml': ''
                    }
                },
                'shouldEndSession': content.askOrTell === ':tell'
            },
            'sessionAttributes': content.sessionAttributes
        };

        if(content.backgroundImageUrl) {
            // When we have images, create a sources object.

            let sources = [
                {
                    'size': 'SMALL',
                    'url': content.backgroundImageUrl
                },
                {
                    'size': 'LARGE',
                    'url': content.backgroundImageUrl
                }
            ];

                // Add the image sources object to the response.
            response['response']['directives'][0]['template']['backgroundImage'] = {};
            response['response']['directives'][0]['template']['backgroundImage']['sources'] = sources;
        }

        // Send the response to Alexa.
        this.context.succeed(response);
        break;
    case 'ShowImage':
        //  "hasDisplaySpeechOutput" : response + " " + EXIT_SKILL_MESSAGE,
        //  "bodyTemplateContent" : getFinalScore(this.attributes["quizscore"], this.attributes["counter"]),
        //  "templateToken" : "FinalScoreView",
        //  "askOrTell": ":tell",
        //  "hint":"start a quiz",
        //  "sessionAttributes" : this.attributes
        //  "backgroundImageUrl"
        response = {
            'version': '1.0',
            'response': {
                'directives': [
                    {
                        'type': 'Display.RenderTemplate',
                        'backButton': 'HIDDEN',
                        'template': {
                            'type': 'BodyTemplate6',
                            //"title": content.title,
                            'token': content.templateToken,
                            'textContent': {
                                'primaryText': {
                                    'type': 'RichText',
                                    'text': '<font size = \'3\'>'+content.bodyTemplateContent+'</font>'
                                }
                            }
                        }
                    },{
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
                        'ssml': ''
                    }
                },
                'shouldEndSession': content.askOrTell== ':tell',

            },
            'sessionAttributes': content.sessionAttributes

        };

        if(content.backgroundImageUrl) {
            //when we have images, create a sources object

            let sources = [
                {
                    'size': 'SMALL',
                    'url': content.backgroundImageUrl
                },
                {
                    'size': 'LARGE',
                    'url': content.backgroundImageUrl
                }
            ];
            //add the image sources object to the response
            response['response']['directives'][0]['template']['backgroundImage']={};
            response['response']['directives'][0]['template']['backgroundImage']['sources']=sources;
        }



        //Send the response to Alexa
        this.context.succeed(response);
        break;

    case 'ItemDetailsView':
        response = {
            'version': '1.0',
            'response': {
                'directives': [
                    {
                        'type': 'Display.RenderTemplate',
                        'template': {
                            'type': 'BodyTemplate3',
                            'title': content.bodyTemplateTitle,
                            'token': content.templateToken,
                            'textContent': {
                                'primaryText': {
                                    'type': 'RichText',
                                    'text': '<font size = \'5\'>'+content.bodyTemplateContent+'</font>'
                                }
                            },
                            'backButton': 'HIDDEN'
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
                'shouldEndSession': content.askOrTell== ':tell',
                'card': {
                    'type': 'Simple',
                    'title': content.simpleCardTitle,
                    'content': content.simpleCardContent
                }
            },
            'sessionAttributes': content.sessionAttributes

        };

        if(content.imageSmallUrl && content.imageLargeUrl) {
            //when we have images, create a sources object
            //TODO switch template to one without picture?
            let sources = [
                {
                    'size': 'SMALL',
                    'url': content.imageSmallUrl
                },
                {
                    'size': 'LARGE',
                    'url': content.imageLargeUrl
                }
            ];
            //add the image sources object to the response
            response['response']['directives'][0]['template']['image']={};
            response['response']['directives'][0]['template']['image']['sources']=sources;
        }
        //Send the response to Alexa
        console.log('ready to respond (ItemDetailsView): '+JSON.stringify(response));
        this.context.succeed(response);
        break;
    case 'MultipleChoiceListView':
        console.log ('listItems '+JSON.stringify(content.listItems));
        response = {
            'version': '1.0',
            'response': {
                'directives': [
                    {
                        'type': 'Display.RenderTemplate',
                        'template': {
                            'type': 'ListTemplate1',
                            'title': content.listTemplateTitle,
                            'token': content.templateToken,
                            'listItems':content.listItems,
                            'backgroundImage': {
                                'sources': [
                                    {
                                        'size': 'SMALL',
                                        'url': content.backgroundImageSmallUrl
                                    },
                                    {
                                        'size': 'LARGE',
                                        'url': content.backgroundImageLargeUrl
                                    }
                                ]
                            },
                            'backButton': 'HIDDEN'
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
                'shouldEndSession': content.askOrTell== ':tell',
                'card': {
                    'type': 'Simple',
                    'title': content.simpleCardTitle,
                    'content': content.simpleCardContent
                }
            },
            'sessionAttributes': content.sessionAttributes

        };

        if(content.backgroundImageLargeUrl) {
            //when we have images, create a sources object
            //TODO switch template to one without picture?
            let sources = [
                {
                    'size': 'SMALL',
                    'url': content.backgroundImageLargeUrl
                },
                {
                    'size': 'LARGE',
                    'url': content.backgroundImageLargeUrl
                }
            ];
            //add the image sources object to the response
            response['response']['directives'][0]['template']['backgroundImage']={};
            response['response']['directives'][0]['template']['backgroundImage']['sources']=sources;
        }
        console.log('ready to respond (MultipleChoiceList): '+JSON.stringify(response));
        this.context.succeed(response);
        break;
    case 'SingleItemView':
        response = {
            'version': '1.0',
            'response': {
                'directives': [
                    {
                        'type': 'Display.RenderTemplate',
                        'template': {
                            'type': 'BodyTemplate1',
                            'title': content.title,
                            'token': content.templateToken,
                            'textContent': {
                                'primaryText': {
                                    'type': 'RichText',
                                    'text': '<font size = \'7\'>'+content.textContent+'</font>'
                                }
                            },
                            'backButton': 'HIDDEN'
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
                        'ssml': ''
                    }
                },
                'shouldEndSession': content.askOrTell== ':tell',
            },
            'sessionAttributes': content.sessionAttributes
        };
        console.log('ready to respond (SingleItemView): '+JSON.stringify(response));
        this.context.succeed(response);
        break;
    default:
        this.response.speak('Thanks for playing, goodbye');
        this.emit(':responseReady');
    }

}

//==============================================================================
//======================== Misc Helper Functions  ==============================
//==============================================================================
/*
 *
 */
var httpsReq = (method, path, postData, text, user, pass, callback) => {
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

    /*var CERT = fs.readFileSync('./certs/client.crt'),
        KEY  = fs.readFileSync('./certs/client.key'),
        CA   = fs.readFileSync('./certs/ca.crt');*/

    var https = require('https'),
        Stream = require('stream').Transform,
        zlib = require('zlib');

    var options = {
        hostname: HOST,
        port: PORT,
        path: path,
        method: method,
        //rejectUnauthorized: true,
        //rejectUnauthorized: false,
        //key: KEY,
        //cert: CERT,
        //ca: CA,
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

    var req = https.request(options, (result) => {
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

            //callback(data.read());
        });
    });

    // Set timeout on socket inactivity. 
    req.on('socket', function (socket) {
        socket.setTimeout(20000); // 20 sec timeout. 
        socket.on('timeout', function() {
            req.abort();
        });
    });

    req.write(postData);

    req.end();

    req.on('error', (e) => {
        console.log('ERROR https request: ' + e.message);
        callback(e.message, null);
    });
};

/*
 * Converts Unix timestamp (in Zulu) in ms to human understandable date and time of day.
 */
function timeConverter(unix_timestamp) {
    //const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    // tzDiff = 8 * 60 * 60 * 1000 - Pacific time is 8 hours behind UTC (daylight savings).
    //const tzDiff = 28800000;
    // tzOiff = 7 * 60 * 60 * 1000. // standard time.
    // TODO: make this conversion more robust.
    const tzDiff = 25200000;
    // Create a new JavaScript Date object based on the timestamp.
    // Multiplied by 1000 so that the argument is in milliseconds, not seconds.
    let date = new Date(unix_timestamp - tzDiff);
    let year = date.getFullYear();
    //var month = months[date.getMonth()];
    let month = date.getMonth() + 1;
    let day = date.getDate();
    let hours = date.getHours();
    let minutes = '0' + date.getMinutes();
    let seconds = '0' + date.getSeconds();

    // Will display time in M D HH:MM format
    //var formattedTime = month + " " + day + " " + hours + ":" + minutes.substr(-2);
    // Will display in 2013-10-04 22:23:00 format
    let formattedTime = year+'-'+month+'-'+day+' '+hours+':'+minutes.substr(-2)+':'+seconds.substr(-2);
    return formattedTime;
}

/*
 * Parse ISO8501 duration string.
 * See https://stackoverflow.com/questions/27851832/how-do-i-parse-an-iso-8601-formatted-duration-using-moment-js
 *
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

/*
 * Checks for valid JSON and parses it. 
 */
function safelyParseJSON(json) {
    try {
        return JSON.parse(json);
    } catch (e) {
        log('ERROR', `JSON parse error: ${e}`);
        return null;
    }
}

/*
 *
 */
function randomPhrase(array) {
    // the argument is an array [] of words or phrases
    var i = 0;
    i = Math.floor(Math.random() * array.length);
    return(array[i]);
}

/*
 *
 */
function isSlotValid(request, slotName){
    var slot = request.intent.slots[slotName];
    //console.log("request = "+JSON.stringify(request)); //uncomment if you want to see the request
    var slotValue;

    //if we have a slot, get the text and store it into speechOutput
    if (slot && slot.value) {
        //we have a value in the slot
        slotValue = slot.value.toLowerCase();
        return slotValue;
    } else {
        //we didn't get a value in the slot.
        return false;
    }
}

/*
 * Logger using Template Literals.
 * See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals.
 */
function log(title, msg) {
    console.log(`[${title}] ${msg}`);
}

/*
 * Debug - inspect and log object content.
 *
 */
function inspectLogObj(obj, depth = null) {
    const util = require('util');
    console.log(util.inspect(obj, {depth: depth}));
}

/*
 * Checks if a file is a jpeg image.
 * https://stackoverflow.com/questions/8473703/in-node-js-given-a-url-how-do-i-check-whether-its-a-jpg-png-gif/8475542#8475542
 */
function isJpg(file) {
    const jpgMagicNum = 'ffd8ffe0';
    var magicNumInFile = file.toString('hex',0,4);
    //console.log("magicNumInFile: " + magicNumInFile);
  
    if (magicNumInFile === jpgMagicNum) {
        return true;
    } else {
        return false;
    }
}