'''
Evaluate tflite model running on edge tpu.

Copyright (c) 2020 Lindo St. Angel
'''

import tflite_runtime.interpreter as tflite
import numpy as np
import cv2
import argparse
import logging
import time
import json
from os import path
from glob import glob

logger = logging.getLogger(__name__)

# Use same config as detect_servers_tpu.py.
# Model can be overridden on the command line.
with open('./config.json') as fp:
    config = json.load(fp)

person_config = config['personClassServer']
LABEL_MAP = person_config['labelMap']
DEFAULT_MODEL = person_config['personClassModelPath']

def evaluate_model(interpreter, test_gen):
    """
    Ref: https://coral.ai/docs/edgetpu/tflite-python/
    """
    input_details = interpreter.get_input_details()
    input_index = input_details[0]['index']
    input_shape = input_details[0]['shape']
    input_size = tuple(input_shape[1:3])

    output_index = interpreter.get_output_details()[0]['index']
    
    accurate_count = 0
    num_images = 0
    start = time.time()

    for test_image, test_label in test_gen:
        img = cv2.imread(test_image) # read as np.uint8

        # Pre-processing: resize, add batch dimension to match with
        # the model's input data format.
        img = cv2.resize(img, input_size)
        img = np.expand_dims(img, axis=0)
        interpreter.set_tensor(input_index, img)

        # Run inference.
        interpreter.invoke()

        # Post-processing: remove batch dimension and find the digit with highest
        # probability.
        output = interpreter.tensor(output_index)
        class_id = np.argmax(output()[0])
        prediction = LABEL_MAP[class_id]

        # Compare prediction results with ground truth labels to calculate accuracy.
        if prediction == test_label:
            accurate_count += 1

        num_images += 1

        logger.debug('image: {} | ground truth: {} | prediction: {}'
            .format(path.basename(test_image), test_label, prediction))

    end = time.time()
    
    accuracy = accurate_count * 1.0 / num_images

    return accuracy, end - start

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model',
        type=str,
        default=None,
        help='tflite model to evaluate')
    ap.add_argument('--dataset',
        default='/mnt/dataset/',
        help='location of evaluation dataset')
    args = vars(ap.parse_args())

    logging.basicConfig(format='%(asctime)s %(name)-12s %(levelname)-8s %(message)s',
        level=logging.DEBUG)

    # Let model on command line override default from config.
    if args['model'] is not None:
        model = args['model']
    else:
        model = DEFAULT_MODEL

    logger.info('Evaluating tflite model: {} on dataset: {}'
        .format(model, args['dataset']))

    # Grab test images paths.
    imagePaths = glob(args['dataset'] + '/**/*.*', recursive=True)

    # Create a test image generator comprehension.
    # Generates (image path, image label) tuples.
    test_gen = ((path.abspath(imagePath), imagePath.split(path.sep)[-2])
        for imagePath in imagePaths)

    # Start the tflite interpreter on the tpu and allocate tensors.
    interpreter = tflite.Interpreter(model_path=model,
        experimental_delegates=[tflite.load_delegate('libedgetpu.so.1')])
    interpreter.allocate_tensors()

    logger.info(interpreter.get_input_details())
    logger.info(interpreter.get_output_details())

    # Compute accuracy on the test image set.
    accuracy, inference_time = evaluate_model(interpreter=interpreter,
        test_gen=test_gen)

    num_images = len(imagePaths)

    logger.info('accuracy: {:.4f}, num test images: {}, inferences / sec: {:.4f}'
        .format(accuracy, num_images, num_images / inference_time))

if __name__ == '__main__':
    main()