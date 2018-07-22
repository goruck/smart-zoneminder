# Detect objects using tensorflow-gpu served by zerorpc.
#
# This needs to be called from a zerorpc client with an array of alarm frame image paths.
# Image paths must be in the form of:
# '/nvr/zoneminder/events/BackPorch/18/06/20/19/20/04/00224-capture.jpg'.
#
# This program must be run in a tensorflow virtualenv, e.g.,
# $ /home/lindo/develop/tensorflow/bin/python3.6 ./obj_detect_server.py
#
# This is part of the smart-zoneminder project.
#
# Copyright (c) 2018 Lindo St. Angel

import numpy as np
import tensorflow as tf
import json
import zerorpc
from PIL import Image
# Object detection imports.
from object_detection.utils import label_map_util

# Debug.
#import warnings
#warnings.simplefilter('default')

# Get configuration.
with open('./config.json') as fp:
    config = json.load(fp)['objDetServer']

# Tensorflow object detection file system paths.
PATH_BASE = config['modelPathBase']
PATH_TO_CKPT = PATH_BASE + config['modelPath']
PATH_TO_LABELS = PATH_BASE + config['labelPath']

# Max number of classes for TF object detection.
NUM_CLASSES = config['numClasses']

# If consecutive ZoneMinder image frames are found then skip this many after the first.
CON_IMG_SKIP = config['conseqImagesToSkip']

# Minimum score for valid TF object detection. 
MIN_SCORE_THRESH = config['minScore']

# Crop image to minimize processing (at some expense of accuracy).
# In pixels.
CROP_IMAGE_WIDTH = config['cropImageWidth']
CROP_IMAGE_HEIGHT = config['cropImageHeight']

# Heartbeat interval for zerorpc client in ms.
# This must match the zerorpc client config. 
ZRPC_HEARTBEAT = config['zerorpcHeartBeat']

# IPC (or TCP) socket for zerorpc.
# This must match the zerorpc client config.
ZRPC_PIPE = config['zerorpcPipe']

# Load frozen Tensorflow model into memory. 
detection_graph = tf.Graph()
with detection_graph.as_default():
  od_graph_def = tf.GraphDef()
  with tf.gfile.GFile(PATH_TO_CKPT, 'rb') as fid:
    serialized_graph = fid.read()
    od_graph_def.ParseFromString(serialized_graph)
    tf.import_graph_def(od_graph_def, name='')
  sess = tf.Session(graph=detection_graph)
  sess.run(tf.global_variables_initializer())

# Load label map. 
label_map = label_map_util.load_labelmap(PATH_TO_LABELS)
categories = label_map_util.convert_label_map_to_categories(label_map, max_num_classes=NUM_CLASSES, use_display_name=True)
category_index = label_map_util.create_category_index(categories)

# Helper code. 
def load_image_into_numpy_array(image):
    (im_width, im_height) = image.size
    return np.array(image.getdata()).reshape((im_height, im_width, 3)).astype(np.uint8)

# zerorpc server.
class DetectRPC(object):
    def detect(self, test_image_paths):
       with detection_graph.as_default():
            objects_in_image = []
            old_labels = []
            frame_num = 0
            monitor = ''
            (img_width, img_height) = (CROP_IMAGE_WIDTH, CROP_IMAGE_HEIGHT)
            for image_path in test_image_paths:
                # If consecutive frames then repeat last label to minimize processing.
                # Image paths must be in the form of:
                # '/nvr/zoneminder/events/BackPorch/18/06/20/19/20/04/00224-capture.jpg'.
                old_frame_num = frame_num
                old_monitor = monitor
                try:
                    frame_num = int((image_path.split('/')[-1]).split('-')[0])
                    monitor = image_path.split('/')[4]
                except (ValueError, IndexError):
                    print("Could not derive information from image path.")
                    continue
                    
                if monitor == old_monitor:
                    if frame_num - old_frame_num  <= CON_IMG_SKIP:
                        objects_in_image.append({'image': image_path, 'labels': old_labels})
                        print('Consecutive frame {}, skipping detect and copying previous labels.'.format(frame_num))
                        continue

                with Image.open(image_path) as image:
                    # Resize to minimize tf processing.
                    # Note: resize will slightly lower accuracy. 640 x 480 seems like a good balance.
                    image_resize = image.resize((img_width, img_height))

                # Convert image to numpy array
                image_np = load_image_into_numpy_array(image_resize)
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

                # Actual detection.
                (boxes, scores, classes, num_detections) = sess.run(
                    [boxes, scores, classes, num_detections],
                    feed_dict={image_tensor: image_np_expanded})

                # Get labels and scores of detected objects.
                labels = []
                object_dict = {}
                for index, value in enumerate(classes[0]):
                    if scores[0, index] > MIN_SCORE_THRESH:
                        object_dict = category_index.get(value)
                        object_dict['score'] = float(scores[0, index])
                        object_dict['box'] = boxes[0, index].tolist()
                        labels.append(object_dict)

                old_labels = labels

                objects_in_image.append({'image': image_path, 'labels': labels})
            return json.dumps(objects_in_image)

    # Streaming server.
    @zerorpc.stream
    def detect_stream(self, test_image_paths):
        (img_width, img_height) = (CROP_IMAGE_WIDTH, CROP_IMAGE_HEIGHT)
        with detection_graph.as_default():
            for image_path in test_image_paths:
                with Image.open(image_path) as image:
                    # Resize to minimize tf processing.
                    # Note: resize will slightly lower accuracy. 640 x 480 seems like a good balance.
                    image_resize = image.resize((img_width, img_height))

                # Convert image to numpy array
                image_np = load_image_into_numpy_array(image_resize)
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

                # Get labels and scores of detected objects.
                labels = []
                object_dict = {}
                for index, value in enumerate(classes[0]):
                    if scores[0, index] > MIN_SCORE_THRESH:
                        object_dict = category_index.get(value)
                        object_dict['score'] = float(scores[0, index])
                        object_dict['box'] = boxes[0, index].tolist()
                        labels.append(object_dict)

                yield json.dumps({'image': image_path, 'labels': labels})

s = zerorpc.Server(DetectRPC(), heartbeat=ZRPC_HEARTBEAT)
s.bind(ZRPC_PIPE)
s.run()