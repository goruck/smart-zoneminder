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
import argparse
from glob import glob

logging.basicConfig(level=logging.INFO)

# Construct the argument parser and parse the arguments.
ap = argparse.ArgumentParser()
ap.add_argument('-sf', '--save_face', type=bool, default=False,
    help='save detected faces (defaults to False')
ap.add_argument('-spf', '--save_person_face', type=bool, default=True,
    help='save detected people with faces (defaults to True)')
ap.add_argument('-spnf', '--save_person_no_face', type=bool, default=False,
    help='save detected people with no faces (defaults to False')
ap.add_argument('-d', '--dataset', type=str,
    default='/home/lindo/develop/smart-zoneminder/face-det-rec/train_images',
    help='location of input dataset (defaults to ./train_images.')
ap.add_argument('-o', '--output', type=str, default='./extracted_faces',
    help='location of output folder (defaults to ./extracted_faces).')
ap.add_argument('-f', '--file_path', type=str, default=None,
    help='location of file containing image paths (defaults to None)')
args = vars(ap.parse_args())

NUMBER_OF_TIMES_TO_UPSAMPLE = 1
FACE_DET_MODEL = 'cnn'
ZERORPC_PIPE = 'ipc:///tmp/obj_detect_zmq.pipe'

def image_resize(image, width=None, height=None, inter=cv2.INTER_AREA):
    # ref: https://stackoverflow.com/questions/44650888/resize-an-image-without-distortion-opencv

    # initialize the dimensions of the image to be resized and
    # grab the image size
    dim = None
    (h, w) = image.shape[:2]

    # if both the width and height are None, then return the
    # original image
    if width is None and height is None:
        return image

    # check to see if the width is None
    if width is None:
        # calculate the ratio of the height and construct the
        # dimensions
        r = height / float(h)
        dim = (int(w * r), height)

    # otherwise, the height is None
    else:
        # calculate the ratio of the width and construct the
        # dimensions
        r = width / float(w)
        dim = (width, int(h * r))

    # resize the image
    resized = cv2.resize(image, dim, interpolation=inter)

    # return the resized image
    return resized

def detect_and_extract(test_image_paths):
    # Loop over the images paths provided.
    idx = 1
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

                # Resize all images to have width = 300 pixels. 
                roi = image_resize(roi, width=300)

                # Detect the (x, y)-coordinates of the bounding boxes corresponding
                # to each face in the input image.
                rgb = cv2.cvtColor(roi, cv2.COLOR_BGR2RGB)
                detection = face_recognition.face_locations(
                    rgb, NUMBER_OF_TIMES_TO_UPSAMPLE, FACE_DET_MODEL)
                if not detection:
                    # No face detected.
                    logging.debug('No face detected.')
                    if args['save_person_no_face']:
                        # Save extracted person (w/o face) object to disk.
                        obj_img = args['output']+'/'+str(idx)+'-obj'+'.jpg'
                        logging.info('Writing {}'.format(obj_img))
                        cv2.imwrite(obj_img, roi)
                        idx += 1
                    continue

                if args['save_face']:
                    # Carve out and save face roi. 
                    (face_top, face_right, face_bottom, face_left) = detection[0]
                    #cv2.rectangle(rgb, (face_left, face_top), (face_right, face_bottom), (255,0,0), 2)
                    #cv2.imwrite('./face_rgb.jpg', rgb)
                    face_roi = roi[face_top:face_bottom, face_left:face_right]
                    face_img = args['output']+'/'+str(idx)+'-face'+'.jpg'
                    logging.info('Writing {}'.format(face_img))
                    cv2.imwrite(face_img, face_roi)

                if args['save_person_face']:
                    # Save extracted person (w/face) object to disk.
                    obj_img = args['output']+'/'+str(idx)+'-obj'+'.jpg'
                    logging.info('Writing {}'.format(obj_img))
                    cv2.imwrite(obj_img, roi)

                idx += 1
    return

# Grab the paths to the input images.
image_paths = glob(args['dataset'] + '/*.*', recursive=False)
logging.debug('image_paths: {}'.format(image_paths))

# Grab image paths in text file if given.
# Its assumed there is one path per line in the file.
try:
    with open(args['file_path'], 'r') as f:
        txt_img_paths = f.read().splitlines()
except (IOError, TypeError) as e:
    txt_img_paths = []

# Send images to object detect server.
obj_det = zerorpc.Client(heartbeat=60000)
obj_det.connect(ZERORPC_PIPE)
obj_ans = obj_det.detect_objects(image_paths + txt_img_paths)

# Send detected objects to face detector and extractor.
# (first deserialize json to Python objects)
detect_and_extract(json.loads(obj_ans))