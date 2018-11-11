# s3-trigger-image-processing

Monitors the s3 buckets "upload" directory for new image files and triggers their processing by calling the [step function](https://github.com/goruck/smart-zoneminder/tree/master/aws-step-function).

Based on and inspired by [smart-security-camera](https://github.com/markwest1972/smart-security-camera).

## Contents

1. **index.js** - source code.

## How to use

### IAM Role

1. Using the [AWS IAM Console](https://aws.amazon.com/console/) create an IAM Role containing the "AWSLambdaBasicExecutionRole" and "AmazonS3FullAccess" permissions. 
2. Using the [AWS IAM Console](https://aws.amazon.com/console/) you also need to manually add an inline policy to your new created IAM Role, giving permission to run Step Functions:
```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "states:StartExecution"
            ],
            "Resource": [
                "*"
            ]
        }
    ]
}
```

### Create and Configure the AWS Lambda Function

1. Using the [AWS Lambda Console](https://aws.amazon.com/lambda), using the "blank function" blueprint create a new Lambda Function called *s3-trigger-image-processing*.
2. Create a trigger for your s3 bucket with the event type "Object Create (All)" and the prefix "upload/".  This will ensure that this function is run for each new item uploaded to the "upload" directory of your s3 bucket.
3. Copy the code from s3-trigger-image-processing.js directly into the inline code editor.
4. Ensure that the function uses your newly created IAM Role.
5. Create an Environment Variable called *STEP_MACHINE_ARN* and set the value of it to the ARN of your Step Function.