"""
Detect and extract people and faces in images to a directory.
Useful to gather faces for training the face recognizer. 

This is part of the smart-zoneminder project.
See https://github.com/goruck/smart-zoneminder

Copyright (c) 2019 Lindo St. Angel
"""

import cv2
import logging
import face_recognition
import zerorpc
import json
from glob import glob

logging.basicConfig(level=logging.ERROR)

NUMBER_OF_TIMES_TO_UPSAMPLE = 1
FACE_DET_MODEL = 'cnn'
# Where extracted faces are stored.
EXTRACT_DIR = '/home/lindo/develop/smart-zoneminder/face-det-rec/extracted_faces'
# Where src images are stored.
IMG_DIR = '/home/lindo/develop/smart-zoneminder/face-det-rec/train_images'
# Where a file containing image paths is stored (set to '' to skip)
TXT_FILE_PATH = '/home/lindo/develop/smart-zoneminder/face-det-rec/test-imgs.txt'
ZERORPC_PIPE = 'ipc:///tmp/obj_detect_zmq.pipe'

SAVE_FACE = False
SAVE_PERSON = True

def detect_and_extract(test_image_paths):
    # Loop over the images paths provided.
    idx = 0
    for obj in test_image_paths:
        logging.debug('**********Processing {}'.format(obj['image']))
        for label in obj['labels']:
            # If the object detected is a person...
            if label['name'] == 'person':
                # Read image from disk. 
                img = cv2.imread(obj['image'])
                if img is None:
                    # Bad image was read.
                    logging.error('Bad image was read.')
                    continue

                # Bound the roi using the coord info passed in.
                # The roi is area around person(s) detected in image.
                # (x1, y1) are the top left roi coordinates.
                # (x2, y2) are the bottom right roi coordinates.
                y2 = int(label['box']['ymin'])
                x1 = int(label['box']['xmin'])
                y1 = int(label['box']['ymax'])
                x2 = int(label['box']['xmax'])
                roi = img[y2:y1, x1:x2]
                if roi.size == 0:
                    # Bad object roi...move on to next image.
                    logging.error('Bad object roi.')
                    continue

                # Detect the (x, y)-coordinates of the bounding boxes corresponding
                # to each face in the input image.
                rgb = cv2.cvtColor(roi, cv2.COLOR_BGR2RGB)
                detection = face_recognition.face_locations(
                    rgb, NUMBER_OF_TIMES_TO_UPSAMPLE, FACE_DET_MODEL)
                if not detection:
                    # No face detected...move on to next image.
                    logging.debug('No face detected.')
                    continue

                if SAVE_FACE:
                    # Carve out and save face roi. 
                    (face_top, face_right, face_bottom, face_left) = detection[0]
                    #cv2.rectangle(rgb, (face_left, face_top), (face_right, face_bottom), (255,0,0), 2)
                    #cv2.imwrite('./face_rgb.jpg', rgb)
                    face_roi = roi[face_top:face_bottom, face_left:face_right]
                    face_img = EXTRACT_DIR+'/'+str(idx)+'-face'+'.jpg'
                    print('Writing {}'.format(face_img))
                    cv2.imwrite(face_img, face_roi)

                if SAVE_PERSON:
                    # Save extracted person object to disk.
                    obj_img = EXTRACT_DIR+'/'+str(idx)+'-obj'+'.jpg'
                    print('Writing {}'.format(obj_img))
                    cv2.imwrite(obj_img, roi)

                idx += 1
    return

# Grab the paths to the input images.
image_paths = glob(IMG_DIR + '/*.*', recursive=False)
#print(image_paths)

# Grab image paths in text file if given.
# Its assumed there is one path per line in the file.
try:
    with open(TXT_FILE_PATH, 'r') as f:
        txt_img_paths = f.read().splitlines()
except IOError:
    txt_img_paths = []

# Send images to object detect server.
obj_det = zerorpc.Client(heartbeat=60000)
obj_det.connect(ZERORPC_PIPE)
obj_ans = obj_det.detect_objects(image_paths + txt_img_paths)

# Send detected objects to face detector and extractor.
# (first deserialize json to Python objects)
detect_and_extract(json.loads(obj_ans))