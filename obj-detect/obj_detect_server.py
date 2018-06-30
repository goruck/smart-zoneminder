#!/home/lindo/develop/tensorflow/bin/python3.6

# Detect objects using tensorflow-gpu, server version.
# Designed to be run as a script from node.js as part of the smart-zoneminder project. 
# Copyright (c) 2018 Lindo St. Angel

# Imports.
#from gevent import monkey; monkey.patch_all()

import numpy as np
import os
import six.moves.urllib as urllib
import sys
import tarfile
import tensorflow as tf
import zipfile
import json
import zerorpc
#import gevent

from collections import defaultdict
from io import StringIO
from PIL import Image

# Object detection imports.
from object_detection.utils import label_map_util

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

# zerorpc server.
class DetectRPC(object):
    def detect(self, test_image_paths):
        with detection_graph.as_default():
            with tf.Session(graph=detection_graph) as sess:
                sess.run(tf.global_variables_initializer())

                # Helper code. 
                def load_image_into_numpy_array(image):
                    (im_width, im_height) = image.size
                    return np.array(image.getdata()).reshape((im_height, im_width, 3)).astype(np.uint8)

                objects_in_image = []
                old_labels = []
                frame_num = 0
                for image_path in test_image_paths:
                    # If consecutive frames then repeat last label to minimize processing.
                    # Image paths must be in the form of:
                    # '/nvr/zoneminder/events/BackPorch/18/06/20/19/20/04/00224-capture.jpg'.
                    # TODO: add check of monitor name since only checking frames is not robust.
                    old_frame_num = frame_num
                    try:
                        frame_num = int((image_path.split('/')[-1]).split('-')[0])
                    except (ValueError, IndexError):
                        print("Could not derive frame number from image path.")
                        continue
                    
                    if frame_num - old_frame_num  == 1:
                        objects_in_image.append({'image': image_path, 'labels': old_labels})
                        print('Consecutive frame {}, skipping detect and copying previous labels.'.format(frame_num))
                        continue

                    try:
                        image = Image.open(image_path)
                    except OSError as e:
                        print('Image open error {}'.format(e))
                        continue

                    image_np = load_image_into_numpy_array(image.resize((320,240)))
                    # Expand dimensions since the model expects images to have shape: [1, None, None, 3]
                    image_np_expanded = np.expand_dims(image_np, axis=0)
                    # Define input node.
                    image_tensor = detection_graph.get_tensor_by_name('image_tensor:0')
                    # Define output nodes.
                    # Each box represents a part of the image where a particular object was detected.
                    boxes = detection_graph.get_tensor_by_name('detection_boxes:0')
                    # This contains class scores for the detections.
                    scores = detection_graph.get_tensor_by_name('detection_scores:0')
                    # This contains classes for the detections.
                    classes = detection_graph.get_tensor_by_name('detection_classes:0')
                    # This specifies the number of valid boxes per image in the batch.
                    num_detections = detection_graph.get_tensor_by_name('num_detections:0')

                    (boxes, scores, classes, num_detections) = sess.run(
                        [boxes, scores, classes, num_detections],
                        feed_dict={image_tensor: image_np_expanded})

                    min_score_thresh = 0.9
                    labels = ([category_index.get(value)
                        for index,value in enumerate(classes[0])
                        if scores[0,index] > min_score_thresh])

                    old_labels = labels

                    objects_in_image.append({'image': image_path, 'labels': labels})

                    # Allow a heartbeat to happen by putting the greenlet to sleep.
                    # https://github.com/0rpc/zerorpc-python/issues/95
                    #gevent.sleep(0)
                #print(objects_in_image)
                return json.dumps(objects_in_image)

    def fastmethod(self):
        return 'Fast Done'

    # Streaming server. 
    @zerorpc.stream
    def detect_stream(self, test_image_paths):
        with detection_graph.as_default():
            with tf.Session(graph=detection_graph) as sess:
                sess.run(tf.global_variables_initializer())

                # Helper code. 
                def load_image_into_numpy_array(image):
                    (im_width, im_height) = image.size
                    return np.array(image.getdata()).reshape((im_height, im_width, 3)).astype(np.uint8)

                for image_path in test_image_paths:
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

                    min_score_thresh = 0.9
                    objects_in_image = {'image': image_path, 'labels':([category_index.get(value)
                        for index,value in enumerate(classes[0])
                        if scores[0,index] > min_score_thresh])}

                    yield json.dumps(objects_in_image)

                    # Allow a heartbeat to happen by putting the greenlet to sleep.
                    # https://github.com/0rpc/zerorpc-python/issues/95
                    #gevent.sleep(0)

s = zerorpc.Server(DetectRPC(), heartbeat=60000)
#s.bind("tcp://0.0.0.0:4242")
s.bind("ipc:///tmp/zmq.pipe")
s.run()