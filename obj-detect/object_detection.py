#!/home/lindo/develop/tensorflow/bin/python3.6

# Detect objects using tensorflow-gpu.
# Designed to be run as a script from node.js as part of the smart-zoneminder project. 
# Copyright (c) 2018 Lindo St. Angel
#
# See below for addtional information.
# https://stackoverflow.com/questions/45674696/tensorflow-object-detection-api-print-objects-found-on-image-to-console

# Imports.
import numpy as np
import os
import six.moves.urllib as urllib
import sys
import tarfile
import tensorflow as tf
import zipfile
import json

from collections import defaultdict
from io import StringIO
from matplotlib import pyplot as plt
from PIL import Image

from sys import argv
from sys import exit

# Get image paths from command line.
if len(sys.argv) == 1:
    exit('No test image file paths were supplied!')
test_image_paths = argv[1:]

# Object detection imports.
from object_detection.utils import label_map_util
from object_detection.utils import visualization_utils as vis_util

# Model preparation.
PATH_BASE = '/home/lindo/develop/tensorflow/models/research/object_detection/'
PATH_TO_CKPT = PATH_BASE + 'rfcn_resnet101_coco_2018_01_28/frozen_inference_graph.pb'
#PATH_TO_CKPT = PATH_BASE + 'ssd_mobilenet_v1_coco_2017_11_17/frozen_inference_graph.pb'
PATH_TO_LABELS = PATH_BASE + 'data/mscoco_label_map.pbtxt'
NUM_CLASSES = 90

# Load frozen Tensorflow model into memory. 
detection_graph = tf.Graph()
with detection_graph.as_default():
  od_graph_def = tf.GraphDef()
  with tf.gfile.GFile(PATH_TO_CKPT, 'rb') as fid:
    serialized_graph = fid.read()
    od_graph_def.ParseFromString(serialized_graph)
    tf.import_graph_def(od_graph_def, name='')

# Load label map. 
label_map = label_map_util.load_labelmap(PATH_TO_LABELS)
categories = label_map_util.convert_label_map_to_categories(label_map, max_num_classes=NUM_CLASSES, use_display_name=True)
category_index = label_map_util.create_category_index(categories)

# Helper code. 
def load_image_into_numpy_array(image):
  (im_width, im_height) = image.size
  return np.array(image.getdata()).reshape(
      (im_height, im_width, 3)).astype(np.uint8)

# Detection.
#PATH_TO_TEST_IMAGES_DIR = './test_images/'
#TEST_IMAGE_PATHS = [ os.path.join(PATH_TO_TEST_IMAGES_DIR, 'image{}.jpg'.format(i)) for i in range(1, 5) ]
TEST_IMAGE_PATHS = test_image_paths
IMAGE_SIZE = (12, 8)

def detect_object_in_image(image_path):
    image = Image.open(image_path)
    image_np = load_image_into_numpy_array(image)
    # Expand dimensions since the model expects images to have shape: [1, None, None, 3]
    image_np_expanded = np.expand_dims(image_np, axis=0)
    image_tensor = detection_graph.get_tensor_by_name('image_tensor:0')
    # Each box represents a part of the image where a particular object was detected.
    boxes = detection_graph.get_tensor_by_name('detection_boxes:0')
    scores = detection_graph.get_tensor_by_name('detection_scores:0')
    classes = detection_graph.get_tensor_by_name('detection_classes:0')
    num_detections = detection_graph.get_tensor_by_name('num_detections:0')

    (boxes, scores, classes, num_detections) = sess.run(
          [boxes, scores, classes, num_detections],
          feed_dict={image_tensor: image_np_expanded})

    '''
    vis_util.visualize_boxes_and_labels_on_image_array(
        image_np,
        np.squeeze(boxes),
        np.squeeze(classes).astype(np.int32),
        np.squeeze(scores),
        category_index,
        use_normalized_coordinates=True,
        line_thickness=8)
    plt.figure(figsize=IMAGE_SIZE)
    filename, file_extension = os.path.splitext(os.path.basename(image_path))
    plt.imsave(PATH_BASE + 'RESULTS/' + filename + '_detect' + file_extension, image_np)
    '''

    # Return found objects
    min_score_thresh = 0.9
    return ([category_index.get(value) for index,value in enumerate(classes[0]) if scores[0,index] > min_score_thresh])
    #print(boxes.shape)
    #print(num_detections)

objects_in_image = {}
with detection_graph.as_default():
  with tf.Session(graph=detection_graph) as sess:
    sess.run(tf.global_variables_initializer())
    for image_path in TEST_IMAGE_PATHS:
        #objects_in_image.append(detect_object_in_image(image_path))
        objects_in_image[image_path] = detect_object_in_image(image_path)
    print(json.dumps(objects_in_image))
    sys.stdout.flush()
