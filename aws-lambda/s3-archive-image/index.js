exports.handler = (event, context, callback) => {

    //
    // Moves processed files from upload to archive directory.
    //

    var AWS = require('aws-sdk');
    var s3 = new AWS.S3({apiVersion: '2006-03-01', region: process.env.AWS_REGION});
    
    // Retrieve parameters from export handler event
    var bucket = event.bucket;
    var oldFilename = event.key;
    var alert = event.Alert;

    // "New file" retains same name, just the path is changed from upload to archive
    var newFilename = '';
    
    // In which subdirectory shall the file be saved?
    if (alert == 'true'){
        newFilename = event.key.replace('upload/', 'archive/alerts/');          // All Alerts
    }else{
        newFilename = event.key.replace('upload/', 'archive/falsepositives/');  // False positives
    }
    
    // Parameters for copy function
    var archiveParams = {
       Bucket: bucket,
       CopySource: bucket+'/' + oldFilename,
       Key: newFilename,
    };
    
    // Parameters for delete function
    var deleteParams = {
       Bucket: bucket,
       Key: oldFilename,
    };
    
    // Moving requires first a copy...
    s3.copyObject(archiveParams, function(err, copyObjectData) {
      if (err) {
        var errorMessage =  'Error in in [s3-archive-image].\r' + 
                                '   Error copying [' + oldFilename + '] to [' + newFilename + '] in bucket ['+bucket+'].\r' +  
                                '   Function input ['+JSON.stringify(event, null, 2)+'].\r' +  
                                '   Error ['+err+'].';
              
        console.log(errorMessage);
        
        callback(err, null);
      } if (copyObjectData) {
        
        var objDate = copyObjectData.CopyObjectResult.LastModified.toISOString();
          
        // ...followed by a delete   
        s3.deleteObject(deleteParams, function(err, data){
          if (err) {
            var errorMessage =  'Error in in [s3-archive-image].\r' + 
                                '   Error deleting [' + oldFilename +'] from bucket ['+bucket+'].\r' + 
                                '   Function input ['+JSON.stringify(event, null, 2)+'].\r' +  
                                '   Error ['+err+'].';
              
            console.log(errorMessage);
            
            callback(err, null);
          } else {
            console.log('Successful archiving [' + newFilename + '] on ' + objDate);
            //callback(null, 'Successful archiving [' + newFilename + ']');
            var newObj = {
                newFilename : newFilename,
                newFilenameDate: objDate
            }
            callback(null, Object.assign(newObj, event));
          }
        });
      }
    });
};
