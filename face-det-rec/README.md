# face-det-rec
The Face Detection and Recognition Server, [face_detect_server.py](./face_detect_server.py), runs the dlib face detection and recognition engine using Python APIs and employees [zerorpc](http://www.zerorpc.io/) to communicate with the Alarm Uploader. One of the benefits of using zerorpc is that the object detection server can easily be run on another machine, apart from the machine running ZoneMinder (e.g. when using the tpu version of this program). Face Detection and Recognition Server is run as a Linux service using systemd.

Thanks to Adrian Rosebrock and his [pyimagesearch project](https://www.pyimagesearch.com/) for the inspiration and some of the code used in this section!

# Installation
1. Clone this git repo to your local machine running Zoneminder and cd to it.

2. Install the face recognition libraries using this [guide](https://www.pyimagesearch.com/2018/06/18/face-recognition-with-opencv-python-and-deep-learning/).

3. Create a python virtual environment called 'cv' and install all required packages using the requirements.txt file in this directory. 

4. Create a directory for each person's face images that you want recognized, named for the person's face, in a directory called "dataset". Also create a directory called 'Unknown' that will hold faces of random strangers that is needed for the training of the [SVM](https://scikit-learn.org/stable/modules/svm.html) or [XGBoost](https://xgboost.readthedocs.io/en/latest/index.html) face classifier.

5. Place 20 or so images of the person's face in each directory you created above plus about 20 random stranger faces in the 'Unknown' folder (see note 5 below).

6. Run the face encoder program, [encode_faces.py](./encode_faces.py), using the images in the directories created above. See the "Encoding the faces using OpenCV and deep learning" in the guide mentioned above.

7. Run the face classifier training program, [train.py](./train.py), which will train both SVM and XGBoost algorithms that are used as face classifiers.

9. Edit the [config.json](./config.json) to suit your installation, including the choice of the SVM or XGBoost face classifier. The configuration parameters are documented in [face_detect_server.py](face_detect_server.py).

10. Create the file '/tmp/face_det_zmq.pipe' for an IPC socket that the zerorpc client and server will communicate over. This assumes that the face detection server and ZoneMinder are running on the same machine. If not, then use a TCP socket.

11. Use systemd to run the Face Detection and Recognition Server as a Linux service. Edit [face-detect.service](./face-detect.service) to suit your configuration and copy the file to /etc/systemd/system. Then enable and start the service:
```bash
$ sudo systemctl enable face-detect.service && sudo systemctl start face-detect.service
```
# Notes
1. Use [extract_faces.py](./extract_faces.py) to extract faces and / or people from objects in training images that can be used to fit the face classifier algorithm. I found that the face encoder program, [encode_faces.py](./encode_faces.py), works better on images that contain faces that have not been cropped from the person. This is why the default for [extract_faces.py](./extract_faces.py) is to save the person object and not the face. The person objects should be used to encode faces from per step 6 above.
2. Use [renumber_filenames.py](renumber_filenames.py) to sequentially number the face images used for training. 
3. Use [view-mongo-images.py](view-mongo-images.py) to quickly test different combinations of face detection parameters for optimization purposes.
4. I found the XGBoost-based face classifier performs somewhat better than the SVM-based one but is tricker and requires much more compute to optimize its hyperparameters. Your performance may be different but strive for at least 20 images (more is better) per face to train the model and use faces actually captured from your cameras.
5. Use [fetch_lfw_faces.py](fetch_lfw_faces.py) to download random faces from the Labeled Faces in the Wild (LFW) people dataset that you can place in the 'Unknown' folder. 