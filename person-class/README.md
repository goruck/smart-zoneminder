***This section is under construction***

# person-class
The Person Classification Server, [person_classifier_server.py](./person_classifier_server.py), runs a TensorFlow dnn person classifier using Python APIs and employees [zerorpc](http://www.zerorpc.io/) to communicate with the Alarm Uploader. One of the benefits of using zerorpc is that the server can easily be run on another machine, apart from the machine running ZoneMinder (e.g. when using the tpu version of this program). The Person Classification Server is run as a Linux service using systemd.

This server uses a dnn to classify that a person object detected by the [Object Detection Server](../obj-detect/obj_detect_server.py) is member of my family or a stranger. It is an alternative (with higher accuracy) to [face_detect_server.py](../face-det-rec/face_detect_server.py) and so one or the other must be run but not both.

# Installation
TBA

# Notes
TBA