'''
Post-training quantization of keras h5 model and conversion to TFlite model.
The resulting model can be compiled for inference on the Google Coral edge TPU.

NB: This meeds to be run in the "od" Python virtenv.

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
from random import shuffle
from os import listdir
from functools import partial
from sys import exit

logger = logging.getLogger(__name__)

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
    else:
        raise ValueError('Unknown base model name')

    return preprocessor, base_model_name

def representative_dataset_gen(path, num_cal, input_size, preprocessor):
    images = listdir(path)
    shuffle(images)
    calibration_images = images[:num_cal]

    for image in calibration_images:
        img = cv2.imread(path + image)
        img = cv2.resize(img, dsize=input_size, interpolation=cv2.INTER_AREA)
        img = np.expand_dims(img, axis=0)
        img = preprocessor(img.astype('float32'))
        yield [img]

def convert(keras_model_path, ref_dataset, num_cal, input_size, preprocessor):
    converter = tf.lite.TFLiteConverter.from_keras_model_file(
        model_file=keras_model_path)

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

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--input',
        type=str,
        required=True,
        help='keras .h5 model to convert ')
    ap.add_argument('--ref_dataset',
        type=str,
        default='/home/lindo/develop/smart-zoneminder/face-det-rec/dataset/Unknown/',
        help='input dataset for calibration')
    ap.add_argument('--num_cal',
        type=int,
        default=100,
        help='number of images to use for calibration')
    ap.add_argument('--output',
        type=str,
        required=True,
        help='name of converted output model')
    args = vars(ap.parse_args())

    logging.basicConfig(format='%(asctime)s %(name)-12s %(levelname)-8s %(message)s',
        level=logging.INFO)

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
    tflite_quant_model = convert(args['input'],
        args['ref_dataset'],
        args['num_cal'],
        input_size,
        preprocessor)

    # Save converted model. 
    with open(args['output'], 'wb') as file:
        file.write(tflite_quant_model)

    logger.info('Quantized tflite model saved to {}'.format(args['output']))

if __name__ == '__main__':
    main()