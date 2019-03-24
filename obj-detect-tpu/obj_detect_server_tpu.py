# Detect objects using tensorflow-tpu served by zerorpc.
#
# This needs to be called from a zerorpc client with an array of alarm frame image paths.
# Image paths must be in the form of:
# '/nvr/zoneminder/events/BackPorch/18/06/20/19/20/04/00224-capture.jpg'.
#
# This is part of the smart-zoneminder project.
#
# Copyright (c) 2018, 2019 Lindo St. Angel

import numpy as np
import json
import zerorpc
from PIL import Image
from edgetpu.detection.engine import DetectionEngine

# Debug.
#import warnings
#warnings.simplefilter('default')

# Function to read labels from text files.
def ReadLabelFile(file_path):
    with open(file_path, 'r') as f:
        lines = f.readlines()
    ret = {}
    for line in lines:
        pair = line.strip().split(maxsplit=1)
        ret[int(pair[0])] = pair[1].strip()
    return ret

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

# Mount point of zm alarms on local tpu machine. 
MOUNT_POINT = config['mountPoint']

# Initialize tpu engines.
obj_engine = DetectionEngine(PATH_TO_MODEL)
labels_map = ReadLabelFile(PATH_TO_LABEL_MAP)
#face_engine = DetectionEngine('/usr/lib/python3/dist-packages/edgetpu/test_data/mobilenet_ssd_v2_face_quant_postprocess_edgetpu.tflite')

# zerorpc server.
class DetectRPC(object):
    def detect(self, test_image_paths):
        objects_in_image = []
        old_labels = []
        frame_num = 0
        monitor = ''
        (img_width, img_height) = (CROP_IMAGE_WIDTH, CROP_IMAGE_HEIGHT)
        for image_path in test_image_paths:
            print('********** {} **********'.format(image_path))
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
                    
            # Only apply skip logic if frames are from the same monitor. 
            if monitor == old_monitor:
                # Only apply skip logic if alarm frames are from the same event.
                # Intra-event frames are monotonically increasing.
                frame_diff = frame_num - old_frame_num
                if frame_diff > 0:
                    # Skip CON_IMG_SKIP frames after the first one. 
                    if frame_diff <= CON_IMG_SKIP:
                        objects_in_image.append({'image': image_path, 'labels': old_labels})
                        print('monitor {} old_monitor {} frame_num {} old_frame_num {}'
                            .format(monitor,old_monitor,frame_num,old_frame_num))
                        print('Consecutive frame {}, skipping detect and copying previous labels.'
                            .format(frame_num))
                        continue

            with Image.open(MOUNT_POINT + image_path) as image:
                # Resize image.
                image_resize = image.resize((img_width, img_height))

            # Run inference.
            ans = obj_engine.DetectWithImage(image_resize, threshold=0.1, keep_aspect_ratio=True,
                relative_coord=True, top_k=3, resample=Image.NEAREST)

            # Get labels and scores of detected objects.
            labels = []
            (ow, oh) = image.size # use original image size for box coords
            for obj in ans:
                print('id: {} name: {} score: {}'.format(obj.label_id, labels_map[obj.label_id], obj.score))
                print('box {}'.format(obj.bounding_box.flatten().tolist()))
                if obj.score > MIN_SCORE_THRESH:
                    object_dict = {}
                    object_dict['id'] = obj.label_id
                    object_dict['name'] = labels_map[obj.label_id]
                    object_dict['score'] = float(obj.score)
                    box = obj.bounding_box.flatten().tolist()
                    ymin = box[1] * oh
                    xmin = box[0] * ow
                    ymax = box[3] * oh
                    xmax = box[2] * ow
                    object_dict['box'] = {'ymin': ymin, 'xmin': xmin, 'ymax': ymax, 'xmax': xmax}
                    labels.append(object_dict)

            old_labels = labels

            objects_in_image.append({'image': image_path, 'labels': labels})
        return json.dumps(objects_in_image)

s = zerorpc.Server(DetectRPC(), heartbeat=ZRPC_HEARTBEAT)
s.bind(ZRPC_PIPE)
s.run()