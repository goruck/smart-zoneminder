# rekognition-evaluate-labels

This directory contains an AWS Lamdba Function that evaluates whether or not the image contains a person.

Based on and inspired by [smart-security-camera](https://github.com/markwest1972/smart-security-camera).

## Contents

1. **index.js** - source code.

## How to use

### IAM Role

Using the [AWS IAM Console](https://aws.amazon.com/console/) create an IAM Role containing the "AWSLambdaBasicExecutionRole" permission. 

### Upload to AWS

Using the [AWS Lambda Console](https://aws.amazon.com/lambda), create a new Lambda Function called *rekognition-evaluate-labels* and copy the code from index.js directly into the inline code editor.

Ensure that the function uses your newly created IAM Role.

Tip: Use the "blank function" blueprint and skip the "configure triggers" prompt when creating the function.
