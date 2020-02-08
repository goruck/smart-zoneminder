"""
Detect objects using tensorflow-gpu served by zerorpc

This needs to be called from a zerorpc client with an array of zm alarm image paths.
Image paths must be in the form of:
'/nvr/zoneminder/events/BackPorch/18/06/20/19/20/04/00224-capture.jpg'.

This is part of the smart-zoneminder project.
See https://github.com/goruck/smart-zoneminder

Copyright (c) 2018 ~ 2020 Lindo St. Angel
"""

import numpy as np
import tensorflow as tf
import cv2
import json
import zerorpc
import logging
import gevent
import signal
# Object detection imports.
from object_detection.utils import label_map_util
# For tensorrt optimized models...
#import tensorflow.contrib.tensorrt as trt

logging.basicConfig(
    format='%(asctime)s %(name)-12s %(levelname)-8s %(message)s',
    level=logging.ERROR)

logger = logging.getLogger(__name__)

# Get configuration.
with open('./config.json') as fp:
    config = json.load(fp)['objDetServer']

# Tensorflow object detection file system paths.
PATH_TO_MODEL = config['modelPath']
PATH_TO_LABEL_MAP = config['labelMapPath']

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

# Only grow the gpu memory tf usage as required.
# See https://www.tensorflow.org/guide/using_gpu#allowing-gpu-memory-growth
config = tf.compat.v1.ConfigProto()
config.gpu_options.allow_growth=True

# Load frozen tf model into memory.
detection_graph = tf.Graph()
with detection_graph.as_default():
    od_graph_def = tf.compat.v1.GraphDef()
    with tf.io.gfile.GFile(PATH_TO_MODEL, 'rb') as fid:
        serialized_graph = fid.read()
        od_graph_def.ParseFromString(serialized_graph)
        tf.import_graph_def(od_graph_def, name='')

# Load tf label map. 
label_map = label_map_util.load_labelmap(PATH_TO_LABEL_MAP)
categories = label_map_util.convert_label_map_to_categories(label_map,
    max_num_classes=NUM_CLASSES, use_display_name=True)
category_index = label_map_util.create_category_index(categories)

def skip_inference(frame_num, monitor, labels, image_path, objects_in_image):
    """
    If consecutive frames then repeat last label and skip a new inference.
    
    Image paths must be in the form of:
    '/nvr/zoneminder/events/BackPorch/18/06/20/19/20/04/00224-capture.jpg'.
    """

    old_frame_num = frame_num
    old_monitor = monitor
    skip = False

    if CON_IMG_SKIP == 0: return skip, frame_num, monitor

    try:
        frame_num = int((image_path.split('/')[-1]).split('-')[0])
        monitor = image_path.split('/')[4]
    except (ValueError, IndexError):
        logger.error('Could not derive information from image path.')
        objects_in_image.append({'image': image_path, 'labels': []})
        skip = True
        return skip, frame_num, monitor
                    
    # Only apply skip logic if frames are from the same monitor. 
    if monitor == old_monitor:
        # Only apply skip logic if alarm frames are from the same event.
        # Intra-event frames are monotonically increasing.
        frame_diff = frame_num - old_frame_num
        if frame_diff > 0:
            # Skip CON_IMG_SKIP frames after the first one. 
            if frame_diff <= CON_IMG_SKIP:
                objects_in_image.append({'image': image_path, 'labels': labels})
                logger.debug('monitor {} old_monitor {} frame_num {} old_frame_num {}'
                    .format(monitor,old_monitor,frame_num,old_frame_num))
                logger.debug('Consecutive frame {}, skipping detect and copying previous labels.'
                    .format(frame_num))
                skip = True
                        
    return skip, frame_num, monitor

# zerorpc class.
class DetectRPC(object):
    def __init__(self):
        logger.debug('Starting tf sess.')
        self.sess = tf.compat.v1.Session(config=config, graph=detection_graph)

    def close_sess(self):
        logger.debug('Closing tf sess.')
        self.sess.close()

    def detect_objects(self, test_image_paths):
        objects_in_image = [] # holds all objects found in image
        labels = [] # labels of detected objects
        frame_num = 0 # ZoneMinder current alarm frame number
        monitor = '' # ZoneMinder current monitor name
        (img_width, img_height) = (CROP_IMAGE_WIDTH, CROP_IMAGE_HEIGHT)

        for image_path in test_image_paths:
            logger.debug('**********Find object(s) for {}'.format(image_path))

            # If consecutive frames then repeat last label and skip inference.
            # This behavior controlled by CON_IMG_SKIP.
            skip, frame_num, monitor = skip_inference(frame_num, monitor,
                labels, image_path, objects_in_image)
            if skip is True:
                continue

            # Read image from disk. 
            img = cv2.imread(image_path)
            #cv2.imwrite('./img.jpg', img)
            if img is None:
                # Bad image was read.
                logger.error('Bad image was read.')
                objects_in_image.append({'image': image_path, 'labels': []})
                continue

            # Resize to minimize tf processing.
            # Note: resize will slightly lower accuracy. 640 x 480 seems like a good balance.
            res = cv2.resize(img, dsize=(img_width, img_height), interpolation=cv2.INTER_AREA)
            #cv2.imwrite('./res.jpg', res)
            # Format np array for tf use. 
            image_tf = res.astype(np.uint8)
            # Expand dimensions since the model expects images to have shape: [1, None, None, 3]
            image_tf_expanded = np.expand_dims(image_tf, axis=0)
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
            (boxes, scores, classes, num_detections) = self.sess.run(
                [boxes, scores, classes, num_detections],
                feed_dict={image_tensor: image_tf_expanded})

            # Get labels and scores of detected objects.
            labels = [] # new detection, clear labels list.
            (h, w) = img.shape[:2] # use original image size for box coords
            for index, value in enumerate(classes[0]):
                if scores[0, index] > MIN_SCORE_THRESH:
                    object_dict = {}
                    object_dict['id'] = category_index.get(value)['id']
                    object_dict['name'] = category_index.get(value)['name']
                    object_dict['score'] = float(scores[0, index])
                    (ymin, xmin, ymax, xmax) = boxes[0, index] * np.array([h, w, h, w])
                    object_dict['box'] = {'ymin': ymin, 'xmin': xmin, 'ymax': ymax, 'xmax': xmax}
                    labels.append(object_dict)

            objects_in_image.append({'image': image_path, 'labels': labels})

        return json.dumps(objects_in_image)

# Create zerorpc object. 
zerorpc_obj = DetectRPC()
# Create and bind zerorpc server. 
s = zerorpc.Server(zerorpc_obj, heartbeat=ZRPC_HEARTBEAT)
s.bind(ZRPC_PIPE)
# Register graceful ways to stop server. 
gevent.signal(signal.SIGINT, s.stop) # Ctrl-C
gevent.signal(signal.SIGTERM, s.stop) # termination
# Start server.
# This will block until a gevent signal is caught
s.run()
# After server is stopped then close the tf session. 
zerorpc_obj.close_sess()