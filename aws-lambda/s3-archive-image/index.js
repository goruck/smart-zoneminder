'use strict';

exports.handler = (event, context, callback) => {

    //
    // Moves processed files from upload to archive directory.
    //

    const AWS = require('aws-sdk');
    const s3 = new AWS.S3({apiVersion: '2006-03-01', region: process.env.AWS_REGION});
    
    // Retrieve parameters from export handler event
    const bucket = event.bucket;
    const oldFilename = event.key;
    const alert = event.Alert;
    const storageClass = event.storageClass;

    // "New file" retains same name, just the path is changed from upload to archive
    let newFilename = '';
    
    // In which subdirectory shall the file be saved?
    if (alert == 'true'){
        newFilename = event.key.replace('upload/', 'archive/alerts/');          // All Alerts
    } else {
        newFilename = event.key.replace('upload/', 'archive/falsepositives/');  // False positives
    }
    
    // Parameters for copy function
    const archiveParams = {
        Bucket: bucket,
        CopySource: bucket + '/' + oldFilename,
        Key: newFilename,
        StorageClass: storageClass
    };
    
    // Parameters for delete function
    const deleteParams = {
        Bucket: bucket,
        Key: oldFilename,
    };
    
    // Moving requires first a copy...
    s3.copyObject(archiveParams, (err, copyObjectData) => {
        if (err) {
            const errorMessage =  'Error in in [s3-archive-image].\r' + 
                                '   Error copying [' + oldFilename + '] to [' + newFilename + '] in bucket ['+bucket+'].\r' +  
                                '   Function input ['+JSON.stringify(event, null, 2)+'].\r' +  
                                '   Error ['+err+'].';
            console.log(errorMessage);
            callback(err, null);
        } if (copyObjectData) {
            const objDate = copyObjectData.CopyObjectResult.LastModified.toISOString();
            // ...followed by a delete   
            s3.deleteObject(deleteParams, (err, data) => {
                if (err) {
                    const errorMessage =  'Error in in [s3-archive-image].\r' + 
                                '   Error deleting [' + oldFilename +'] from bucket ['+bucket+'].\r' + 
                                '   Function input ['+JSON.stringify(event, null, 2)+'].\r' +  
                                '   Error ['+err+'].';
                    console.log(errorMessage);
                    callback(err, null);
                } else {
                    console.log('Successful archiving [' + newFilename + '] on ' + objDate);
                    const newObj = {
                        newFilename : newFilename,
                        newFilenameDate: objDate
                    };
                    callback(null, Object.assign(newObj, event));
                }
            });
        }
    });
};