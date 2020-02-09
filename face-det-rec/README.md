# face-det-rec
The Face Detection and Recognition Server, [face_detect_server.py](./face_detect_server.py), runs the dlib face detection and recognition engine using Python APIs and employees [zerorpc](http://www.zerorpc.io/) to communicate with the Alarm Uploader. One of the benefits of using zerorpc is that the object detection server can easily be run on another machine, apart from the machine running ZoneMinder (e.g. when using the tpu version of this program). Face Detection and Recognition Server is run as a Linux service using systemd.

Thanks to Adrian Rosebrock and his [pyimagesearch project](https://www.pyimagesearch.com/) for the inspiration and some of the code used in this section!

# Installation
1. Clone this git repo to your local machine running Zoneminder and cd to it.

2. Install the machine learning platform on the Linux server per the steps described [here](../README.md). The required Python packages used by the installation are listed in [ml_requirements.txt](../ml-requirements.txt).

3. Create a directory for each person's face images that you want recognized, named for the person's face, in a directory called "dataset". Also create a directory called 'Unknown' that will hold faces of random strangers that is needed for the training of the [SVM](https://scikit-learn.org/stable/modules/svm.html) or [XGBoost](https://xgboost.readthedocs.io/en/latest/index.html) face classifier.

4. Place 20 or so images (more is better) of the person's face in each directory you created above plus about 20 random stranger faces in the 'Unknown' folder (see notes below).

5. Run the face encoder program, [encode_faces.py](./encode_faces.py), using the images in the directories created above. See the "Encoding the faces using OpenCV and deep learning" in the guide mentioned above.

6. Run the face classifier training program, [train.py](./train.py), which will train both SVM and XGBoost algorithms that are used as face classifiers.

7. Edit the [config.json](./config.json) to suit your installation, including the choice of the SVM or XGBoost face classifier. The configuration parameters are documented in [face_detect_server.py](face_detect_server.py).

8. Create the file ```/tmp/face_det_zmq.pipe``` for an IPC socket that the zerorpc client and server will communicate over. This assumes that the face detection server and ZoneMinder are running on the same machine. If not, then use a TCP socket.

9. Use systemd to run the Face Detection and Recognition Server as a Linux service. Edit [face-detect.service](./face-detect.service) to suit your configuration and copy the file to /etc/systemd/system. Then enable and start the service:
```bash
$ sudo systemctl enable face-detect.service && sudo systemctl start face-detect.service
```
# Notes
1. Use [extract_faces.py](./extract_faces.py) to extract faces and / or people from objects in training images that can be used to fit the face classifier algorithm. I found that the face encoder program, [encode_faces.py](./encode_faces.py), works better on images that contain faces that have not been cropped from the person. This is why the default for [extract_faces.py](./extract_faces.py) is to save the person object and not the face. The person objects should be used to encode faces from per the step above.

2. Use [renumber_filenames.py](renumber_filenames.py) to sequentially number the face images used for training. 

3. Use [view-mongo-images.py](view-mongo-images.py) to quickly test different combinations of face detection parameters for optimization purposes.

4. I found the XGBoost-based face classifier performs somewhat worse than the SVM-based one and is tricker and requires much more compute to optimize its hyperparameters. Your performance may be different but strive for at least 20 images (many more is better) per face to train the model and use faces actually captured from your cameras.

5. Use [fetch_lfw_faces.py](fetch_lfw_faces.py) to download random faces from the Labeled Faces in the Wild (LFW) people dataset that you can place in the 'Unknown' folder.

6. Use [s3_extract_save.py](./s3_extract_save.py) to download images from an S3 bucket that typically will contain smart-zoneminder uploaded alarm frames. These can be used for training the face recognition and [person classifier](../person-class) algorithms. Best results are obtained by training an algorithm with images that have been processed by a different algorithm. For example, train the person classifier with images that have been processed by the face recognizer (or vice-versa).

7. The face detection and recognition algorithms used here perform very well when most of a person's face is visible in the image. However they tend to generate false positives when, for example, only a side of the face is visible. This was the motivation for developing an alternative approach, [person-class](../person-class), that potentially could be more robust. 