'''
Post-training quantization of keras h5 model and conversion to TFlite model.
The resulting model can be compiled for inference on the Google Coral edge TPU.

This is part of the smart-zoneminder project.
See https://github.com/goruck/smart-zoneminder

Ref:
https://www.tensorflow.org/lite/performance/post_training_quantization#full_integer_quantization_of_weights_and_activations

https://coral.ai/docs/edgetpu/compiler/

https://coral.ai/docs/edgetpu/models-intro

Copyright (c) 2019, 2020 Lindo St. Angel
'''

import tensorflow as tf
import numpy as np
import cv2
import argparse
import logging
import time
import json
from random import shuffle
from os import listdir, path
from functools import partial
from sys import exit
from glob import glob

logger = logging.getLogger(__name__)

# Use same config as person_classifier_server.py.
with open('./config.json') as fp:
    config = json.load(fp)

LABEL_MAP = config['personClassifierServer']['labelMap']

def get_preprocessor(model):
    base_model_name = model.layers[0].name

    if base_model_name == 'inception_resnet_v2':
        preprocessor = tf.keras.applications.inception_resnet_v2.preprocess_input
    elif base_model_name == 'mobilenetv2_1.00_224':
        preprocessor = tf.keras.applications.mobilenet_v2.preprocess_input
    elif base_model_name == 'resnet50':
        preprocessor = tf.keras.applications.resnet50.preprocess_input
    elif base_model_name == 'vgg16':
        preprocessor = tf.keras.applications.vgg16.preprocess_input
    elif base_model_name == 'NASNet':
        preprocessor = tf.keras.applications.nasnet.preprocess_input
    else:
        raise ValueError('Unknown base model name')

    return preprocessor, base_model_name

def representative_dataset_gen(path, num_cal, input_size, preprocessor):
    images = listdir(path)
    shuffle(images)
    calibration_images = images[:num_cal]

    for image in calibration_images:
        img = cv2.imread(path + image)
        if img is None:
            continue
        img = cv2.resize(img, dsize=input_size, interpolation=cv2.INTER_AREA)
        img = np.expand_dims(img, axis=0)
        img = preprocessor(img.astype('float32'))
        yield [img]

def convert(keras_model, ref_dataset, num_cal, input_size, preprocessor):
    converter = tf.lite.TFLiteConverter.from_keras_model(
        model=keras_model)

    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    # ref_gen must be a callable so use partial to set parameters. 
    # Alternatively a lambda could be used here.
    # Ref: https://stackoverflow.com/questions/49280016/how-to-make-a-generator-callable
    ref_gen = partial(representative_dataset_gen,
        path=ref_dataset,
        num_cal=num_cal,
        input_size=input_size,
        preprocessor=preprocessor)
    converter.representative_dataset = tf.lite.RepresentativeDataset(ref_gen)
    converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
    converter.inference_input_type = tf.uint8
    converter.inference_output_type = tf.uint8

    return converter.convert()

def evaluate_model(interpreter, test_gen):
    """
    This is dog slow on an Intel machine. Use an Arm machine or edge tpu.
    Ref: https://stackoverflow.com/questions/54093424/why-is-tensorflow-lite-slower-than-tensorflow-on-desktop
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
    ap.add_argument('--input',
        type=str,
        required=True,
        help='keras .h5 model to convert ')
    ap.add_argument('--dataset',
        default='/home/lindo/develop/smart-zoneminder/face-det-rec/dataset',
        help='location of input dataset')
    ap.add_argument('--num_cal',
        type=int,
        default=100,
        help='number of images to use for calibration')
    ap.add_argument('--output',
        type=str,
        required=True,
        help='name of converted output model')
    ap.add_argument('--eval_model',
        action='store_true',
        default=False,
        help='evaluate quantized model accuracy on dataset')
    args = vars(ap.parse_args())

    logging.basicConfig(format='%(asctime)s %(name)-12s %(levelname)-8s %(message)s',
        level=logging.DEBUG)

    logger.info('Converting keras model {}'.format(args['input']))

    # Load model and examine it to get model input size and preprocessor. 
    model = tf.keras.models.load_model(args['input'], compile=False)
    
    input_size = model.input_shape[1:3]
    logger.info('input size: {}'.format(input_size))

    try:
        (preprocessor, base_model_name) = get_preprocessor(model)
        logger.info('base model name: {}'.format(base_model_name))
    except ValueError as err:
        logger.error('{}'.format(err))
        exit()

    # Clear graph to prepare for conversion. 
    tf.keras.backend.clear_session()

    # Actual conversion.
    tflite_quant_model = convert(model,
        args['dataset'] + '/Unknown/', # Use Unknown images for calibration
        args['num_cal'],
        input_size,
        preprocessor)

    # Save converted model. 
    with open(args['output'], 'wb') as file:
        file.write(tflite_quant_model)

    logger.info('Quantized tflite model saved to {}'.format(args['output']))

    if args['eval_model']:
        # Grab test images paths.
        imagePaths = glob(args['dataset'] + '/**/*.*', recursive=True)

        # Create a test image generator comprehension.
        # Generates (image path, image label) tuples.
        test_gen = ((path.abspath(imagePath), imagePath.split(path.sep)[-2])
            for imagePath in imagePaths)

        # Start the tflite interpreter on the tpu and allocate tensors.
        interpreter = tf.lite.Interpreter(model_path=args['output'])
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