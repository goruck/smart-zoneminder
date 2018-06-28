# obj-detect
The Object Detection Server, [obj_det_server](https://github.com/goruck/smart-zoneminder/blob/master/obj-detect/obj_detect_server.py), runs the Tensorflow object detection inference engine usng the Python APIs and employees [zerorpc](http://www.zerorpc.io/) to communicate with the Alarm Uploader. It will skip inference on consecutive ZoneMinder Alarm frames to minimize processing time which obviously assumes the same object is in every frame. The Object Detection Server is started by a cron job at boot time.

# Installation
1. Clone this git repo to your local machine running Zoneminder and cd to it.
2. Fetch dependencies.
```bash
$ pip3 install -r requirements.txt
```
3. Edit obj_det_server.py and change path names in the shebang and models to suit your configuration.
```python
#!/home/lindo/develop/tensorflow/bin/python3.6

PATH_BASE = '/home/lindo/develop/tensorflow/models/research/object_detection/'
```
