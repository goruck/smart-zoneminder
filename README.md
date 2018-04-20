*This entire project (including the Readme) is under construction.*

# smart-zoneminder
smart-zoneminder enables fast upload of [ZoneMinder](https://www.zoneminder.com/) alarm frame images to an S3 archive where they are analyzed by Amazon Rekognition and made accessible by voice via Alexa. The use of Rekognition dramatically reduces the number of false alarms and provides for robust scene, object and face detection. Alexa allows a user to ask to see an image or a video corresponding to an alarm (if using an Echo device with a display) and to get information on what caused the alarm and when it occurred.

# Usage Examples
Hera are a few of the things you can do with smart-zoneminder.

**Note: smart-zoneminder currently does not support live streaming of camera feeds.** I recommend that you use [alexa-ip-cam](https://github.com/goruck/alexa-ip-cam) for streaming your cameras feeds live on Echo devices. 

## Ask Alexa to show an alarm from a camera on a specific date and time
Note that if the user does not provide a date then the most recent alarm will be shown.

User: "Alexa, ask zone minder to show alarm from front porch"

Alexa: "Showing last alarm from front porch camera"

![Alt text](/img/last-alarm-by-camera-name.jpg?raw=true "last alarm from camera example.")

## Ask Alexa to show last N alarms from a specific camera on a specific date and time
Note that if user does not give the number of alarms to show the skill will default to showing the last ten around that date and if date is omitted the most recent alarms will be returned.

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
This lead to the requirement of a five second or less upload time to a secure AWS S3 bucket. Although ZoneMinder has a built-in ftp-based filter it was sub-optimal for this application as explained below.

2. **Significantly reduce false positives from ZoneMinder's pixel-based motion detection.**
This lead to the requirement to use a higher-level object and person detection algorithm based on Amazon Rekognition.

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
The information below details each major component in the architecture, the interconnects between the other components and how to install them both locally and in the cloud.

Note - at some point I will create means to automate the installation of smart-zoneminder but for now you'll have to manually perform these steps. 

## Prerequisites

### ZoneMinder

You need to have ZoneMinder installed on a local linux machine to use smart-zoneminder. I'm using version 1.29.0 which is installed on machine running Debian 8. I followed [Debian 8 64-bit with Zoneminder 1.29.0 the Easy Way](https://wiki.zoneminder.com/Debian_8_64-bit_with_Zoneminder_1.29.0_the_Easy_Way) to install ZoneMinder.

I have the monitor function set to [Mocord](http://zoneminder.readthedocs.io/en/stable/userguide/definemonitor.html) which means that the camera streams will be continuously recorded, with motion being marked as an alarm within an event (which is a 600 second block of continuously recorded video). ZoneMinder stores the camera streams as JPEGs for each video frame in the event. I chose this mode because I wanted to have a record of all the video as well as the alarms. ZoneMinder does provide for a means ("filters") to upload an event to an external server when certain conditions are met, such as an alarm occurring. Its possible to use such a filter instead of the uploader I created but I didn't want to upload 600 s worth of images every time an alarm occurred and the filter would have been slow, worse case being almost 600 s if an alarm happened at the start of an event.

Its very important to configure ZoneMinder's motion detection properly to limit the number of false positives in order to minimize cloud costs, most critically AWS Rekognition. Even though the Rekognition Image API has a free tier that allows 5,000 images per month to be analyzed its very easy for a single camera to see many thousands of alarm frames per month in a high traffic area and every alarm frame is a JPEG that is sent to the cloud to be processed via the Rekognition Image API. There are many guides on the Internet to help configure ZoneMinder motion detection. I found [Understanding ZoneMinder's Zoning system for Dummies](https://wiki.zoneminder.com/Understanding_ZoneMinder%27s_Zoning_system_for_Dummies) to be very useful but it takes some trial and error to get it right given each situation is so different. Zoneminder is configured to analyze the feeds for motion at 2 FPS which also helps to limit Rekognition costs but it comes at the expense of possibly missing a high speed object moving through the camera's FOV (however unlikely in my situation). 

Currently smart-zoneminder naively sends every alarm frame detected by ZoneMinder to the cloud. This is expensive. Clearly there are more optimal ways to process the alarms locally in terms of more advanced motion detection algorithms and exploiting the temporal coherence between alarm frames that would limit cloud costs without some of the current restrictions. This is an area for future study by the project. 

I have seven 1080p PoE cameras being served by my ZoneMinder setup. The cameras are sending MJPEG over RTSP to ZoneMinder at 2 FPS. I've configured the cameras' shutter to minimize motion blur at the expense of noise in low light situations since I found Rekognition's accuracy is more affected by the former.

Some of the components interface with ZoneMinder's MySql database and image store and make assumptions about where those are in the filesystem. I've tried to pull these dependencies out into configuration files where feasible but if you heavily customize ZoneMinder its likely some path in the component code will need to be modified that's not in a configuration file.

### Apache
If you installed ZoneMinder successfully then apache should be up and running but a few modifications are required for this project. The Alexa [VideoApp Interface](https://developer.amazon.com/docs/custom-skills/videoapp-interface-reference.html) that is used to display clips of alarm videos requires the video file to be hosted at an Internet-accessible HTTPS endpoint. HTTPS is required, and the domain hosting the files must present a valid, trusted SSL certificate. Self-signed certificates cannot be used. Since the video clip is generated on the local server Apache needs to serve the video file in this manner. This means that you need to setup a HTTPS virtual host with a publicly accessible directory on your local machine. Note that you can also leverage this to access the ZoneMinder web interface in a secure manner externally. Here are the steps I followed to configure Apache to use HTTPS and serve the alarm video clip.

1. Get a hostname via a DDNS or DNS provider. I used [noip](https://www.noip.com/).
2. Get a SSL cert from a CA. I used [Let's Encrypt](https://letsencrypt.org/) and the command at my local machine `certbot -d [hostname] --rsa-key-size 4096 --manual --preferred-challenges dns certonly`. It will ask you to verify domain ownership by creating a special DNS record at your provider.
3. Follow [How To Create a SSL Certificate on Apache for Debian 8](https://www.digitalocean.com/community/tutorials/how-to-create-a-ssl-certificate-on-apache-for-debian-8) except instead of using self-signed certs use the certs generated above. 
4. Create a directory to hold the generated alarm clip and make the permissions for u, g and o rwx. I created this directory at /var/www/public.
5. Configure Apache to allow the public directory to be accessed by adding something like this to the configuration file in the sites-enabled directory:
```xml
<Directory "/var/www/public">
    AuthType None
    Require all granted
    AddType video/mp4 .mp4
</Directory>
```
6. Configure Apache to allow the CGI to be used. You should allow the CGI script only to be accessed externally via HTTPS and only with a password. I used [DIY: Enable CGI on your Apache server](https://www.techrepublic.com/blog/diy-it-guy/diy-enable-cgi-on-your-apache-server/) as a guide but only enabled the CGI to be used with the HTTPS virtual host.
7. Restart Apache.
8. Allow external access to Apache by opening the right port on your firewall. 

### Amazon Developers Account
You'll need an [Amazon Developers](https://developer.amazon.com/) account to use the Alexa skills I developed for this project since I haven't published them. 

### AWS Account
You'll also need an [Amazon AWS](https://aws.amazon.com/) account to run the skill's handler and the other lambda functions required for this project.

### DynamoDB
smart-zoneminder uses a [DynamoDB](https://aws.amazon.com/dynamodb/?nc2=h_l3_db) table to store information about the alarm frame images uploaded to S3. This table needs to be created either through the AWS cli or the console. Here's how to do it via the console.

1. Open the DynamoDB console at https://console.aws.amazon.com/dynamodb/. Make sure you are using the AWS Region that you will later create smart-zoneminder's lambda functions. 

2. Choose Create Table.

3. In the Create DynamoDB table screen, do the following:
    * In the Table name field, type ZmAlarmFrames.
    * For the Primary key, in the Partition key field, type ZmCameraName. Set the data type to String.
    * Choose Add sort key.
    * In the Sort Key field type ZmEventDateTime. Set the data type to String. 

When the settings are as you want them, choose Create.

### S3
You'll need an [S3 bucket](https://aws.amazon.com/documentation/s3/) where your images can be uploaded for processing and archived. You can create the bucket either through the AWS cli or the console, here's how to do it via the console.

1. Sign in to the AWS Management Console and open the Amazon S3 console at https://console.aws.amazon.com/s3/.
2. Choose Create bucket.
3. In the Bucket name field, type zm-alarm-frames.
4. For Region, choose the region where you want the bucket to reside. This should be the same as the DynamoDB and lambda functions region. 
5. Choose Create.
6. The bucket will need two root directories, /upload and /archive. Choose Create folder to make these. 
7. Directly under the /archive directory, create the /alerts and /falsepositives subdirectories, again by using choosing Create folder. 
8. In the "Permissions->Bucket Policy" tab for your S3 Bucket, set up the following Bucket Policy.

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": {
                "AWS": "*"
            },
            "Action": [
                "s3:Get*",
                "s3:List*"
            ],
            "Resource": [
                "arn:aws:s3:::your-bucket-name",
                "arn:aws:s3:::your-bucket-name/*"
            ]
        }
    ]
}
```

### Clone smart-zoneminder
To use smart-zoneminder you will need to clone my GitHub repo to your local machine by running `git clone https://github.com/goruck/smart-zoneminder`.

## Alarm Uploader (zm-s3-upload)
The Alarm Uploader, [zm-s3-upload](https://github.com/goruck/smart-zoneminder/blob/master/zm-s3-upload/zm-s3-upload.js), is a node.js application running on the local server that continually monitors ZoneMinder's database for new alarm frames images and if found sends them to an S3 bucket and marks them as having been uploaded. The Alarm Uploader also attaches metadata to the alarm frame image such as alarm score, event ID, frame number, date, and others. The metadata is used later on by the cloud services to process the image. The Alarm Uploader will concurrently upload alarm frames to optimize overall upload time. The default value is ten concurrent uploads. Upload speed will vary depending on your Internet bandwidth, image size and other factors but typically frames will be uploaded to S3 in less than a few hundred milliseconds. 

Please see the Alarm Uploader's [README](https://github.com/goruck/smart-zoneminder/blob/master/zm-s3-upload/README.md) for installation instructions. 

## Alarm Clip Generator (gen-vid)
The Alarm Clip Generator, [gen-vid](https://github.com/goruck/smart-zoneminder/blob/master/cgi/gen-vid.py), is a python script run in Apache's CGI on the local server that generates an MP4 video of an alarm event given its Event ID, starting Frame ID and ending Frame ID. The script is initiated via the CGI by the Alexa skill handler and the resulting video is played back on an Echo device with a screen upon a user's request.

ZoneMinder does offer a [streaming video API](https://github.com/ZoneMinder/zoneminder/blob/master/src/zms.cpp) that can be used to view the event with the alarm frames via a web browser. However rhe Alexa [VideoApp Interface](https://developer.amazon.com/docs/custom-skills/videoapp-interface-reference.html) that's used to playback the alarm clip requires very specific formats which are not supported by the ZoneMinder streaming API. Additionally I wanted to show only the alarm frames and not the entire event which also isn't supported by the Zoneminder API. Also its possible to create the video clip completely on the cloud from the alarm images stored in DynamoDB, however gaps would likely exist in videos created this way because there's no guarantee that ZoneMinder's motion detection would pick up all frames. So I decided to create gen-vid but it does come at the expense of complexity and user perceived latency since a long alarm clip takes some time to generate on my local machine. I'll be working to reduce this latency. 

Please see the Alarm Clip Generator's [README](https://github.com/goruck/smart-zoneminder/blob/master/cgi/README.md) for installation instructions. Apache must be setup to enable the CGI, see above. 

## Trigger Image Processing (s3-trigger-image-processing)
The Trigger Image Processing component (s3-trigger-image-processing) is an AWS Lambda Function that monitors the S3 bucket "upload" directory for new alarm image files and triggers their processing by calling the [step function](https://github.com/goruck/smart-zoneminder/tree/master/aws-step-function).

Please see the Start State Machine's [README](https://github.com/goruck/smart-zoneminder/blob/master/aws-lambda/s3-trigger-image-processing/README.md) for installation instructions. 

## State Machine
 The step function orchestrates calls to the AWS Lambda Functions associated with ZoneMinder alarm frame cloud processing. The State Machine is implemented by an [AWS Step Function](https://aws.amazon.com/step-functions/) which is defined by [step-smart-zoneminder.json](https://github.com/goruck/smart-zoneminder/blob/master/aws-step-function/step-smart-zoneminder.json) in the [aws-step-function](https://github.com/goruck/smart-zoneminder/tree/master/aws-step-function) directory. The State Machine's state transition diagram is shown below.

![Alt text](aws-step-function/step-smart-zoneminder.png?raw=true "state transition diagram diagram.")

Please see the State Machine's [README](https://github.com/goruck/smart-zoneminder/blob/master/aws-step-function/README.md) for installation instructions.

## Alarm Frame Processing
There are several AWS Lambda Functions that process ZoneMinder alarm frames. These are described below and are in the [aws-lambda](https://github.com/goruck/smart-zoneminder/tree/master/aws-lambda) folder. 

### Rekognition (rekognition-image-assessment)
The AWS Lambda function in the rekognition-image-assessment folder sends images from s3 to Amazon Rekognition for object detection. Recognition returns labels associated with the object's identity and are passed to the rekognition-evaluate-labels function for further processing. 

Please see the function's [README](https://github.com/goruck/smart-zoneminder/blob/master/aws-lambda/rekognition-image-assessment/README.md) for installation instructions. 

### Evaluate Rekognition Labels (rekognition-evaluate-labels)
The AWS Lambda function in the rekognition-evaluate-labels folder evaluates whether or not the image's labels contains a person. This information is used to determine false positives (no person in image) vs true positives and is passed on to the s3-archive image function to appropriately archive the image.

Please see the function's [README](https://github.com/goruck/smart-zoneminder/blob/master/aws-lambda/rekognition-evaluate-labels/README.md) for installation instructions.

### Archive S3 Image (s3-archive-image)
The AWS Lambda function in the s3-archive-image folder uses the evaluated Rekognition labels to move alarm frame images from the S3 upload folder to either the falsepositives folder (no person was found in the image) or the alerts folder (a person was found).

Please see the function's [README](https://github.com/goruck/smart-zoneminder/blob/master/aws-lambda/s3-archive-image/README.md) for installation instructions.

### Store DynamoDB Metadata (ddb-store-metadata)
The AWS Lambda function in the ddb-store-metadata folder stores metadata about the alarm frames that were archived by s3-archive-image into a DynamoDB table.

Please see the function's [README](https://github.com/goruck/smart-zoneminder/blob/master/aws-lambda/ddb-store-metadata/README.md) for installation instructions.

### Error Handler (error-handler)
The AWS Lambda function in the error-handler folder deals with any error conditions generated by the Lambda functions described above for alarm frame processing.

Please see the function's [README](https://github.com/goruck/smart-zoneminder/blob/master/aws-lambda/error-handler/README.md) for installation instructions.

## Alexa Skill (skill.json)

## Alexa Skill Handler (alexa-smart-zoneminder)

# License
Everything here is licensed under the [MIT license](https://choosealicense.com/licenses/mit/).

# Contact
For questions or comments about this project please contact the author goruck (Lindo St. Angel) at {lindostangel} AT {gmail} DOT {com}.

# Acknowledgements
The alarm uploader was inspired by Brian Roy's [Zoneminder-Alert-Image-Upload-to-Amazon-S3](https://github.com/briantroy/Zoneminder-Alert-Image-Upload-to-Amazon-S3). The general approach of triggering an AWS Step function by an image uploaded to S3 to be analyzed by Rekognition was modeled after Mark West's [smart-security-camera](https://github.com/markwest1972/smart-security-camera).

Thank you Brian and Mark!

# Appendix
