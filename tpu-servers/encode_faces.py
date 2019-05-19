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
import face_recognition
from glob import glob
from os.path import sep
from edgetpu.detection.engine import DetectionEngine

print('quantifying faces...')

# Construct the argument parser and parse the arguments.
ap = argparse.ArgumentParser()
ap.add_argument('-i', '--dataset', required=True,
    help='path to input directory of faces + images')
ap.add_argument('-e', '--encodings', required=True,
    help='name of serialized output file of facial encodings')
args = vars(ap.parse_args())

# Init OpenCV's deep learning face embedding model.
EMB_MODEL_PATH = './nn4.v2.t7'
embedder = cv2.dnn.readNetFromTorch(EMB_MODEL_PATH)

# Init OpenCV's dnn face detection and localization model.
FACE_DET_PROTOTXT_PATH = './deploy.prototxt'
FACE_DET_MODEL_PATH = './res10_300x300_ssd_iter_140000_fp16.caffemodel'
face_det = cv2.dnn.readNetFromCaffe(FACE_DET_PROTOTXT_PATH, FACE_DET_MODEL_PATH)

# Init tpu engine.
DET_MODEL_PATH = './mobilenet_ssd_v2_face_quant_postprocess_edgetpu.tflite'
face_engine = DetectionEngine(DET_MODEL_PATH)

# Grab the paths to the input images in our dataset.
imagePaths = glob(args['dataset'] + '/**/*.*', recursive=True)

# Initialize the list of known encodings and known names.
knownEncodings = []
knownNames = []

def dlib_face_det(image):
    # Detect and localize faces using dlib (via face_recognition).
    # Assumes only one face is in image passed.

    # Convert image from BGR (OpenCV ordering) to dlib ordering (RGB).
    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

    # Detect the (x, y)-coordinates of the bounding boxes
    # corresponding to each face in the input image.
    # NB: model='cnn' causes OOM.
    boxes = face_recognition.face_locations(rgb,
        number_of_times_to_upsample=2, model='hog')

    if len(boxes) == 0:
        print('*** no face found! ***')
        return None

    # Return bounding box coords in dlib format.
    return boxes

def cv2_face_det(image):
    # Detect and localize faces using OpenCV dnn.
    # Assumes only one face is in image passed.

    # Threshold for valid face detect.
    CONFIDENCE_THRES = 0.9

    # Construct an input blob for the image and resize and normalize it.
    blob = cv2.dnn.blobFromImage(cv2.resize(image, (300,300)), 1.0,
        (300,300), (104.0, 177.0, 123.0))

    # Pass the blob through the network and obtain the detections and
    # predictions.
    face_det.setInput(blob)
    detections = face_det.forward()

    if len(detections) > 0:
        # We're making the assumption that each image has only ONE
        # face, so find the bounding box with the largest probability.
        pred_num = np.argmax(detections[0, 0, :, 2])
        confidence = detections[0, 0, pred_num, 2]
        print('detection confidence: {}'.format(confidence))
    else:
        print('*** no face found! ***')
        return None
        
    # Filter out weak detections by ensuring the `confidence` is
    # greater than the minimum confidence.
    if confidence > CONFIDENCE_THRES:
        # Compute the (x, y)-coordinates of the bounding box for image.
        (h, w) = image.shape[:2]
        print('img h: {} img w: {}'.format(h, w))
        box = detections[0, 0, pred_num, 3:7] * np.array([w, h, w, h])

        (face_left, face_top, face_right, face_bottom) = box.astype('int')
        #print('face_left: {} face_top: {} face_right: {} face_bottom: {}'
            #.format(face_left, face_top, face_right, face_bottom))

        # Return bounding box coords in dlib format.
        # Sometimes the dnn returns bboxes larger than image, so check.
        # If bbox too large just return bbox of whole image.
        # TODO: figure out why this happens. 
        (h, w) = image.shape[:2]
        if (face_right - face_left) > w or (face_bottom - face_top) > h:
            print('*** bbox out of bounds! ***')
            return [(0, w, h, 0)]
        else:
            return [(face_top, face_right, face_bottom, face_left)]
    else:
        print('*** no face found! ***')
        return None

