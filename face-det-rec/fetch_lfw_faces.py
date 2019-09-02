'''
Fetch faces from the Labeled Faces in the Wild (LFW) people dataset.

Usage:
$ python3 fetch_lfw_faces.py

Part of the smart-zoneminder project:
See https://github.com/goruck/smart-zoneminder.

Copyright (c) 2019 Lindo St. Angel
'''

import numpy as np
import argparse
from sklearn.datasets import fetch_lfw_people
from PIL import Image

# Construct the argument parser and parse the arguments.
ap = argparse.ArgumentParser()
ap.add_argument('-n', '--num_faces', type=int, default=200,
    help='number of faces to fetch from the lfw dataset (defaults to 200')
ap.add_argument('-d', '--data_home', type=str, default=None,
    help='location of cache folder for dataset (defaults to ~/scikit_learn_data')
ap.add_argument('-r', '--resize', type=float, default=0.5,
    help='ratio used to resize the each face picture (defaults to 0.5).')
ap.add_argument('-o', '--output', type=str, default='./lfw_people_images/',
    help='location of folder to store faces (defaults to ./lfw_people_images/).')
args = vars(ap.parse_args())

lfw_people = fetch_lfw_people(data_home=args['data_home'], resize=args['resize'])

images = lfw_people.images
images_subset = images[np.random.choice(images.shape[0], args['num_faces'],replace=False), :]

for i, img in enumerate(images_subset):
    face = Image.fromarray(img.astype('uint8'), 'L')
    face_name = args['output'] + 'lfm_face{}.jpeg'.format(i)
    face.save(face_name)