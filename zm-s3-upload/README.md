# zm-s3-upload
Uploads ZoneMinder alarm frames to an AWS S3 bucket.

Inspired by and based on Brian Roy's original [work](https://github.com/briantroy/Zoneminder-Alert-Image-Upload-to-Amazon-S3).

# Installation
1. Clone this git repo to local machine running Zoneminder and cd to it. 
2. Run ```npm install``` to fetch dependencies.
3. Modify the configuration parameters in [zm-s3-upload-config.js](https://github.com/goruck/smart-zoneminder/blob/master/zm-s3-upload/zm-s3-upload-config.js) per your ZoneMinder installation.
4. Create a text file called zm-user-pass.txt with the ZoneMinder MySql username and password per your configuration.
```bash
$  printf "username\npassword\n" > zm-user-pass.txt
``` 
5. Run the [zms3db.sql](https://github.com/goruck/smart-zoneminder/blob/master/zm-s3-upload/zms3db.sql) script on your ZoneMinder mySql database to create the upload table.
```bash
$ mysql -uUSER -pPASS zm < zms3db.sql > output.txt
```
6. Start the uploader. This should be run as a daemon or cron job at startup.
```bash
$ node zm-s3-upload.js
```
