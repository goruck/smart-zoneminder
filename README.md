*This entire project (including the Readme) is under construction.*

# smart-zoneminder
smart-zoneminder enables fast upload of [ZoneMinder](https://www.zoneminder.com/) alarm frame images to an S3 archive where they are analyzed by AWS Rekognition and made accessible by voice via Alexa. The use of Rekognition dramatically reduces the number of false alarms and provides for robust scene, object and face detection. Alexa allows a user to ask to see an image or a video corresponding to an alarm (if using an Echo device with a display) and to get information on what caused the alarm and when it occurred.

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

## Ask Alexa to show the last alarm from all cameras

User: "Alexa, ask zone minder to show alarm"

Alexa: "Showing last alarm from play room door camera"

Result: Image of last alarm frame from all cameras will be displayed on an Echo device with a screen or user will hear about the alarm from Alexa on devices without a screen.

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

### ZoneMinder

You need to have ZoneMinder installed on a local linux machine to use smart-zoneminder. I'm using version 1.29.0 which is installed on machine running Debian 8. I followed [Debian 8 64-bit with Zoneminder 1.29.0 the Easy Way](https://wiki.zoneminder.com/Debian_8_64-bit_with_Zoneminder_1.29.0_the_Easy_Way) to install ZoneMinder.

I have the monitor function set to Mocord which means that the camera streams will be continuously recorded, with motion being marked as an alarm within an event (which is a 600 second block of continously recored video). ZoneMinder stores the camera streams as JPEGs for each video frame in the event. I chose this mode because I wanted to have a record of all the video as well as the alarms. ZoneMinder does provide for a means ("filters") to upload an event to an external server when certain conditions are met, such as an alarm occuring. Its possible to use such a filter instead of the uploader I created but I didn't want to upload 600 s worth of images everytime an alarm occured and the filter would have been slow, worse case being almost 600 s if an alarm happened at the start of an event.

Its very important to configure ZoneMinder's motion detection properly to limit the number of false positives in order to minimize cloud costs, most critically AWS Rekognition. Even though the Rekognition Image API has a free tier that allows 5,000 images per month to be analyzed its very easy for a single camera to see many thousands of alarm frames per month in a high traffic area and every alarm frame is a JPEG that is sent to the cloud to be processed via the Rekognition Image API. There are many guides on the Internet to help configure ZoneMinder motion detection. I found [Understanding ZoneMinder's Zoning system for Dummies](https://wiki.zoneminder.com/Understanding_ZoneMinder%27s_Zoning_system_for_Dummies) to be very helpful but it takes some trial and error to get it right given each situation is so different.  

TBA - directory assumptions

I have seven 1080p PoE cameras being served by my ZoneMinder setup. The cameras are sending MJPEG over RTSP to ZoneMinder at a low 2 fps to also help limit Rekognition costs.

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
