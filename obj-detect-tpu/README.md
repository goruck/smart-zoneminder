# obj-detect-tpu
The TPU Object Detection Server, obj_detect_server_tpu.py, runs [TPU-based](https://cloud.google.com/edge-tpu/) Tensorflow Lite inference engines using the [Google Coral](https://coral.withgoogle.com/) Python APIs and employees [zerorpc](http://www.zerorpc.io/) to communicate with the Alarm Uploader. One of the benefits of using zerorpc is that the object detection server can easily be run on another machine, apart from the machine running ZoneMinder (in this case a [Coral Dev Board](https://coral.withgoogle.com/products/dev-board/)). The server can optionally skip inference on consecutive ZoneMinder Alarm frames to minimize processing time which obviously assumes the same object is in every frame. The TPU Object Detection Server is run as a Linux service using systemd.

# Installation
1. Clone this git repo to a directory on the Google Coral Dev Board. You should do so using an SD card on the dev board and install all files there since the on board disk space is pretty small. I did this and mounted a 64GB SD card at ```/media/mendel```. 

2. Edit the [config.json](./config.json) to suit your installation. The configuration parameters are documented in obj_detect_server_tpu.py. Since the TPU object detection server and ZoneMinder are running on different machines make sure both are using the same TCP socket.

3. Use systemd to run the Object Detection Server as a Linux service. Edit [obj-detect-tpu.service](../scripts/obj-detect-tpu.service) to suit your configuration and copy the file to /etc/systemd/system. Then enable the service:
```bash
$ sudo systemctl enable obj-detect-tpu.service
```