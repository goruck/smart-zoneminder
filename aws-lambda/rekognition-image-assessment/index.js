exports.handler = (event, context, callback) => {
    
    //
    // Submits image from s3 bucket to Rekognition detectLabels function.
    //
    
    // Get image details from event object
    var bucket = event.bucket; 
    var filename = event.key; 
    
    console.log('Bucket ['+bucket+'], Key ['+ filename+']');
    
    // Setup Rekognition client
    var AWS = require('aws-sdk');
    var rekognition = new AWS.Rekognition({apiVersion: '2016-06-27', region: process.env.AWS_REGION});
    
    // Configure Rekognition client parameters, including image name 
    // and location, maximum amount of results, and minimum confidence level
    var params = {
        Image: {
            S3Object: {Bucket: bucket, Name: filename }},
        MaxLabels: 100,
        MinConfidence: 50.0
    };
    
    // Call detectLabels
    var request = rekognition.detectLabels(params, function(err, data) {
        if(err){
            var errorMessage =  'Error in [rekognition-image-assessment].\r' + 
                                '   Function input ['+JSON.stringify(event, null, 2)+'].\r' +  
                                '   Error ['+err+'].';
            // Log error
            console.log(errorMessage);
            
            callback(err, null);
        }
        else{
            console.log('Retrieved Labels ['+JSON.stringify(data)+']');
            
            // Return labels as a JavaScript object that can be passed into the 
            // subsequent lambda function.
            callback(null, Object.assign(data, event));
        }
    });
};
