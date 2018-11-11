*This entire project (including the Readme) is under construction.*

# smart-zoneminder
smart-zoneminder enables fast object detection, face recognition and upload of [ZoneMinder](https://www.zoneminder.com/) alarm images to an S3 archive where they are made accessible by voice via Alexa. The use of object detection remotely via [Rekognition](https://aws.amazon.com/rekognition) or locally via [Tensorflow](https://www.tensorflow.org/) dramatically reduces the number of false alarms and provides for robust scene and object detection. Face recognition via [ageitgey's](https://github.com/ageitgey/face_recognition) Python API to [dlib](http://dlib.net/) is used to identify people detected in the alarm images. Alexa allows a user to ask to see an image or a video corresponding to an alarm and to get information on what caused the alarm and when it occurred. Real-time e-mail of alarms are supported and as soon as the [Alexa Skills Kit supports notifications](https://developer.amazon.com/blogs/alexa/post/833b9af4-26e6-47d2-a13d-bdbd9a257512/expanded-developer-preview-of-notifications-for-alexa-skills), they will also be added. 

# Table of Contents
1. [Usage Examples](https://github.com/goruck/smart-zoneminder/blob/master/README.md#usage-examples)
2. [Project Requirements](https://github.com/goruck/smart-zoneminder/blob/master/README.md#project-requirements)
3. [System Architecture](https://github.com/goruck/smart-zoneminder/blob/master/README.md#system-architecture)
4. [System Components and Installation](https://github.com/goruck/smart-zoneminder/blob/master/README.md#system-components-and-installation)
5. [License](https://github.com/goruck/smart-zoneminder/blob/master/README.md#license)
6. [Contact](https://github.com/goruck/smart-zoneminder/blob/master/README.md#contact)
7. [Acknowledgements](https://github.com/goruck/smart-zoneminder/blob/master/README.md#acknowledgements)
8. [Appendix](https://github.com/goruck/smart-zoneminder/blob/master/README.md#appendix)

# Usage Examples
Here are a few of the things you can do with smart-zoneminder.

Note that in all the examples below if the user makes the request to an Alexa device without a screen then the skill will make an attempt to verbalize the response to the user as clearly as possible. 

## Ask Alexa to show the last alarm from a camera due to a person or thing

General form:

"Alexa, ask zone minder to show {Location} alarm of {PersonOrThing}"

If the user does not provide a location then the most recent alarm will be shown from any camera and if a specific person or thing is not given then an alarm caused by any person will be shown. Location can be any camera name defined in the [configuration](./aws-lambda/alexa-smart-zoneminder/config.json) and PersonOrThing can be the name of any person defined in the configuration, 'stranger' for any person not defined or any label given in the [COCO](http://cocodataset.org/#home) dataset. The user can see a video corresponding to the alarm by asking Alexa to "show video clip."

Specific example 1:

User: "Alexa, ask zone minder to show front porch alarm"

Alexa: "Showing last alarm from front porch camera on 2018-10-30 18:25"

![Alt text](./img/last-alarm-by-camera-name.jpg?raw=true "Last alarm from camera example.")

Specific example 2:

User: "Alexa ask zone minder for back garage alarm of stranger"

Alexa: "Alarm from back gargage caused by stranger on 2018-10-29 13:10"

![Alt text](./img/stranger.png?raw=true "Show stranger example.")

## Ask Alexa to show alarms from a camera due to a person or thing starting from some time ago

General form:

"Alexa, ask zone minder to show {Location} alarms of {PersonOrThing} from {SomeTimeAgo} ago"

If the user does not provide a location then the last alarm will be shown from all cameras (this can also be triggered by simply asking Alexa to "show all"). If a specific person or thing is not given then an alarm caused by any person will be shown. Location can be any camera name defined in the [configuration](./aws-lambda/alexa-smart-zoneminder/config.json) and PersonOrThing can be the name of any person defined in the configuration, 'stranger' for any person not defined or any label given in the [COCO](http://cocodataset.org/#home) dataset. If a duration was not given by {SomeTimeAgo} then the last alarms will be shown starting from three days ago. In all cases the number of alarms shown will not exceed 64 on the screen due to an Alexa service limitation. The user can scroll though the alarms by either touch or voice and can see a video clip corresponding to the alarm by asking Alexa to "show video clip".

Specific example 1:

User: "Alexa, ask zone minder to show front porch alarms"

Alexa: "Showing oldest alarms first from front porch camera"

![Alt text](./img/last-alarms-example.jpg?raw=true "Last alarms from camera example.")

Specific example 2:

User: "Alexa, ask zone minder to show alarms of Lindo"

Alexa: "Showing latest alarms from all cameras caused by Lindo"

![Alt text](./img/show-lindo-all.jpg?raw=true "Show all alarms of a person example.")

Specific example 3:

User: "Alexa, ask zone minder to show backyard alarms of Polly"

Alexa: "Showing oldest alarms first from backyard for Polly"

![Alt text](./img/show-polly-backyard.png?raw=true "show Polly example.")

## Ask Alexa to play a video of a last alarm from a camera
**Note: smart-zoneminder currently does not support live streaming of camera feeds.** I recommend that you use [alexa-ip-cam](https://github.com/goruck/alexa-ip-cam) for streaming your cameras feeds live on Echo devices. 

General form:

"Alexa, show {Location} video clip"

If the user does not provide a camera location then the last video clip of any alarm will be displayed.

Specific example:

User: "Alexa, ask zone minder to show front porch video clip"

Alexa: "Showing most recent video clip from front porch alarm."

Result: Video of last alarm clip from this camera will play on an Echo device with a screen.

## Ask Alexa a series of commands to view alarms and videos
The skill can handle series commands that, for example, allow the user to view an alarm and then view a video clip containing that alarm. Here are some videos of these examples.

Specific example 1:

User commands: (1) Ask Alexa to show all events; (2) view a particular alarm; (3) view a video containing that alarm; (4) go back and select another alarm.

Click on image below to see video of Alexa response:

[![Specific example 1](https://img.youtube.com/vi/ZyqomNhE8Ow/0.jpg)](https://www.youtube.com/watch?v=ZyqomNhE8Ow)

Specific example 2:

User commands: (1) Ask Alexa to show last alarm; (2) show last alarm from back garage; (3) show a video clip of that alarm.

Click on image below to see video of Alexa response:

[![Specific example 2](https://img.youtube.com/vi/ZR35JpWSDVI/0.jpg)](https://www.youtube.com/watch?v=ZR35JpWSDVI)

Specific example 3:

User commands: (1) Ask Alexa to show front porch alarms of Lindo; (2) scroll to find an alarm; (3) select an alarm; (4) view video clip of alarm; (5) go back to list of alarms; (6) select another alarm; (7) view video clip of alarm; (8) go back; (9) select another alarm; (10) view video clip of alarm; (11) exit.

Click on image below to see video of Alexa response:

[![Specific example 3](https://img.youtube.com/vi/rbGPW3MvDoo/0.jpg)](https://www.youtube.com/watch?v=rbGPW3MvDoo)

## Send Emails of Alarms
smart-zoneminder can email alarms based on the face detected in the image. Here's an an example of an alarm email sent to a mobile device:

![Alt text](./img/alarm-email-example.png?raw=true "example of alarm email.")

# Project Requirements
My high level goals and associated requirements for this project are shown below.

1. **Quickly archive Zoneminder alarm frames to the cloud in order to safeguard against malicious removal of on-site server.**
This lead to the requirement of a five second or less upload time to a secure AWS S3 bucket. Although ZoneMinder has a built-in ftp-based filter it was sub-optimal for this application as explained below.

2. **Significantly reduce false positives from ZoneMinder's pixel-based motion detection.**
This lead to the requirement to use a higher-level object and person detection algorithm based on Amazon Rekognition remotely or Tensorflow locally (this is configurable).

3. **Determine if a person detected in an Alarm image is familiar or not.** This lead to the requirement to perform real-time face recognition on people detected in ZoneMinder images. 

4. **Make it easy and intuitive to access ZoneMinder information.**
This lead to the requirement to use voice to interact with ZoneMinder, implemented by an Amazon Alexa Skill. This includes proactive notifications, e.g., the Alexa service telling you that an alarm has occurred and why. For example, when an unknown person was seen by a camera or when a known person was seen. Another example is time-, object- and person-based voice search.

5. **Have low implementation and operating costs.**
This lead to the requirement to leverage existing components where possible and make economical use of the AWS services. This also led to the option of using local Tensorflow based object detection since using Rekognition at scale is not inexpensive wrt the goals of this project. An operating cost of less than $10 per year is the goal.

6. **Be competitive with smart camera systems out in the market from Nest, Amazon, and others that use image recognition and Alexa.**

7. **Learn about, and show others how to use, Tensorflow, Face Recognition, ZoneMinder, Alexa and the AWS Services.**

# System Architecture
The figure below shows the smart-zoneminder system architecture.

![Alt text](./img/sz-blk-dia.jpg?raw=true "smart-zoneminder system architecture diagram.")

# System Components and Installation
The information below details each major component in the architecture, the interconnects between the other components and how to install them both locally and in the cloud.

Note - at some point I will create means to automate the installation of smart-zoneminder but for now you'll have to manually perform these steps. 

## Prerequisites

### ZoneMinder

You need to have ZoneMinder installed on a local linux machine to use smart-zoneminder. I'm using version 1.30.4 which is installed on machine running Ubuntu 18.04. I followed [Ubuntu Server 18.04 64-bit with Zoneminder 1.30.4 the easy way](https://wiki.zoneminder.com/Ubuntu_Server_18.04_64-bit_with_Zoneminder_1.30.4_the_easy_way) to install ZoneMinder.

I have the monitor function set to [Mocord](http://zoneminder.readthedocs.io/en/stable/userguide/definemonitor.html) which means that the camera streams will be continuously recorded, with motion being marked as an alarm within an event (which is a 600 second block of continuously recorded video). ZoneMinder stores the camera streams as JPEGs for each video frame in the event. I chose this mode because I wanted to have a record of all the video as well as the alarms. ZoneMinder does provide for a means ("filters") to upload an event to an external server when certain conditions are met, such as an alarm occurring. Its possible to use such a filter instead of the uploader I created but I didn't want to upload 600 s worth of images every time an alarm occurred and the filter would have been slow, worse case being almost 600 s if an alarm happened at the start of an event.

Its very important to configure ZoneMinder's motion detection properly to limit the number of false positives in order to minimize cloud costs, most critically AWS Rekognition. Even though the Rekognition Image API has a free tier that allows 5,000 images per month to be analyzed its very easy for a single camera to see many thousands of alarm frames per month in a high traffic area and every alarm frame is a JPEG that is sent to the cloud to be processed via the Rekognition Image API. There are many guides on the Internet to help configure ZoneMinder motion detection. I found [Understanding ZoneMinder's Zoning system for Dummies](https://wiki.zoneminder.com/Understanding_ZoneMinder%27s_Zoning_system_for_Dummies) to be very useful but it takes some trial and error to get it right given each situation is so different. Zoneminder is configured to analyze the feeds for motion at 5 FPS which also helps to limit Rekognition costs but it comes at the expense of possibly missing a high speed object moving through the camera's FOV (however unlikely in my situation). Since I was still concerned about Rekognition costs I also included the option to run local Tensorflow-based object detection instead. This comes at the expense of slightly higher detection times (with my current HW which uses a Nvidia Geforce GTX 1080Ti GPU for Tensorflow) but completely avoids Rekogntion costs. 

If set to use remote object detection via Rekognition smart-zoneminder can be configured to either send all or some alarm frames (as specified by the *frameSkip* parameter in the uploader's config file) detected by ZoneMinder's motion detector to the cloud. This is expensive. Clearly there are more optimal ways to process the alarms locally in terms of more advanced motion detection algorithms and exploiting the temporal coherence between alarm frames that would limit cloud costs without some of the current restrictions. This is an area for future study by the project. 

I have seven 1080p PoE cameras being served by my ZoneMinder setup. The cameras are sending MJPEG over RTSP to ZoneMinder at 5 FPS. I've configured the cameras' shutter to minimize motion blur at the expense of noise in low light situations since I found Rekognition's accuracy is more affected by the former. The object detection in Tensorflow seems more robust in this regard. 

Some of the components interface with ZoneMinder's MySql database and image store and make assumptions about where those are in the filesystem. I've tried to pull these dependencies out into configuration files where feasible but if you heavily customize ZoneMinder its likely some path in the component code will need to be modified that's not in a configuration file.

### Tensorflow
This project uses Tensorflow (with GPU support) for local object detection. I followed [Installing TensorFlow on Ubuntu ](https://www.tensorflow.org/install/install_linux) as a guide to install it on my local machine and I used a Python Virtual environment. After I installed Tensorflow I installed the object detection API using [Step by Step TensorFlow Object Detection API Tutorial](https://medium.com/@WuStangDan/step-by-step-tensorflow-object-detection-api-tutorial-part-1-selecting-a-model-a02b6aabe39e) as a guide. I'm currently using the *rfcn_resnet101_coco_2018_01_28* model which can be found in the [Tensorflow detection model zoo](https://github.com/tensorflow/models/blob/master/research/object_detection/g3doc/detection_model_zoo.md#tensorflow-detection-model-zoo).

### dlib, face_recognition and OpenCV
[ageitgey's face_recognition API](https://github.com/ageitgey/face_recognition) is used for face recognition. I followed the [linux installation guide](https://gist.github.com/ageitgey/629d75c1baac34dfa5ca2a1928a7aeaf) to install the API and dlib with GPU support on my local machine in a Python virtual environment. OpenCV is used to preprocess the image for face recognition, I used [OpenCV 3 Tutorials, Resources, and Guides](https://www.pyimagesearch.com/opencv-tutorials-resources-guides/) to install OpenCV 3.4.2 with GPU support on my local machine. A high-level overview of how the face recognition works can be found [here](https://medium.com/@ageitgey/machine-learning-is-fun-part-4-modern-face-recognition-with-deep-learning-c3cffc121d78) and [here](https://www.pyimagesearch.com/2018/06/18/face-recognition-with-opencv-python-and-deep-learning/).

### Apache
If you installed ZoneMinder successfully then apache should be up and running but a few modifications are required for this project. The Alexa [VideoApp Interface](https://developer.amazon.com/docs/custom-skills/videoapp-interface-reference.html) that is used to display clips of alarm videos requires the video file to be hosted at an Internet-accessible HTTPS endpoint. HTTPS is required, and the domain hosting the files must present a valid, trusted SSL certificate. Self-signed certificates cannot be used. Since the video clip is generated on the local server Apache needs to serve the video file in this manner. This means that you need to setup a HTTPS virtual host with a publicly accessible directory on your local machine. Note that you can also leverage this to access the ZoneMinder web interface in a secure manner externally. Here are the steps I followed to configure Apache to use HTTPS and serve the alarm video clip.

1. Get a hostname via a DDNS or DNS provider. I used [noip](https://www.noip.com/).
2. Get a SSL cert from a CA. I used [Let's Encrypt](https://letsencrypt.org/) and the command at my local machine `certbot -d [hostname] --rsa-key-size 4096 --manual --preferred-challenges dns certonly`. It will ask you to verify domain ownership by creating a special DNS record at your provider.
3. Follow [How To Create a SSL Certificate on Apache for Debian 8](https://www.digitalocean.com/community/tutorials/how-to-create-a-ssl-certificate-on-apache-for-debian-8) except instead of using self-signed certs use the certs generated above. 
4. Create a directory to hold the generated alarm clip and make the permissions for g and o equal to rx. I created this directory at /var/www/loginto.me/public and there `touch` a file called *alarm-video.mp4* and give it rx permissions of u,g, and o. This will allow the generator to write a video by that name to this directory. 
5. Configure Apache to allow the public directory to be accessed and configure Apache to allow the CGI to be used. You should allow the CGI script only to be accessed externally via HTTPS and only with a password. You can copy the configuration file in apache/smart-zoneminder.conf to your Apache config-available directory, modify it to your needs and enable it in Apache.
7. Restart Apache.
8. Allow external access to Apache by opening the right port on your firewall.

### MongoDB
I use a local mongo database to store how every alarm frame was processed by the system. Its important to record the information locally since depending on what options are set not all alarm frames and their associated metadata will be uploaded to AWS S3. The mongo logging can be toggled on or off by a configuration setting. See [How to Install MongoDB on Ubuntu 18.04](https://www.tecmint.com/install-mongodb-on-ubuntu-18-04/) for instructions on how to install mongo on your system.

### Amazon Developers Account
You'll need an [Amazon Developers](https://developer.amazon.com/) account to use the Alexa skills I developed for this project since I haven't published them. 

### AWS Account
You'll also need an [Amazon AWS](https://aws.amazon.com/) account to run the skill's handler, the other lambda functions required for this project, DynamoDB and S3.

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

Thanks to [Paul Branston](https://github.com/pbran) for great suggestions to set secure S3 permissions. Also see this [blog](http://mikeferrier.com/2011/10/27/granting-access-to-a-single-s3-bucket-using-amazon-iam/) for additional related information. 

1. Sign in to the AWS Management Console and open the Amazon S3 console at https://console.aws.amazon.com/s3/.
2. Choose Create bucket.
3. In the Bucket name field type zm-alarm-frames.
4. For Region, choose the region where you want the bucket to reside. This should be the same as the DynamoDB and lambda functions region. 
5. Choose Create.
6. The bucket will need two root directories, /upload and /archive. Choose Create folder to make these. 
7. Directly under the /archive directory, create the /alerts and /falsepositives subdirectories, again by using choosing Create folder.
8. Now you need to limit access to the bucket, so start by log into to the AWS IAM AWS console.
9. Create a new user.
10. Set a password for the new user. Your user will also have an AWS access and secret key created. API clients (e.g., zm-s2-upload) need to use these keys and will have the same permissions as the user would in the AWS console. Save the AWS access key and the secret key which will be used in a step below. 
11. Add permissions so that only this user has access to the bucket. My permissions to do that are shown below.
```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "VisualEditor0",
            "Effect": "Allow",
            "Action": "s3:ListAllMyBuckets",
            "Resource": "*"
        },
        {
            "Sid": "VisualEditor1",
            "Effect": "Allow",
            "Action": "s3:*",
            "Resource": [
                "arn:aws:s3:::zm-alarm-frames",
                "arn:aws:s3:::zm-alarm-frames/*"
            ]
        }
    ]
}
```
Note that the Alexa devices require a public URI for all images and videos that these devices display. You can either point the URI to the S3 bucket or to the the server on the local network containing the ZoneMinder image store. The lambda handler for the Alexa skill can be configured to point to either the S3 bucket or the local network for image access by changing the *USE_LOCAL_PATH* constant.

In the case of pointing the URI to the S3 bucket the Alexa skill will only work if the bucket is open to the world which obviously means that anyone could view your alarm frames. **FOR TEST PURPOSES ONLY** you can open your bucket by replacing the JSON in step 11 above with the following.
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Action": "s3:GetObject",
      "Effect": "Allow",
      "Resource": "arn:aws:s3:::zm-alarm-frames/*",
      "Principal": "*"
    }
  ]
}
```

However, the recommended approach is to serve the ZoneMinder event files locally and point a public URI to the files that the Alexa devices on your local network can access. This avoids the risk of an S3 bucket being open to the world but comes at the expense of serving up those files locally and keeping the local store in synch with remote store on S3 (which is currently not done). But since Apache is already being used for ZoneMinder anyway the effort is manageable.

Here's how to enable local access.

1. Setup a DNS entry for the Apache server's private IP address on your LAN. I used GoDaddy but any DNS host should work, just create an A record for the Apache server's IP address and give it a hostname. Putting Private IP's into public DNS is discouraged, but since this is for personal use its fine.
2. Get an SSL cert and use Domain Name Validation to secure the domain. I used LetsEncrypt.
3. Create a site configuration file for an Apace Virtual Host for the domain and create a Directory entry to serve the ZoneMinder event files. Here's mine.
```xml
Alias /nvr /nvr
<Directory "/nvr">
  DirectoryIndex disabled
  Options Indexes FollowSymLinks
  AuthType None
  Require all granted
</Directory>
```

### smart-zoneminder
To use smart-zoneminder you will need to clone my GitHub repo to your local machine by running:

```bash
$ git clone https://github.com/goruck/smart-zoneminder
```

## Alarm Uploader (zm-s3-upload)
The Alarm Uploader, [zm-s3-upload](https://github.com/goruck/smart-zoneminder/blob/master/zm-s3-upload/zm-s3-upload.js), is a node.js application running on the local server that continually monitors ZoneMinder's database for new alarm frames images and if found either directly sends them to an S3 bucket or first runs local object detection and or face recognition on the image and marks them as having been uploaded. The local object detection is enabled by setting the *runLocalObjDet* flag to "true" and face recognition is enabled by setting the *runFaceDetRec* flag to "true" in [zm-s3-upload-config.json
](https://github.com/goruck/smart-zoneminder/blob/master/zm-s3-upload/zm-s3-upload-config.json).

The Alarm Uploader also attaches metadata to the alarm frame image such as alarm score, event ID, frame number, date, and others. The metadata is used later on by the cloud services to process the image. The Alarm Uploader will concurrently upload alarm frames to optimize overall upload time. The default value is ten concurrent uploads. Upload speed will vary depending on your Internet bandwidth, image size and other factors but typically frames will be uploaded to S3 in less than a few hundred milliseconds.

The Alarm Uploader can be configured to skip alarm frames to minimize processing time, upload bandwidth and cloud storage. This is controlled by the *frameSkip* parameter in  the configuration json. 

Please see the Alarm Uploader's [README](https://github.com/goruck/smart-zoneminder/blob/master/zm-s3-upload/README.md) for installation instructions.

## Local Object Detection (obj_detect_server)
The Object Detection Server, [obj_det_server](https://github.com/goruck/smart-zoneminder/blob/master/obj-detect/obj_detect_server.py), runs the Tensorflow object detection inference engine using Python APIs and employees [zerorpc](http://www.zerorpc.io/) to communicate with the Alarm Uploader. One of the benefits of using zerorpc is that the object detection server can easily be run on another machine, apart from the machine running ZoneMinder. Another benefit is that the server when started will load into memory the model and initialize it, thus saving time when an inference is actually run. The server can optionally skip inferences on consecutive ZoneMinder Alarm frames to minimize processing time which obviously assumes the same object is in every frame. The Object Detection Server is started by a cron job at boot time.

Please see the Object Detection Server's [README](https://github.com/goruck/smart-zoneminder/blob/master/obj-detect/README.md) for installation instructions.

## Face Recognition (face-det-rec)
The Face Detection and Recognition module, [face-det-rec](https://github.com/goruck/smart-zoneminder/tree/master/face-det-rec) is run as a Python program from the Alarm Uploader and it uses dlib and the face_recognition API as described above. You need to first encode examples of faces you want recognized by using the *encode_faces.py* program in the same directory.

Please see the Face Recognition's [README](https://github.com/goruck/smart-zoneminder/blob/master/face-det-rec/README.md) for installation instructions.

## Alarm Clip Generator (gen-vid)
The Alarm Clip Generator, [gen-vid](https://github.com/goruck/smart-zoneminder/blob/master/cgi/gen-vid.py), is a python script run in Apache's CGI on the local server that generates an MP4 video of an alarm event given its Event ID, starting Frame ID and ending Frame ID. The script is initiated via the CGI by the Alexa skill handler and the resulting video is played back on an Echo device with a screen upon a user's request.

ZoneMinder does offer a [streaming video API](https://github.com/ZoneMinder/zoneminder/blob/master/src/zms.cpp) that can be used to view the event with the alarm frames via a web browser. However the Alexa [VideoApp Interface](https://developer.amazon.com/docs/custom-skills/videoapp-interface-reference.html) that's used to playback the alarm clip requires very specific formats which are not supported by the ZoneMinder streaming API. Additionally I wanted to show only the alarm frames and not the entire event which also isn't supported by the Zoneminder API. Also its possible to create the video clip completely on the cloud from the alarm images stored in DynamoDB, however gaps would likely exist in videos created this way because there's no guarantee that ZoneMinder's motion detection would pick up all frames. So I decided to create gen-vid but it does come at the expense of complexity and user perceived latency since a long alarm clip takes some time to generate on my local machine. I'll be working to reduce this latency. 

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
The AWS Lambda function in the s3-archive-image folder uses the evaluated Rekognition or Tensorflow object detection labels to move alarm frame images from the S3 upload folder to either the falsepositives folder (no person or object was found in the image) or the alerts folder (a person or object was found).

Please see the function's [README](https://github.com/goruck/smart-zoneminder/blob/master/aws-lambda/s3-archive-image/README.md) for installation instructions.

### Store DynamoDB Metadata (ddb-store-metadata)
The AWS Lambda function in the ddb-store-metadata folder stores metadata about the alarm frames that were archived by s3-archive-image into a DynamoDB table.

Please see the function's [README](https://github.com/goruck/smart-zoneminder/blob/master/aws-lambda/ddb-store-metadata/README.md) for installation instructions.

### Email Alarm Notifications (nodemailer-send-notification)
The AWS Lambda function in the nodemailer-send-notification folder emails alarm frames if person in image matches a user defined face name. This is normally the last task in the state machine.

Please see the function's [README](https://github.com/goruck/smart-zoneminder/blob/master/aws-lambda/nodemailer-send-notification/README.md) for installation instructions.

### Error Handler (error-handler)
The AWS Lambda function in the error-handler folder deals with any error conditions generated by the Lambda functions described above for alarm frame processing.

Please see the function's [README](https://github.com/goruck/smart-zoneminder/blob/master/aws-lambda/error-handler/README.md) for installation instructions.

## Alexa Skill
The [skill.json](./aws-ask/skill.json) file in the aws-ask folder defines the Alexa skill that the user interacts with to control smart-zoneminder.

Please see the [README](https://github.com/goruck/smart-zoneminder/blob/master/aws-ask/README.md) for installation instructions. 

## Alexa Skill Handler (alexa-smart-zoneminder)
The AWS Lambda function in the aws-lambda/alexa-smart-zoneminder folder implements the skill handler for the Alexa skill described above.

Please see the function's [README](https://github.com/goruck/smart-zoneminder/blob/master/aws-lambda/alexa-smart-zoneminder/README.md) for installation instructions.

# License
Everything here is licensed under the [MIT license](https://choosealicense.com/licenses/mit/).

# Contact
For questions or comments about this project please contact the author goruck (Lindo St. Angel) at {lindostangel} AT {gmail} DOT {com}.

# Acknowledgements
The alarm uploader was inspired by Brian Roy's [Zoneminder-Alert-Image-Upload-to-Amazon-S3](https://github.com/briantroy/Zoneminder-Alert-Image-Upload-to-Amazon-S3). The general approach of triggering an AWS Step function by an image uploaded to S3 to be analyzed by Rekognition was modeled after Mark West's [smart-security-camera](https://github.com/markwest1972/smart-security-camera).

Thank you Brian and Mark!

# Appendix

## Sample console output from zm-s3-upload.

```text
info: Ready for new alarm frames...
info: 19 un-uploaded frames found in: 36 milliseconds
info: Running with local object detection enabled.
info: Running with local face det / rec enabled.
info: Processed /nvr/zoneminder/events/PlayroomDoor/18/08/16/19/20/00/00873-capture.jpg
info: Image labels: { Confidence: 0.9994339346885681,
  Name: 'person',
  Box: 
   { ymin: 257.41777896881104,
     xmin: 850.916862487793,
     ymax: 773.3503174781799,
     xmax: 1038.574333190918 },
  Face: 'nico_st_angel' }
info: Skipped processing of /nvr/zoneminder/events/PlayroomDoor/18/08/16/19/20/00/00874-capture.jpg
info: Processed /nvr/zoneminder/events/PlayroomDoor/18/08/16/19/20/00/00875-capture.jpg
info: Image labels: { Confidence: 0.9996906518936157,
  Name: 'person',
  Box: 
   { ymin: 250.09660363197327,
     xmin: 836.7828941345215,
     ymax: 774.9302244186401,
     xmax: 1083.0389785766602 },
  Face: 'nico_st_angel' }
info: Skipped processing of /nvr/zoneminder/events/PlayroomDoor/18/08/16/19/20/00/00877-capture.jpg
info: Processed /nvr/zoneminder/events/PlayroomDoor/18/08/16/19/20/00/00878-capture.jpg
info: Image labels: { Confidence: 0.9991200566291809,
  Name: 'person',
  Box: 
   { ymin: 393.3701455593109,
     xmin: 781.582088470459,
     ymax: 956.7480111122131,
     xmax: 1079.7370147705078 },
  Face: 'nico_st_angel' }
info: Skipped processing of /nvr/zoneminder/events/PlayroomDoor/18/08/16/19/20/00/00879-capture.jpg
info: Processed /nvr/zoneminder/events/PlayroomDoor/18/08/16/19/20/00/00880-capture.jpg
info: Image labels: { Confidence: 0.9997510313987732,
  Name: 'person',
  Box: 
   { ymin: 531.6450262069702,
     xmin: 635.1659774780273,
     ymax: 1060.2527403831482,
     xmax: 1027.7736282348633 },
  Face: 'nikki_st_angel' }
info: Skipped processing of /nvr/zoneminder/events/PlayroomDoor/18/08/16/19/20/00/00881-capture.jpg
info: Processed /nvr/zoneminder/events/PlayroomDoor/18/08/16/19/20/00/00882-capture.jpg
info: Image labels: { Confidence: 0.9932160973548889,
  Name: 'person',
  Box: 
   { ymin: 687.431845664978,
     xmin: 711.1233901977539,
     ymax: 1071.694142818451,
     xmax: 1208.5906219482422 },
  Face: 'Unknown' }
info: Skipped processing of /nvr/zoneminder/events/PlayroomDoor/18/08/16/19/20/00/00883-capture.jpg
info: The file: /nvr/zoneminder/events/PlayroomDoor/18/08/16/19/20/00/00873-capture.jpg will be saved to: PlayroomDoor/2018-8-16/hour-19/New_Event-ID_545949-Frame_873-19-27-8-700.jpg
info: The file: /nvr/zoneminder/events/PlayroomDoor/18/08/16/19/20/00/00878-capture.jpg will be saved to: PlayroomDoor/2018-8-16/hour-19/New_Event-ID_545949-Frame_878-19-27-11-310.jpg
info: The file: /nvr/zoneminder/events/PlayroomDoor/18/08/16/19/20/00/00880-capture.jpg will be saved to: PlayroomDoor/2018-8-16/hour-19/New_Event-ID_545949-Frame_880-19-27-12-360.jpg
info: The file: /nvr/zoneminder/events/PlayroomDoor/18/08/16/19/20/00/00882-capture.jpg will be saved to: PlayroomDoor/2018-8-16/hour-19/New_Event-ID_545949-Frame_882-19-27-13-410.jpg
info: The file: /nvr/zoneminder/events/PlayroomDoor/18/08/16/19/20/00/00875-capture.jpg will be saved to: PlayroomDoor/2018-8-16/hour-19/New_Event-ID_545949-Frame_875-19-27-9-750.jpg
info: Wrote 10 docs to mongodb.
info: 10 image(s) have been processed.


```
