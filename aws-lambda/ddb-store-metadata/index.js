exports.handler = (event, context, callback) => {

    //
    // Writes image metadata to DynamoDB.
    // Normally the last processing step. 
    //

    var AWS = require('aws-sdk');

    // Create the DynamoDB service object
    var documentClient = new AWS.DynamoDB.DocumentClient(
                             {apiVersion: '2012-10-08',
                             region: process.env.AWS_REGION});
    
    // Retrieve parameters from export handler event
    //var bucket = event.bucket;
    //var filename = event.key;
    var S3Key = event.newFilename;
    var S3DateTime = event.newFilenameDate;
    var alert = event.Alert;
    var labels = event.Labels;
    
    try {
        // Make an array of strings from S3Key...
        var split1 = S3Key.split('/');
        // 1st element contains 'archive' (not used).
        // 2nd element contains 'alerts' or 'falsepositives' (not used).
        // 3rd element contains camera name.
        var zmCameraName = split1[2];
        // 4th element contains event date.
        var eventDateStr = split1[3];
        // Then parse into items for ddb.
        var eventDateArr = eventDateStr.split('-');
        var zmEventYear  = eventDateArr[0];
        var zmEventMonth = eventDateArr[1];
        var zmEventDay   = eventDateArr[2];
        // 5th element contains event hour (not used).
        // 6th element contains event, frame and time info of alarm.
        var alarmInfoStr = split1[5];
        // Then parse into items for ddb.
        var alarmInfoArr = alarmInfoStr.split('-');
        var zmEventName  = alarmInfoArr[0];
        var zmEventId    = alarmInfoArr[1].replace(/\D/g, '');
        var zmFrameId    = alarmInfoArr[2].replace(/\D/g, '');
        var zmEventHour  = alarmInfoArr[3];
        var zmEventMin   = alarmInfoArr[4];
        var zmEventSec   = alarmInfoArr[5];
        var zmEventmSec  = alarmInfoArr[6].replace('.jpg', '');
    }
    catch(err) {
        var errorMessage =  'Error in [ddb-store-metadata S3Key parse].\r' + 
                            '   Function input ['+JSON.stringify(event, null, 2)+'].\r' +  
                            '   Error ['+err+'].';
        console.log(errorMessage);
        callback(err, null);
    }
    
    var tempDateTime = new Date(zmEventYear, (zmEventMonth - 1), zmEventDay,
                                zmEventHour, zmEventMin, zmEventSec, zmEventmSec);
                                
    //console.log('temp ts: '+tempDateTime);
                        
    // tzOffset = 8 * 60 * 60 * 1000.
    // Assumes daylight savings time.
    // TODO: make this conversion more robust.
    var tzOffset = 28800000;
    
    var zmEventDateTime = new Date(tempDateTime.getTime() + tzOffset);
                                    
    //console.log('TS: '+zmEventDateTime);
    
    // Paramaters for DynamoDB.
    var params = {
        TableName: 'ZmAlarmFrames',
        Item: {
            'ZmCameraName'    : zmCameraName,
            'ZmEventDateTime' : zmEventDateTime.toISOString(),
            'ZmEventName'     : zmEventName,
            'ZmEventId'       : parseInt(zmEventId, 10),
            'ZmFrameId'       : parseInt(zmFrameId, 10),
            'S3Key'           : S3Key,
            'S3DateTime'      : S3DateTime,
            //'Alert'           : alert, // Step saves only Alert = true.
            'Labels'          : labels
        }
    };

    // Call DynamoDB to add the item to the table
    documentClient.put(params, function(err, data) {
        if (err) {
            var errorMessage =  'Error in [ddb-store-metadata ddb put].\r' + 
                                '   Function input ['+JSON.stringify(event, null, 2)+'].\r' +  
                                '   Error ['+err+'].';
              
            console.log(errorMessage);
        
            callback(err, null);
        } else {
            console.log('Successful storing [' + S3Key + '] metadata');
            
            callback(null, 'Successful storing [' + S3Key + '] metadata');
        }
    });
};
