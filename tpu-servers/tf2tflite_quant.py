'''
Post-training quantization of TF frozen model and conversion to TFlite model.
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
from random import shuffle
from os import listdir

preprocessor = tf.keras.applications.imagenet_utils.preprocess_input

ap = argparse.ArgumentParser()
ap.add_argument('-m', '--model', type=str,
    default='./train-results/VGG16-person-classifier.pb',
    help='tf .pb model to convert')
ap.add_argument('-s', '--input_size', type=int,
    default=224,
    help='input size of model')
ap.add_argument('-mi', '--model_inputs', type=str,
    default='vgg16_input',
    help='input name(s) of model')
ap.add_argument('-mo', '--model_outputs', type=str,
    default='dense_1/Softmax',
    help='output name(s) of model')
ap.add_argument('-p', '--path', type=str,
    default='/home/lindo/develop/smart-zoneminder/face-det-rec/dataset/Unknown/',
    help='location of input dataset for calibration')
ap.add_argument('-n', '--num_cal', type=int,
    default=100,
    help='number of images to use for calibration')
ap.add_argument('-o', '--output', type=str,
    default='./train-results/VGG16-person-classifier-quant.tflite',
    help='name of converted output model')
args = vars(ap.parse_args())

input_size = (args['input_size'], args['input_size'])

def representative_dataset_gen():
    images = listdir(args['path'])
    shuffle(images)
    num_calibration_images = args['num_cal']
    calibration_images = images[:num_calibration_images]
    for i in calibration_images:
        img = cv2.imread(args['path'] + i)
        img = cv2.resize(img, dsize=input_size, interpolation=cv2.INTER_AREA)
        img = np.expand_dims(img, axis=0)
        img = preprocessor(img.astype('float32'))
        yield [img]

def convert():
    converter = tf.lite.TFLiteConverter.from_frozen_graph(
        graph_def_file=args['model'],
        input_arrays=[args['model_inputs']],
        output_arrays=[args['model_outputs']],
        input_shapes=None)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    converter.representative_dataset = tf.lite.RepresentativeDataset(representative_dataset_gen)
    converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
    converter.inference_input_type = tf.uint8
    converter.inference_output_type = tf.uint8
    return converter.convert()

def main():
    tflite_quant_model = convert()
    with open(args['output'], 'wb') as file:
        file.write(tflite_quant_model)

if __name__ == '__main__':
    main()