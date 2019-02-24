# USAGE
# python encode_faces.py --dataset dataset --encodings encodings.pickle

# import the necessary packages
from imutils import paths
import face_recognition
import argparse
import pickle
import cv2
import os

# construct the argument parser and parse the arguments
ap = argparse.ArgumentParser()
ap.add_argument("-i", "--dataset", required=True,
	help="path to input directory of faces + images")
ap.add_argument("-e", "--encodings", required=True,
	help="path to serialized db of facial encodings")
ap.add_argument("-d", "--detection-method", type=str, default="cnn",
	help="face detection model to use: either `hog` or `cnn`")
args = vars(ap.parse_args())

# grab the paths to the input images in our dataset
print("[INFO] quantifying faces...")
imagePaths = list(paths.list_images(args["dataset"]))

# initialize the list of known encodings and known names
knownEncodings = []
knownNames = []

# loop over the image paths
for (i, imagePath) in enumerate(imagePaths):
	# extract the person name from the image path
	print("[INFO] processing image {}/{}".format(i + 1,
		len(imagePaths)))
	name = imagePath.split(os.path.sep)[-2]

	# load the input image
	image = cv2.imread(imagePath)

	# resize image if W > 800 or H > 600
	# and convert it from RGB (OpenCV ordering)
	# to dlib ordering (RGB)
	IMG_W_MAX = 800
	IMG_H_MAX = 600
	(img_h, img_w) = image.shape[0:2]
	print('image {}'.format(imagePath))
	print ('width = {} height = {}'.format(img_w, img_h))
	if img_w > IMG_W_MAX:
		r = IMG_W_MAX / image.shape[1]
		dim = (IMG_W_MAX, int(image.shape[0] * r))
		resized = cv2.resize(image, dim, interpolation = cv2.INTER_AREA)
		rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
		(img_h, img_w) = resized.shape[0:2]
		print ('resized -> width = {} height = {}'.format(img_w, img_h))
	elif img_h > IMG_H_MAX:
		r = IMG_H_MAX / image.shape[0]
		dim = (int(image.shape[1] * r), IMG_H_MAX)
		resized = cv2.resize(image, dim, interpolation = cv2.INTER_AREA)
		rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
		(img_h, img_w) = resized.shape[0:2]
		print ('resized -> width = {} height = {}'.format(img_w, img_h))
	else:
		rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

	# detect the (x, y)-coordinates of the bounding boxes
	# corresponding to each face in the input image
	# Do not increase upsample beyond 1 else you'll run out of memory.
	boxes = face_recognition.face_locations(rgb, number_of_times_to_upsample=1,
		model=args["detection_method"])

	if len(boxes) == 0:
	 print('*** no face found! ***')
	 continue

	# compute the facial embedding for the face
	encodings = face_recognition.face_encodings(rgb, boxes, num_jitters=500)

	# loop over the encodings
	for encoding in encodings:
		# add each encoding + name to our set of known names and
		# encodings
		knownEncodings.append(encoding)
		knownNames.append(name)

# dump the facial encodings + names to disk
print("[INFO] serializing encodings...")
data = {"encodings": knownEncodings, "names": knownNames}
f = open(args["encodings"], "wb")
f.write(pickle.dumps(data))
f.close()
