# person-class
The Person Classification Server, [person_classifier_server.py](./person_classifier_server.py), runs a TensorFlow deep convolutional neural network (CNN)-based person classifier using Python APIs and employees [zerorpc](http://www.zerorpc.io/) to communicate with the Alarm Uploader. One of the benefits of using zerorpc is that the server can easily be run on another machine, apart from the machine running ZoneMinder. The Person Classification Server is run as a Linux service using systemd.

This server uses a fine-tuned CNN to classify that a person object detected by the [Object Detection Server](../obj-detect/obj_detect_server.py) is member of my family or a stranger. It is an alternative to [face_detect_server.py](../face-det-rec/face_detect_server.py) and so one or the other must be run but not both. [face-det-rec](../face-det-rec) includes shallow learning methods (SVM or XGBoost classifiers) in the final stage of a pipeline to recognize faces in alarm images. CNNs have been shown to outperform shallow learning methods for many computer vision tasks given sufficient training data; this was the main motivation for developing person-class. 

# Installation
1. Clone this git repo to your local machine running ZoneMinder and cd to it.

2. Create a python virtual environment called 'od' and install all required packages using the requirements.txt file in this directory. If you have already created 'od' as part of installing [obj-detect](../obj-detect) you can skip this step. 

3. Create a folder called ```dataset``` with ```train```, ```test```, and ```valdation``` subfolders.

4. In each of the subfolders above, create subfolders for each person of interest. The name of these folders will be the labels for training, validation and test.

5. Run [move_files.py](./move_files.py) to copy files from the face-dec-rec dataset to the subfolders above. The program will split the dataset into training/validation/test sets (current default is 90/10/0).

6. Run [train.py](./train.py) to fine-tune a CNN (ResNetInceptionV2 and VGG16 are currently supported) from the images contained in ```dataset```. This program can also generate an inference-optimized TensorFlow model. Run ```$python3 ./train.py -h``` for command line options. 

7. Modify [config.json](./config.json) to suit your installation.

8. Create the file ```/tmp/face_det_zmq.pipe``` for an IPC socket that the zerorpc client and server will communicate over. This assumes that the person classification server and ZoneMinder are running on the same machine. If not, then use a TCP socket. If you have already created this as part of the [face-det-rec](../face-det-rec) installation you can skip this step. 

9. Use systemd to run the Person Classification Server as a Linux service. Edit [person-class.service](./person-class.service) to suit your configuration and copy the file to /etc/systemd/system. Then enable and start the service but first disable the face-detect.service (since only one of the two can run at the same time):
```bash
$ sudo systemctl stop face-detect.service && sudo systemctl disable face-detect.service
$ sudo systemctl enable person-class.service && sudo systemctl start person-class.service
```

# Notes
TBA