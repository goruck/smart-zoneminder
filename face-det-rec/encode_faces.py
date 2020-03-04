'''
Find faces in given images and encode into 128-D embeddings. 

Usage:
$ python3 encode_faces.py --dataset dataset --encodings encodings.pickle

Part of the smart-zoneminder project:
See https://github.com/goruck/smart-zoneminder.

Copyright (c) 2018~2020 Lindo St. Angel
'''

import face_recognition
import argparse
import pickle
import cv2
from os.path import sep
from glob import glob

# Height and / or width to resize all faces to.
FACE_HEIGHT = None
FACE_WIDTH = None
# Jitters for dlib. 
NUM_JITTERS = 500
# Alternative labling of images.
USE_ALT = False
ALT_SUBFOLDER = 'no_faces'
ALT_LABEL = 'Unknown'

print('\n quantifying faces...')

# Construct the argument parser and parse the arguments.
ap = argparse.ArgumentParser()
ap.add_argument('-i', '--dataset', required=True,
    help='path to input directory of faces + images')
ap.add_argument('-e', '--encodings', required=True,
    help='name of serialized output file of facial encodings')
ap.add_argument('-d', '--detection-method', type=str, default='cnn',
    help='face detection model to use: either `hog` or `cnn`')
args = vars(ap.parse_args())

def image_resize(image, width = None, height = None, inter = cv2.INTER_AREA):
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
    resized = cv2.resize(image, dim, interpolation = inter)

    # return the resized image
    return resized

# Grab the paths to the input images in our dataset.
imagePaths = glob(args['dataset'] + '/**/*.*', recursive=True)

# Initialize the list of known encodings and known names
knownEncodings = []
knownNames = []

# Loop over the image paths.
# NB: Its assumed that only one face is in each image.
not_encoded = 0
encoded = 0
for (i, imagePath) in enumerate(imagePaths):
    print('processing image {}/{}'.format(i + 1, len(imagePaths)))

    # Extract the person name from the image path.
    name = imagePath.split(sep)[-2]
     # if alt subfolder name is found...
    if name == ALT_SUBFOLDER:
        if USE_ALT: # ...label as alt
            name = ALT_LABEL
        else: # ...label as parent folder name
            name = imagePath.split(sep)[-3]

    # Load the input image.
    image = cv2.imread(imagePath)

    # Resize image
    # and convert it from BGR (OpenCV ordering)
    # to dlib ordering (RGB).
    resized = image_resize(image, height=FACE_HEIGHT, width=FACE_WIDTH)
    rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
    #(height, width) = rgb.shape[:2]
    #print('face height {} width {}'.format(height, width))
    #cv2.imwrite('./face_rgb.jpg', rgb)

    # Detect the (x, y)-coordinates of the bounding boxes
    # corresponding to each face in the input image.
    # Do not increase upsample beyond 1 else you'll run out of memory.
    # This is strictly not needed since its assumed the images are
    # faces but it serves as a check for faces dlib can deal with. 
    boxes = face_recognition.face_locations(img=rgb,
        number_of_times_to_upsample=1,
        model=args['detection_method'])

    if len(boxes) == 0:
        print('\n *** no face found! ***')
        print(' image {} \n'.format(imagePath))
        not_encoded += 1
        continue

    # Compute the facial embedding for the face.
    encoding = face_recognition.face_encodings(face_image=rgb,
        known_face_locations=boxes,
        num_jitters=NUM_JITTERS)[0]
    #print(encoding)

    if len(encoding) == 0:
        print('\n *** no encoding! *** \n')
        not_encoded += 1
        continue

    encoded += 1

    # Add each encoding + name to set of known names and
    # encodings.
    knownEncodings.append(encoding)
    knownNames.append(name)

print('\n faces encoded {} not encoded {} total {}'
    .format(encoded, not_encoded, encoded+not_encoded))

# Dump the facial encodings + names to disk.
print('\n serializing encodings')
data = {'encodings': knownEncodings, 'names': knownNames}
with open(args['encodings'], 'wb') as outfile:
    outfile.write(pickle.dumps(data))