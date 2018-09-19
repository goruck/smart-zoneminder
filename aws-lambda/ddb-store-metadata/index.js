exports.handler = (event, context, callback) => {
    //
    // Writes image metadata to DynamoDB.
    // Normally the last processing step. 
    //

    const AWS = require('aws-sdk');

    // Create the DynamoDB service object
    const documentClient = new AWS.DynamoDB.DocumentClient(
        {apiVersion: '2012-10-08', region: process.env.AWS_REGION});
    
    // Retrieve parameters from export handler event
    const S3Key = event.newFilename;
    const S3DateTime = event.newFilenameDate;
    const alertState = event.Alert;
    const labels = event.Labels;
    const zmCameraName = event.metadata.zmmonitorname;
    const zmEventDateTime = event.metadata.zmframedatetime;
    const zmEventName = event.metadata.zmeventname;
    const zmEventId = event.metadata.zmeventid;
    const zmFrameId = event.metadata.zmframeid;
    const zmScore = event.metadata.zmscore;
    const zmLocalEventPath = event.metadata.zmlocaleventpath;
    
    // Parameters for DynamoDB.
    const params = {
        TableName: 'ZmAlarmFrames',
        Item: {
            'ZmCameraName'    : zmCameraName,
            'ZmEventDateTime' : zmEventDateTime,
            'ZmEventName'     : zmEventName,
            'ZmEventId'       : parseInt(zmEventId, 10),
            'ZmFrameId'       : parseInt(zmFrameId, 10),
            'ZmScore'         : parseInt(zmScore, 10),
            'ZmLocalEventPath': zmLocalEventPath,
            'S3Key'           : S3Key,
            'S3DateTime'      : S3DateTime,
            'Alert'           : alertState,
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
