# face-det-rec
The Face Detection and Recognition module, [face-det-rec](https://github.com/goruck/smart-zoneminder/tree/master/face-det-rec) is run as a Python program from the Alarm Uploader and it uses dlib and the face_recognition API as described in the main README. You need to first encode examples of faces you want recognized by using another program in the same directory.

Thanks to Adrian Rosebrock and his [pyimagesearch project](https://www.pyimagesearch.com/) for the inspiration and much of the code used in this section!

# Installation
1. Clone this git repo to your local machine running Zoneminder and cd to it.

2. Install the face recognition libraries using this [guide](https://www.pyimagesearch.com/2018/06/18/face-recognition-with-opencv-python-and-deep-learning/).

2. Create a directory for each person's face images that you want recognized, named for the person's face, in a directory called "dataset". 

3. Place 20 or so images of the person's face in each directory you created above.

4. Run the face encoder program, encode_faces.py, using the images in the directories created above. See the "Encoding the faces using OpenCV and deep learning" in the guide mentioned above. 

Note: the requirements.txt file in this repo is for reference only as it reflects the virtualenv configuration. Do not use it to install dependencies in the local directory via pip. Use the guide above instead to install dependencies in your own virtualenv. 