def tpu_face_det(image):
    # Detect faces using TPU engine.
    # Assumes only one face is in image passed.

    # Threshold for valid face detect. 
    CONFIDENCE_THRES = 0.6
    
    # Resize image for face detection.
    # The tpu face det requires (320, 320).
    res = cv2.resize(image, dsize=(320, 320), interpolation=cv2.INTER_CUBIC)

    # Detect the (x, y)-coordinates of the bounding boxes corresponding
    # to each face in the input image using the TPU engine.
    # NB: reshape(-1) converts the res ndarray into 1-d.
    detection = face_engine.DetectWithInputTensor(input_tensor=res.reshape(-1),
        threshold=CONFIDENCE_THRES, top_k=1)

    if not detection:
        print('*** no face found! ***')
        return None

    # Convert coords and carve out face roi.
    # Its assumed that only one face is in each image so take detection[0]
    box = (detection[0].bounding_box.flatten().tolist()) * np.array([w, h, w, h])
    (face_left, face_top, face_right, face_bottom) = box.astype('int')
    #print('face_left: {} face_top: {} face_right: {} face_bottom: {}'
        #.format(face_left, face_top, face_right, face_bottom))

    # Return bounding box coords in dlib format. 
    return [(face_top, face_right, face_bottom, face_left)]

def cv2_encoder(image, boxes):
    # Encode face into a 128-D representation (embeddings) using OpenCV.
    # NB: Accuracy will be poor because face alignment is not performed first.
    # TODO: See https://www.pyimagesearch.com/2017/05/22/face-alignment-with-opencv-and-python/
    # Don't use this for now. 

    # Carve out face from bbox.
    (face_top, face_right, face_bottom, face_left) = boxes[0]
    face_roi = image[face_top:face_bottom, face_left:face_right, :]

    # Construct a blob for the image, then pass the blob
    # through the face embedding model to obtain the 128-d
    # quantification of the face.
    faceBlob = cv2.dnn.blobFromImage(
        face_roi, 1.0 / 255, (96, 96), (0, 0, 0), swapRB=True, crop=False)
    embedder.setInput(faceBlob)
    # Only one face is assumed so take the 1st element.
    encoding = embedder.forward()[0]

    return encoding

def dlib_encoder(image, boxes):
    # Encode face into a 128-D representation (embeddings) using dlib.

    # Convert image from BGR (OpenCV ordering) to dlib ordering (RGB).
    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

    # Generate encodings. Only one face is assumed so take the 1st element. 
    encoding = face_recognition.face_encodings(face_image=rgb,
        known_face_locations=boxes, num_jitters=10)[0]

    return encoding

# Loop over the image paths.
# NB: Its assumed that only one face is in each image.
for (i, imagePath) in enumerate(imagePaths):
    print('processing image {}/{}'.format(i + 1,
        len(imagePaths)))

    # extract the person name from the image path
    name = imagePath.split(sep)[-2]

    # Load the input image.
    image = cv2.imread(imagePath)
    (h, w) = image.shape[:2]
    if h == 0 or w == 0:
        print('*** image size zero! ***')
        continue

    # Find face in image.
    # The dlib method is most accurate but slow.
    # The tpu method is pretty accurate and very fast.
    # The cv2 method is somewhere in between.
    print('...finding face in image')
    boxes = tpu_face_det(image)
    #boxes = cv2_face_det(image)
    #boxes = dlib_face_det(image)
    if boxes is None:
        continue

    #(face_top, face_right, face_bottom, face_left) = boxes[0]
    #face_roi = image[face_top:face_bottom, face_left:face_right, :]
    #cv2.imwrite('./face_roi{}.jpg'.format(i), face_roi)

    # Compute the facial embedding (encoding).
    # Don't use the cv2 method for now since accuracy
    # is poor w/o face alignment. 
    # The dlib method is very accurate but relatively slow. 
    print('...encoding face')
    #encoding = cv2_encoder(image, boxes)
    encoding = dlib_encoder(image, boxes)
    #print(encoding)

    # Add encoding and name to set of known names and encodings.
    knownEncodings.append(encoding)
    knownNames.append(name)

# Dump the facial encodings + names to disk.
print('serializing encodings')
data = {'encodings': knownEncodings, 'names': knownNames}
with open(args['encodings'], 'wb') as outfile:
    outfile.write(pickle.dumps(data))