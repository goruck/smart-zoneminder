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

### Environment Variables

The variable STEP_MACHINE_ARN needs to be declared and defined in the Lambda Function console.  This should point to the ARN of your Step Function. 

### Upload to AWS

1. Using the [AWS Lambda Console](https://aws.amazon.com/lambda), create a new Lambda Function, using the "blank function" blueprint.
2. Create a trigger for your s3 bucket with the event type "Object Create (All)" and the prefix "upload/".  This will ensure that this function is run for each new item uploaded to the "upload" directory of your s3 bucket.
3. Once the trigger has been specified you can copy the code from s3-trigger-image-processing.js directly into the inline code editor.
4. Ensure that the function uses your newly created IAM Role.