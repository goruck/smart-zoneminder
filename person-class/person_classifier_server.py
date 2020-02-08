"""
Classify persons using tensorflow-gpu served by zerorpc

Should be called from a zerorpc client with ZoneMinder
alarm image metadata from zm-s3-upload.js.

This is part of the smart-zoneminder project.
See https://github.com/goruck/smart-zoneminder

Copyright (c) 2019, 2020 Lindo St. Angel
"""

import numpy as np
import tensorflow as tf
import cv2
import json
import zerorpc
import logging
import gevent
import signal

logging.basicConfig(
    format='%(asctime)s %(name)-12s %(levelname)-8s %(message)s',
    level=logging.ERROR)

logger = logging.getLogger(__name__)

# Get configuration.
with open('./config.json') as fp:
    config = json.load(fp)['personClassifierServer']

# Path to TensorFlow Saved Model.
PATH_TO_MODEL = config['savedModel']

# Model input size.
MODEL_INPUT_SIZE = tuple(config['modelInputSize'])

# Model preprocessor function.
PREPROCESSOR = eval(config['preprocessor'])

# Minimum score for valid TF person detection. 
MIN_PROBA = config['minProba']

# Heartbeat interval for zerorpc client in ms.
# This must match the zerorpc client config. 
ZRPC_HEARTBEAT = config['zerorpcHeartBeat']

# IPC (or TCP) socket for zerorpc.
# This must match the zerorpc client config.
ZRPC_PIPE = config['zerorpcPipe']

# Get tf label map. 
LABEL_MAP = config['labelMap']

# Limit GPU memory growth.
gpus = tf.config.experimental.list_physical_devices('GPU')
if gpus:
    try:
        for gpu in gpus:
            tf.config.experimental.set_memory_growth(gpu, True)
        logical_gpus = tf.config.experimental.list_logical_devices('GPU')
        logger.debug(f'{len(gpus)} Physical GPUs, {len(logical_gpus)} Logical GPUs')
    except RuntimeError as e:
        # Memory growth must be set before GPUs have been initialized
        logger.debug(e)

# Load model and prepare for inference.
# See: https://www.tensorflow.org/guide/saved_model
loaded = tf.saved_model.load(PATH_TO_MODEL)
infer = loaded.signatures['serving_default']
logger.debug('Model output info {}:'.format(infer.structured_outputs))
output = list(infer.structured_outputs.keys())[0]

# zerorpc class.
class DetectRPC(object):
    def __init__(self):
        logger.debug('Starting server for person classification.')
        # add optional init statements

    def close_server(self):
        logger.debug('Closing server for person classification.')
        # add optional close statements

    def detect_faces(self, test_image_paths):
        # List that will hold all images with any person classifications. 
        objects_classified_persons = []
        for obj in test_image_paths:
            logger.debug('**********Classify person for {}'.format(obj['image']))
            for label in obj['labels']:
                # If the object detected is a person then try to identify face. 
                if label['name'] == 'person':
                    # Read image from disk. 
                    img = cv2.imread(obj['image'])
                    if img is None:
                        # Bad image was read.
                        logging.error('Bad image was read.')
                        label['face'] = None
                        continue

                    # First bound the roi using the coord info passed in.
                    # The roi is area around person(s) detected in image.
                    # (x1, y1) are the top left roi coordinates.
                    # (x2, y2) are the bottom right roi coordinates.
                    y2 = int(label['box']['ymin'])
                    x1 = int(label['box']['xmin'])
                    y1 = int(label['box']['ymax'])
                    x2 = int(label['box']['xmax'])
                    roi = img[y2:y1, x1:x2]
                    #cv2.imwrite('./roi.jpg', roi)
                    if roi.size == 0:
                        # Bad object roi...move on to next image.
                        logger.error('Bad object roi.')
                        label['face'] = None
                        continue

                    # Format image to what the model expects for input.
                    # Resize.
                    roi = cv2.resize(roi, dsize=MODEL_INPUT_SIZE,
                        interpolation=cv2.INTER_AREA)
                    # Expand dimensions.
                    roi = np.expand_dims(roi, axis=0)
                    # Preprocess.
                    roi = PREPROCESSOR(roi.astype('float32'))

                    # Actual predictions per class.
                    predictions = infer(tf.constant(roi))[output]

                    # Find most likely prediction.
                    proba = np.amax(predictions)
                    j = np.argmax(predictions)
                    person = LABEL_MAP[j]
                    logger.debug('person classifier proba {} name {}'
                        .format(proba, person))
                    if proba >= MIN_PROBA:
                        name = person
                        logger.debug('person classifier says this is {}'
                            .format(name))
                    else:
                        name = None # prob too low to recog face
                        logger.debug('person classifier cannot recognize person')

                    # Add face name to label metadata.
                    label['face'] = name
                    # Add face confidence to label metadata.
                    # (First convert NumPy value to native Python type for json serialization.)
                    label['faceProba'] = proba.item()

                    # Add processed image to output list. 
            objects_classified_persons.append(obj)

        # Convert json to string and return data. 
        return(json.dumps(objects_classified_persons))

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
# After server is stopped then close it. 
zerorpc_obj.close_server()