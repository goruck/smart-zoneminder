*This entire project (including the Readme) is under construction.*

# smart-zoneminder
smart-zoneminder enables fast upload of ZoneMinder alarm frame images to an S3 archive where they are analyzed by AWS Rekognition and made accessible by voice via Alexa. The use of Rekognition dramatically reduces the number of false alarms and provides for robust scene, object and face detection. Alexa allows a user to ask to see an image or a video corresponding to an alarm (if using an Echo device with a display) and to get information on what caused the alarm and when it occurred.

# Usage Examples
Hera are a few of the things you can do with smart-zoneminder.

**Note: smart-zoneminder currently does not support live streaming of camera feeds.** I recommend that you use [alexa-ip-cam](https://github.com/goruck/alexa-ip-cam) for streaming your cameras feeds live on Echo devices. 

## Ask Alexa to show an alarm from a camera on a specific date and time
Note that if the user does not provide a date then the most recent alarm will be shown.

User: "Alexa, ask zone minder to show alarm from front porch"

Alexa: "Showing last alarm from front porch camera"

![Alt text](/img/last-alarm-by-camera-name.jpg?raw=true "last alarm from camera example.")

## Ask Alexa to show last N alarms from a specific camera on a specific date and time
Note that if user does not give the number of alarms to show the skill will default to showing the last ten around that date and if date is ommited the most recent alarms will be returned.

User: "Alexa, ask zone minder to show alarms from front porch"

Alexa: "Showing last alarms from front porch camera"

![Alt text](/img/last-alarms-example.jpg?raw=true "last alarms from camera example.")

## Ask Alexa to show the last alarm from from any camera

User: "Alexa, ask zone minder to show alarm"

Alexa: "Showing last alarm from play room door camera"

Result: Image of last alarm frame from this camera will be displayed on an Echo device with a screen or user will hear about the alarm from Alexa on devices without a screen.

## Ask Alexa to play a video of an alarm from a camera on a specific date and time.
Note that if the user does not provide a date then a video of the last alarm will be played. 

User: "Alexa, ask zone minder to play alarm from front porch"

Alexa: "Showing last alarm clip from front porch camera"

Result: Video of last alarm clip from this camera will play on an Echo device with a screen.

# Project Requirements
My high level goals and associated requirements for this project are shown below.

1. **Quickly archive Zoneminder alarm frames to the cloud in order to safeguard against malicious removal of on-site server.**
This lead to the requirement of a five second or less upload time to a secure AWS S3 bucket. Although ZoneMinder has a built-in ftp-based filter it was suboptimal for this application as explained below.

2. **Significantly reduce false positives from ZoneMinder's pixel-based motion detection.**
This lead to the requirement to use a higher-level object and person detection algorithm based on AWS Rekognition.

3. **Make it much easier to access ZoneMinder information.**
This lead to the requirement to use voice to interact with ZoneMinder, implemented by an Amazon Alexa Skill. This includes proactive notifications, e.g., the Alexa service telling you that an alarm has occurred and why. For example because an unknown person was seen by a camera or when a known person was seen. Another example is time-, object- and person-based voice search.

4. **Have low implementation and operating costs.**
This lead to the requirement to leverage existing components where possible and make economical use of the AWS service. An operating cost of less than $10 per year is the goal.

5. **Be competitive with smart camera systems out in the market from Nest, Amazon, and others that use image recognition and Alexa.**

6. **Learn about, and show others how to use, ZoneMinder, Alexa and the AWS Services.**

# System Architecture
The figure below shows the smart-zoneminder system architecture.

![Alt text](/img/sz-blk-dia.jpg?raw=true "smart-zoneminder system architecture diagram.")

# System Components and Installation
The information below details each major component in the architecture, the interconnects between the other componenets and how to install them both locally and in the cloud. 

## Prerequisites

### ZoneMinder Configuration
TBA - monitor mode

TBA - motion detect config

TBA - directory assumptions

### Local Server Configuration
TBA - Clone smart-zoneminder repo

TBA - Apache config

TBA - CGI config

TBA - port and firewall config

### AWS Service Configuration
TBA - AWS account setup

## Alarm Uploader

## Alarm Clip Generator

## AWS Step

## AWS Rekognition

## S3 Archiver

## DynamoDB

## Alexa Skill

## Alexa Skill Handler

# License
Everything here is licensed under the [MIT license](https://choosealicense.com/licenses/mit/).

# Contact
For questions or comments about this project please contact the author goruck (Lindo St. Angel) at {lindostangel} AT {gmail} DOT {com}.

# Acknowledgements
The alarm uploader was inspired by Brian Roy's [Zoneminder-Alert-Image-Upload-to-Amazon-S3](https://github.com/briantroy/Zoneminder-Alert-Image-Upload-to-Amazon-S3). The general approach of triggering an AWS Step function by an image uploaded to S3 to be analyzed by Rekognition was modeled after Mark West's [smart-security-camera](https://github.com/markwest1972/smart-security-camera).

Thank you Brian and Mark!

# Appendix
