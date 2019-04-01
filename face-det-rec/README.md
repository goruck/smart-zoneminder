# face-det-rec
The Face Detection and Recognition Server, [face_detect_server.py](./face_detect_server.py), runs the dlib face detection and recognition engine using Python APIs and employees [zerorpc](http://www.zerorpc.io/) to communicate with the Alarm Uploader. One of the benefits of using zerorpc is that the object detection server can easily be run on another machine, apart from the machine running ZoneMinder (e.g. when using the tpu version of this program). Face Detection and Recognition Server is run as a Linux service using systemd.

Thanks to Adrian Rosebrock and his [pyimagesearch project](https://www.pyimagesearch.com/) for the inspiration and much of the code used in this section!

# Installation
1. Clone this git repo to your local machine running Zoneminder and cd to it.

2. Install the face recognition libraries using this [guide](https://www.pyimagesearch.com/2018/06/18/face-recognition-with-opencv-python-and-deep-learning/).

3. Create a python virtual environment called 'cv' and install all required packages using the requirements.txt file in this directory. 

4. Create a directory for each person's face images that you want recognized, named for the person's face, in a directory called "dataset". Also create a directory called 'Unknown' that will hold faces of random strangers that is needed for the training of the svm face classifier (you can skip this if you aren't going to use an svm).

5. Place 20 or so images of the person's face in each directory you created above plus about 20 random stranger faces in the 'Unknown' folder.

6. Run the face encoder program, encode_faces.py, using the images in the directories created above. See the "Encoding the faces using OpenCV and deep learning" in the guide mentioned above.

7. Run the svm-based face classifier training program, train.py.

9. Edit the [config.json](./config.json) to suit your installation. The configuration parameters are documented in face_detect_server.py.

10. Create the file '/tmp/face_det_zmq.pipe' for an IPC socket that the zerorpc client and server will communicate over. This assumes that the face detection server and ZoneMinder are running on the same machine. If not, then use a TCP socket.

11. Use systemd to run the Object Detection Server as a Linux service. Edit [face-detect.service](../scripts/face-detect.service) to suit your configuration and copy the file to /etc/systemd/system. Then enable the service:
```bash
$ sudo systemctl enable face-detect.service
```

Note: the requirements.txt file in this repo is for reference only as it reflects the virtualenv configuration. Do not use it to install dependencies in the local directory via pip. Use the guide above instead to install dependencies in your own virtualenv. 