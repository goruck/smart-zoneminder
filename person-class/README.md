***This section is under construction***

# person-class
The Person Classification Server, [person_classifier_server.py](./person_classifier_server.py), runs a TensorFlow cnn-based person classifier using Python APIs and employees [zerorpc](http://www.zerorpc.io/) to communicate with the Alarm Uploader. One of the benefits of using zerorpc is that the server can easily be run on another machine, apart from the machine running ZoneMinder (e.g. when using the tpu version of this program). The Person Classification Server is run as a Linux service using systemd.

This server uses a cnn to classify that a person object detected by the [Object Detection Server](../obj-detect/obj_detect_server.py) is member of my family or a stranger. It is an alternative to [face_detect_server.py](../face-det-rec/face_detect_server.py) and so one or the other must be run but not both.

# Installation
1. Create a folder called ```dataset``` with ```train```, ```test```, and ```valdation``` subfolders.

2. In each of the subfolders above, create subfolders for each person of interest. The name of these folders will be the labels for training.

3. Run [move_files.py](./move_files.py) to copy files from the face-dec-rec dataset to the subfolders above. The program will split the dataset into 80/10/10 training/validation/test sets.

4. Run [train.py](./train.py) to fine-tune a CNN from the images contained in ```dataset```. 

5. Run [keras_to_tensorflow.py](keras_to_tensorflow/keras_to_tensorflow.py) to convert the keras ```.h5``` model generated from the step above to a tensorflow ```.pb``` model that is optimized for inference.

6. Modify [config.json](./config.json) to suit your installation.

7. Use systemd to run the Person Classification Server as a Linux service. Edit [person-class.service](./person-class.service) to suit your configuration and copy the file to /etc/systemd/system. Then enable and start the service but first disable the face-detect.service (since only one of the two can run at the same time):
```bash
$ sudo systemctl stop face-detect.service && sudo systemctl disable face-detect.service
$ sudo systemctl enable person-class.service && sudo systemctl start person-class.service
```

# Notes
TBA