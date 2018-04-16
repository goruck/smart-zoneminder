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
6. Restart Apache.
7. Allow external access to Apache by opening the right port on your firewall. 

Also a CGI script is used to generate the clip so you also need to make sure Apache is configured to allow the CGI to be used. You should allow the CGI script only to be accessed externally via HTTPS and only with a password. I used [DIY: Enable CGI on your Apache server](https://www.techrepublic.com/blog/diy-it-guy/diy-enable-cgi-on-your-apache-server/) as a guide but only enabled the CGI to be used with the HTTPS virtual host. 

### Amazon Developers Account
You'll need an [Amazon Developers](https://developer.amazon.com/) account to use the Alexa skills I developed for this project since I haven't published them. 

### AWS Account
You'll also need an [Amazon AWS](https://aws.amazon.com/) account to run the skill's handler and the other lambda functions required for this project.

### Clone smart-zoneminder
To use smart-zoneminder you will need to clone my GitHub repo to your local machine by running `git clone https://github.com/goruck/smart-zoneminder`.

## Alarm Uploader (zm-s3-upload)
The Alarm Uploader, [zm-s3-upload](https://github.com/goruck/smart-zoneminder/tree/master/zm-s3-upload), is a node.js application running on the local server that continually monitors ZoneMinder's database for new alarm frames images and if found sends them to an S3 bucket and marks them as having been uploaded. The Alarm Uploader also attaches metadata to the alarm frame image such as alarm score, event ID, frame number, date, and others. The metadata is used later on by the cloud services to process the image. The Alarm Uploader will concurrently upload alarm frames to optimize overall upload time. The default value is ten concurrent uploads. Upload speed will vary depending on your Internet bandwidth, image size and other factors but typically frames will be uploaded to S3 in less than a few hundred milliseconds. 

Please see the Alarm Uploader's [README](https://github.com/goruck/smart-zoneminder/blob/master/zm-s3-upload/README.md) for installation instructions. 

## Alarm Clip Generator (gen-vid)
The Alarm Clip Generator, [gen-vid](https://github.com/goruck/smart-zoneminder/blob/master/cgi/gen-vid.py), is a python script run in Apache's CGI on the local server that generates an MP4 video of an alarm event given its Event ID, starting Frame ID and ending Frame ID. The script is initiated via the CGI by the Alexa skill handler and the resulting video is played back on an Echo device with a screen upon a user's request.

Please see the Alarm Clip Generator's [README](https://github.com/goruck/smart-zoneminder/blob/master/cgi/README.md) for installation instructions.

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
