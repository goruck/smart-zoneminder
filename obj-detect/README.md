# obj-detect
The Object Detection Server, [obj_detect_server.py](https://github.com/goruck/smart-zoneminder/blob/master/obj-detect/obj_detect_server.py), runs the Tensorflow object detection inference engine using Python APIs and employees [zerorpc](http://www.zerorpc.io/) to communicate with the Alarm Uploader. One of the benefits of using zerorpc is that the object detection server can easily be run on another machine, apart from the machine running ZoneMinder (e.g. when using the tpu version of this program). The server can optionally skip inference on consecutive ZoneMinder Alarm frames to minimize processing time which obviously assumes the same object is in every frame. The Object Detection Server is run as a Linux service using systemd.

# Installation
1. Clone this git repo to your local machine running ZoneMinder and cd to it.

2. Create a directory called "models" and download a Tensorflow object detection model from the [model zoo](https://github.com/tensorflow/models/blob/master/research/object_detection/g3doc/detection_model_zoo.md). Only models that have been trained with the COCO dataset are supported at this time. Note that COCO label file for these models is already in the data directory.
```bash
$ mkdir models
$ wget http://download.tensorflow.org/models/object_detection/ssd_mobilenet_v1_coco_2018_01_28.tar.gz # example download of ssd_mobilenet_v1
$ tar -xvzf ssd_mobilenet_v1_coco_2018_01_28.tar.gz
$ rm -i ssd_mobilenet_v1_coco_2018_01_28.tar.gz # optional
```

3. Edit the [config.json](https://github.com/goruck/smart-zoneminder/blob/master/obj-detect/config.json) to suit your installation. The configuration parameters are documented in obj_detect_server.py.

4. Create the file ```/tmp/obj_det_zmq.pipe``` for an IPC socket that the zerorpc client and server will communicate over. This assumes that the object detection server and ZoneMinder are running on the same machine. If not, then use a TCP socket.

5. Install the machine learning platform on the Linux server per the steps described [here](../README.md). The required Python packages used by the installation are listed in [ml_requirements.txt](../ml-requirements.txt).

6. Use ```systemd``` to run the Object Detection Server as a Linux service. Edit [obj-detect.service](./obj-detect.service) to suit your configuration and copy the file to /etc/systemd/system. Then enable and start the service:
```bash
$ sudo systemctl enable obj-detect.service && sudo systemctl start obj-detect.service
```
