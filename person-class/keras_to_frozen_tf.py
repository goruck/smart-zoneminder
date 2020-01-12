"""
Save a keras .h5 model as frozen TF .pb model for inference.

Needs to be run in the "od" Python virtenv.

This is part of the smart-zoneminder project.
See https://github.com/goruck/smart-zoneminder

Copyright (c) 2020 Lindo St. Angel
"""

import os
import tensorflow as tf
import argparse
import logging

logger = logging.getLogger(__name__)

def convert(keras_model_path, tf_model_path):
    logger.info('Starting conversion of keras model to frozen TF model.')

    dirname = os.path.dirname(tf_model_path)
    fname = os.path.basename(tf_model_path)

    tf.compat.v1.keras.backend.set_learning_phase(0)

    model = tf.keras.models.load_model(keras_model_path, compile=False)

    input_node_names = [node.op.name for node in model.inputs]
    logger.info('Input node name(s) are: {}'.format(input_node_names))

    output_node_names = [node.op.name for node in model.outputs]
    logger.info('Output node name(s) are: {}'.format(output_node_names))

    sess = tf.compat.v1.keras.backend.get_session()
    constant_graph = tf.compat.v1.graph_util.convert_variables_to_constants(
        sess,
        sess.graph.as_graph_def(),
        output_node_names)

    tf.io.write_graph(constant_graph, dirname, fname, as_text=False)
    logger.info('Saved the frozen graph at {}'.format(tf_model_path))

    return

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cnn_base',
        default='MobileNetV2',
        help='keras CNN base model name')
    ap.add_argument('--output',
        default='/home/lindo/develop/smart-zoneminder/person-class/train-results',
        help='location of output folder')
    args = vars(ap.parse_args())

    cnn_base = args['cnn_base']
    assert cnn_base in {'VGG16','InceptionResNetV2', 'MobileNetV2', 'ResNet50'},'Unknown base'

    save_path = args['output']+'/'+cnn_base

    logging.basicConfig(format='%(asctime)s %(name)-12s %(levelname)-8s %(message)s',
        level=logging.INFO)

    convert(save_path+'-person-classifier.h5', save_path+'-person-classifier.pb')

if __name__ == "__main__":
    main()