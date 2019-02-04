'use strict';

exports.handler = (event, context) => {
   
    //
    // Activated by upload of new images to s3 bucket.  Kicks off step function that will process images.
    //
   
    const AWS = require('aws-sdk');
    const s3 = new AWS.S3({apiVersion: '2006-03-01', region: process.env.AWS_REGION});
   
    // Derive the bucket, key and storage class from the event.
    const bucket = event.Records[0].s3.bucket.name;
    const key = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, ' '));
 
    // Get the image (and validate that an object is there).
    s3.getObject({Bucket: bucket, Key: key}, (err, data) => {
        if (err) {
            console.log(err);
            const message = `Error getting object ${key} from bucket ${bucket}.
                Make sure they exist and your bucket is in the same region as this function.`;
            console.log(message);
        } else {
            console.log(`New file uploaded - bucket: ${bucket} key: ${key}`);

            let stepFnInput = {
                bucket: bucket.toString(),
                key: key.toString(),
                storageClass: data.StorageClass.toString(),
                metadata: data.Metadata
            };

            // Check for an alert in the S3 object metadata which means local obj recognition was used. 
            if (data.Metadata.alert !== undefined) {
                stepFnInput.Alert = data.Metadata.alert;
                stepFnInput.Labels = JSON.parse(data.Metadata.labels);
                stepFnInput.local = true;
            } else {
                stepFnInput.local = false;
            }
     
            // Setup the parameters for triggering the step function.
            const params = {
                stateMachineArn: process.env.STEP_MACHINE_ARN,
                input: JSON.stringify(stepFnInput)
            };
  
            // Instantiate and run the step function.
            const stepfunctions = new AWS.StepFunctions();
     
            stepfunctions.startExecution(params, (err, data) => {
                if (err) console.log(err, err.stack); // an error occurred
                else     console.log(data);           // successful response
            });
        }
    });
};
