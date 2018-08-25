# zm-s3-upload
This directory contains the node.js applications that upload ZoneMinder alarm frames to an AWS S3 bucket.

Inspired by Brian Roy's original [work](https://github.com/briantroy/Zoneminder-Alert-Image-Upload-to-Amazon-S3).

# Contents
1. **zm-s3-upload.js** - Main node.js application.
2. **zm-s3-upload-config.json** - configuration json.
3. **zms3db.sql** - MySql script to create alarm upload table.
4. **logger.js** - Logger app.
5. **package-lock.json** - npm package file.

# Installation
1. Clone this git repo to local machine running Zoneminder and cd to it.

2. Fetch dependencies.
```bash
$ npm install
```

3. Modify the configuration parameters in [zm-s3-upload-config.json](https://github.com/goruck/smart-zoneminder/blob/master/zm-s3-upload/zm-s3-upload-config.json) per your ZoneMinder installation. The config parameters are documented in the [zm-s3-upload.js](https://github.com/goruck/smart-zoneminder/blob/master/zm-s3-upload/zm-s3-upload.js) app.

4. Create a file called **aws-creds.json** that contains AWS S3 keys created in the step above. An example of the file contents is shown below.
```json
{
    "AWSCreds": {
        "accessKeyId": "YOUR_ACCESS_KEY",
        "secretAccessKey": "YOUR_SECRET_KET"
    }
}
```

5. Run the [zms3db.sql](https://github.com/goruck/smart-zoneminder/blob/master/zm-s3-upload/zms3db.sql) script on your ZoneMinder mySql database to create the upload table.
```bash
$ mysql -uUSER -pPASS zm < zms3db.sql > output.txt
```

5. Start the uploader after you've started the object detection server. This should be run as a daemon or cron job at startup.
```bash
$ node zm-s3-upload.js
```
