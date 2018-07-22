# obj-detect
The Object Detection Server, [obj_detect_server.py](https://github.com/goruck/smart-zoneminder/blob/master/obj-detect/obj_detect_server.py), runs the Tensorflow object detection inference engine using Python APIs and employees [zerorpc](http://www.zerorpc.io/) to communicate with the Alarm Uploader. One of the benefits of using zerorpc is that the object detection server can easily be run on another machine, apart from the machine running ZoneMinder. The server can optionally skip inference on consecutive ZoneMinder Alarm frames to minimize processing time which obviously assumes the same object is in every frame. The Object Detection Server is started by a cron job at boot time.

# Installation
1. Clone this git repo to your local machine running Zoneminder and cd to it.

2. Fetch dependencies.
```bash
$ pip3 install --user -r requirements.txt
```

3. Create the file '/tmp/zmq.pipe' for an IPC socket that the zerorpc client and server will communicate over. This assumes that the object detection server and ZoneMinder are running on the same machine. If not, then use a TCP socket. 

4. Edit the [config.json](https://github.com/goruck/smart-zoneminder/blob/master/obj-detect/config.json) to suit your installation. The configuration parameters are documented in the obj_detect_server.py file.

5. obj_detect_server.py must be run in the Tensorflow python virtual environment that was setup previously. Here's a command line example of how to do this (adjust path for your installation):
```bash
$ /home/lindo/develop/tensorflow/bin/python3.6 ./obj_detect_server.py
```
