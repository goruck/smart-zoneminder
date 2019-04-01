"""
Detect objects using tensorflow-tpu served by zerorpc.

This needs to be called from a zerorpc client with an array of alarm frame image paths.
Image paths must be in the form of:
'/nvr/zoneminder/events/BackPorch/18/06/20/19/20/04/00224-capture.jpg'.

This is part of the smart-zoneminder project.
See https://github.com/goruck/smart-zoneminder

Copyright (c) 2018, 2019 Lindo St. Angel
"""

import numpy as np
import json
import zerorpc
import cv2
import logging
from edgetpu.detection.engine import DetectionEngine

logging.basicConfig(level=logging.ERROR)

# Get configuration.
with open('./config.json') as fp:
    config = json.load(fp)['objDetServer']

# Tensorflow object and face detection file system paths.
PATH_TO_OBJ_MODEL = config['objModelPath']
PATH_TO_LABEL_MAP = config['labelMapPath']

# If consecutive ZoneMinder image frames are found then skip this many after the first.
CON_IMG_SKIP = config['conseqImagesToSkip']

# Minimum score for valid TF object detection. 
MIN_SCORE_THRESH = config['minScore']

# Heartbeat interval for zerorpc client in ms.
# This must match the zerorpc client config. 
ZRPC_HEARTBEAT = config['zerorpcHeartBeat']

# IPC (or TCP) socket for zerorpc.
# This must match the zerorpc client config.
ZRPC_PIPE = config['zerorpcPipe']

# Mount point of zm alarms on local tpu machine. 
MOUNT_POINT = config['mountPoint']

def ReadLabelFile(file_path):
    # Function to read labels from text files.
    with open(file_path, 'r') as f:
        lines = f.readlines()
    ret = {}
    for line in lines:
        pair = line.strip().split(maxsplit=1)
        ret[int(pair[0])] = pair[1].strip()
    return ret

# Initialize tpu engines.
obj_engine = DetectionEngine(PATH_TO_OBJ_MODEL)
labels_map = ReadLabelFile(PATH_TO_LABEL_MAP)

# zerorpc server.
class DetectRPC(object):
    def detect_objects(self, test_image_paths):
        objects_in_image = []
        old_labels = []
        frame_num = 0
        monitor = ''
        for image_path in test_image_paths:
            logging.info('**********Find object(s) for {}'.format(image_path))
            # If consecutive frames then repeat last label to minimize processing.
            # Image paths must be in the form of:
            # '/nvr/zoneminder/events/BackPorch/18/06/20/19/20/04/00224-capture.jpg'.
            old_frame_num = frame_num
            old_monitor = monitor
            try:
                frame_num = int((image_path.split('/')[-1]).split('-')[0])
                monitor = image_path.split('/')[4]
            except (ValueError, IndexError):
                logging.error("Could not derive information from image path.")
                objects_in_image.append({'image': image_path, 'labels': []})
                continue
                    
            # Only apply skip logic if frames are from the same monitor. 
            if monitor == old_monitor:
                # Only apply skip logic if alarm frames are from the same event.
                # Intra-event frames are monotonically increasing.
                frame_diff = frame_num - old_frame_num
                if frame_diff > 0:
                    # Skip CON_IMG_SKIP frames after the first one. 
                    if frame_diff <= CON_IMG_SKIP:
                        objects_in_image.append({'image': image_path, 'labels': old_labels})
                        logging.debug('monitor {} old_monitor {} frame_num {} old_frame_num {}'
                            .format(monitor,old_monitor,frame_num,old_frame_num))
                        logging.info('Consecutive frame {}, skipping detect and copying previous labels.'
                            .format(frame_num))
                        continue

            # Read image from disk. 
            img = cv2.imread(MOUNT_POINT + image_path)
            #cv2.imwrite('./obj_img.jpg', img)
            if img is None:
                # Bad image was read.
                logging.error('Bad image was read.')
                objects_in_image.append({'image': image_path, 'labels': []})
                continue

            # Resize. The tpu obj det requires (300, 300).
            res = cv2.resize(img, dsize=(300, 300), interpolation=cv2.INTER_AREA)
            #cv2.imwrite('./obj_res.jpg', res)

            # Run object inference.
            detection = obj_engine.DetectWithInputTensor(res.reshape(-1),
                threshold=0.1, top_k=3)

            # Get labels and scores of detected objects.
            labels = []
            (h, w) = img.shape[:2] # use original image size for box coords
            for obj in detection:
                logging.debug('id: {} name: {} score: {}'.format(obj.label_id, labels_map[obj.label_id], obj.score))
                if obj.score > MIN_SCORE_THRESH:
                    object_dict = {}
                    object_dict['id'] = obj.label_id
                    object_dict['name'] = labels_map[obj.label_id]
                    object_dict['score'] = float(obj.score)
                    (xmin, ymin, xmax, ymax) = (obj.bounding_box.flatten().tolist()) * np.array([w, h, w, h])
                    object_dict['box'] = {'ymin': ymin, 'xmin': xmin, 'ymax': ymax, 'xmax': xmax}
                    labels.append(object_dict)

            old_labels = labels

            objects_in_image.append({'image': image_path, 'labels': labels})
        return json.dumps(objects_in_image)

s = zerorpc.Server(DetectRPC(), heartbeat=ZRPC_HEARTBEAT)
s.bind(ZRPC_PIPE)
s.run()