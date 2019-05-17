'''
Find faces in given images and encode into 128-D embeddings. 

Usage:
$ python3 encode_faces.py --dataset dataset --encodings encodings.pickle

Part of the smart-zoneminder project:
See https://github.com/goruck/smart-zoneminder.

Copyright (c) 2019 Lindo St. Angel
'''

import numpy as np
import argparse
import pickle
import cv2
from glob import glob
from os.path import sep
from edgetpu.detection.engine import DetectionEngine

print("[INFO] quantifying faces...")

# Construct the argument parser and parse the arguments.
ap = argparse.ArgumentParser()
ap.add_argument("-i", "--dataset", required=True,
    help="path to input directory of faces + images")
ap.add_argument("-e", "--encodings", required=True,
    help="name of serialized output file of facial encodings")
args = vars(ap.parse_args())

DET_MODEL_PATH = './mobilenet_ssd_v2_face_quant_postprocess_edgetpu.tflite'
EMB_MODEL_PATH = './nn4.v2.t7'

# Grab the paths to the input images in our dataset.
imagePaths = glob(args['dataset'] + '/**/*.*', recursive=True)

# initialize the list of known encodings and known names
knownEncodings = []
knownNames = []

# Init tpu engine.
face_engine = DetectionEngine(DET_MODEL_PATH)

# Init OpenCV's deep learning face embedding model.
embedder = cv2.dnn.readNetFromTorch(EMB_MODEL_PATH)

# Loop over the image paths.
# NB: Its assumed that only one face is in each image.
for (i, imagePath) in enumerate(imagePaths):
    print('[INFO] processing image {}/{}'.format(i + 1,
        len(imagePaths)))

    # extract the person name from the image path
    name = imagePath.split(sep)[-2]

    # Load the input image.
    image = cv2.imread(imagePath)
    (h, w) = image.shape[:2]
    if h == 0 or w == 0:
        print('*** image size zero! ***')
        continue

    # Resize roi for face detection.
    # The tpu face det requires (320, 320).
    res = cv2.resize(image, dsize=(320, 320), interpolation=cv2.INTER_CUBIC)
    #cv2.imwrite('./res.jpg', res)

    # Detect the (x, y)-coordinates of the bounding boxes corresponding
    # to each face in the input image using the TPU engine.
    # NB: reshape(-1) converts the res ndarray into 1-d.
    detection = face_engine.DetectWithInputTensor(input_tensor=res.reshape(-1),
        threshold=0.9, top_k=1)
    if not detection:
        print('*** no face found! ***')
        continue

    # Convert coords and carve out face roi.
    # Its assumed that only one face is in each image so take detection[0]
    (h, w) = res.shape[:2]
    box = (detection[0].bounding_box.flatten().tolist()) * np.array([w, h, w, h])
    (face_left, face_top, face_right, face_bottom) = box.astype('int')
    face_roi = image[face_top:face_bottom, face_left:face_right, :]
    img_name = './face_roi{}.jpg'.format(i)
    cv2.imwrite(img_name, face_roi)
    (h, w) = face_roi.shape[:2]
    if h == 0 or w == 0:
        print('*** face roi zero! ***')
        continue

    # Compute the facial embedding for the face.
    # Construct a blob for the face ROI, then pass the blob
    # through the face embedding model to obtain the 128-d
    # quantification of the face.
    faceBlob = cv2.dnn.blobFromImage(
        face_roi, 1.0 / 255, (96, 96), (0, 0, 0), swapRB=True, crop=False)
    embedder.setInput(faceBlob)
    encoding = embedder.forward()[0]
    #print(encoding)

    # Add encoding and name to set of known names and encodings.
    knownEncodings.append(encoding)
    knownNames.append(name)

# Dump the facial encodings + names to disk.
print("[INFO] serializing encodings...")
data = {"encodings": knownEncodings, "names": knownNames}
f = open(args["encodings"], "wb")
f.write(pickle.dumps(data))
f.close()