# nodemailer-send-notification
AWS Lambda function to email alarm frames if person in image matches the env var FIND_FACE.

## Contents
1. **index.js** - source code.
2. **mkzip.sh** - script to zip files for uploading to AWS Lambda.
3. **package.json** - npm package file.

## How to use

### IAM Role
Using the [AWS IAM Console](https://aws.amazon.com/console/) create an IAM Role containing the "AmazonS3FullAccess", "AmazonSESFullAccess " and "AWSLambdaBasicExecutionRole" permissions.

### Installation
1. Clone this git repo to local machine running smart-zoneminder and cd to it. 
2. Run ```npm install``` to fetch dependencies.
3. Run ```mkzip.sh``` to zip up contents to prep for upload to AWS. 

### Upload to AWS and Configure Lambda Function
1. Using the [AWS Lambda Console](https://aws.amazon.com/lambda), create a new Lambda Function called *nodemailer-send-notification*.
2. Upload the zip file created above.
3. Ensure that the function's Execution role uses the IAM Role created above.
4. Set the function's Reserve Concurrency to 1. This will allow only one instance of this function to run at a time so that a single alarm image will be emailed to the user.
5. Create and set the following function Environment variables to suit your needs: *EMAIL_FROM*, *EMAIL_RECIPIENT*, *FIND_FACE*. The values for *FIND_FACE* must match a name you trained the face detector with, see [face-det-rec](../../face-det-rec/README.md) or set the value to "Unknown" to email images of strangers.

Tip: Use the "blank function" blueprint and skip the "configure triggers" prompt when creating the function.
