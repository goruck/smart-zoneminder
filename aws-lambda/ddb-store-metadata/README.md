# ddb-store-metadata

The AWS Lambda function in the ddb-store-metadata folder stores metadata about the alarm frames that were archived by s3-archive-image into a DynamoDB table.

## Contents

1. **index.js** - source code.

## How to use

### IAM Role

Using the [AWS IAM Console](https://aws.amazon.com/console/) create an IAM Role containing the "DynamoDBFullAccess" and "AWSLambdaBasicExecutionRole" permissions. 

### Upload to AWS

Using the [AWS Lambda Console](https://aws.amazon.com/lambda), create a new Lambda Function called *ddb-store-metadata* and copy the code from index.js directly into the inline code editor.

Ensure that the function uses your newly created IAM Role.

Tip: Use the "blank function" blueprint and skip the "configure triggers" prompt when creating the function.
