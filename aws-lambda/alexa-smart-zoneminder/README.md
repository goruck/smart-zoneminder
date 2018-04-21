# alexa-smart-zoneminder
AWS Lambda function that implements an Alexa skill handler for smart-zoneminder.

## Contents
1. **index.js** - source code.
2. **config.json** - main configuration file.
3. **mkzip** - script to zip files for uploading to AWS Lambda.
4. **package.json** - npm package file.

## How to use

### IAM Role

Using the [AWS IAM Console](https://aws.amazon.com/console/) create an IAM Role containing the "AmazonS3FullAccess", "DynamoDBFullAccess" and "AWSLambdaBasicExecutionRole" permissions.

### Installation
1. Clone this git repo to local machine running smart-zoneminder and cd to it. 
2. Run ```npm install``` to fetch dependencies.
3. Modify config.json per your ZoneMinder installation.
4. Create a file called creds.json with the following content modified to match your installation.
```json
{
    "alexaAppId": "AlexaSkillARN",
    "host": "ApacheServerURI",
    "port": "ApacheServerPort",
    "cgiUser": "UserNameForCGIAccess",
    "cgiPass": "PasswordForCGIAccess",
    "alarmVideoPath": "URIToAlarmClipVideo"
}
```
5. Run ```mkzip``` to zip up contents to prep for upload to AWS. 

### Upload to AWS

Using the [AWS Lambda Console](https://aws.amazon.com/lambda), create a new Lambda Function called *s3-archive-image* and upload the zip file created above.

Ensure that the function uses your newly created IAM Role.

Tip: Use the "blank function" blueprint and skip the "configure triggers" prompt when creating the function.
