*Readme under construction*

# smart-zoneminder
smart-zoneminder enables fast upload of ZoneMinder alarms to an S3 archive where they are analyzed by AWS Rekognition and made accessible by voice via Alexa. The use of Rekognition dramatically reduces the number of false alarms and provides for robust scene, object and face detection. Alexa allows a user to ask to see an image corresponding to an alarm (if using an Echo device with a display) and to get information on what caused the alarm and when it occurred.

# Acknowledgements
The alarm uploader was inspired by Brian Roy's [Zoneminder-Alert-Image-Upload-to-Amazon-S3](https://github.com/briantroy/Zoneminder-Alert-Image-Upload-to-Amazon-S3). The general approach of triggering an AWS Step function by an image uploaded to S3 to be analyzed by Rekognition was modeled after Mark West's [smart-security-camera](https://github.com/markwest1972/smart-security-camera).

Thank you Brian and Mark!

# Project Requirements

# System Architecture

# ZoneMinder Configuration

# Alarm Uploader

# AWS Step

# AWS Rekognition

# S3 Archiver

# DynamoDB

# Alexa Skill VUI and User Interaction Examples

# License
Everything here is licensed under the [MIT license](https://choosealicense.com/licenses/mit/).

# Contact
For questions or comments about this project please contact the author goruck (Lindo St. Angel) at {lindostangel} AT {gmail} DOT {com}.

# Appendix
