# s3-archive-image

Archives files after successfull processing (moves them from "upload" to the relevant "archive" subdirectory in s3).

## Contents

1. **index.js** - source code.

## How to use

### IAM Role

Using the [AWS IAM Console](https://aws.amazon.com/console/) create an IAM Role containing the "AmazonS3FullAccess" and "AWSLambdaBasicExecutionRole" permissions. 

### Upload to AWS

Using the [AWS Lambda Console](https://aws.amazon.com/lambda), create a new Lambda Function called *s3-archive-image* and copy the code from index.js directly into the inline code editor.

Ensure that the function uses your newly created IAM Role.

Tip: Use the "blank function" blueprint and skip the "configure triggers" prompt when creating the function.
