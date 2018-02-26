# zm-s3-upload
Uploads ZoneMinder alarm frames to an AWS S3 bucket. Inspired by and based on Brian Roy's original [work](https://github.com/briantroy/Zoneminder-Alert-Image-Upload-to-Amazon-S3).

# Installation
1. Clone this git repo to local machine running Zoneminder and cd to it. 
2. Run npm install to fetch dependencies.
3. Modify configuration files per your ZoneMinder installation.
4. Run mysql script to create upload table:
```bash
shell> mysql -uUSER -pPASS zm < zms3db.sql > output.txt
```
5. Start uploader (should be run as a daemon):
```bash
shell> node zm-s3-upload.js
```
