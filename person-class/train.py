"""
Fine-tune a CNN to classify persons in my family.

Needs to be run in the "od" Python virtenv.

This is part of the smart-zoneminder project.
See https://github.com/goruck/smart-zoneminder

Copyright (c) 2019 Lindo St. Angel
"""

import os
import logging
import argparse
import matplotlib.pyplot as plt
from collections import Counter
from sys import exit
from tensorflow.python.framework import graph_util
from tensorflow.python.framework import graph_io
from keras import models, layers, optimizers
from keras.applications.vgg16 import VGG16
from keras.applications.vgg16 import preprocess_input as vgg16_preprocess_input
from keras.applications.inception_resnet_v2 import InceptionResNetV2
from keras.applications.inception_resnet_v2 import preprocess_input as inception_preprocess_input
# Avoid "TypeError: init() got an unexpected keyword argument 'interpolation_order'" in Keras 2.3.0
#from keras.preprocessing.image import ImageDataGenerator
from tensorflow.keras.preprocessing.image import ImageDataGenerator
from keras.callbacks import EarlyStopping, ModelCheckpoint, CSVLogger
from keras.constraints import MaxNorm
from keras.regularizers import l2
from keras import backend as K

# Construct the argument parser and parse the arguments.
ap = argparse.ArgumentParser()
ap.add_argument('-bs', '--batch_size', type=int,
    default=32,
    help='batch size')
ap.add_argument('-cb', '--cnn_base', type=str,
    default='InceptionResNetV2',
    help='keras CNN base model name (InceptionResNetV2 or VGG16)')
ap.add_argument('-r', '--regularizer', type=str,
    default='dropout',
    help='regularizer method (dropout or l2)')
ap.add_argument('-p1', '--pass1', type=bool,
    default=False,
    help='run pass 1 training')
ap.add_argument('-d', '--dataset', type=str,
    default='/home/lindo/develop/smart-zoneminder/person-class/dataset',
    help='location of input dataset (defaults to ./dataset.')
ap.add_argument('-o', '--output', type=str,
    default='/home/lindo/develop/smart-zoneminder/person-class/train-results',
    help='location of output folder (defaults to ./train-results).')
ap.add_argument('-t', '--test', type=bool,
    default=False,
    help='Make predictions from final model on test set.')
ap.add_argument('-stf', '--save_TF', type=bool,
    default=False,
    help='Save inference-optimized TF model to output folder.')
args = vars(ap.parse_args())

BATCH_SIZE = args['batch_size']
CNN_BASE = args['cnn_base']
assert CNN_BASE in {'VGG16','InceptionResNetV2'},'Must be "VGG16" or "InceptionResNetV2"'
REGULARIZER = args['regularizer']
assert REGULARIZER in {'dropout','l2'},'Must be "dropout" or "l2"'
RUN_PASS1 = args['pass1']
DATA_DIR = args['dataset']
RESULTS_DIR = args['output']
RUN_TEST = args['test']
SAVE_TF = args['save_TF']
DENSE1_UNITS = 128
DENSE2_UNITS = 128

logging.basicConfig(filename=RESULTS_DIR+'/train-'+CNN_BASE+'.log',
    filemode='w',
    level=logging.INFO)

def smooth_curve(points, factor=0.8):
    smoothed_points = []
    for point in points:
        if smoothed_points:
            previous = smoothed_points[-1]
            smoothed_points.append(previous * factor + point * (1 - factor))
        else:
            smoothed_points.append(point)
    return smoothed_points

def plot_two_and_save(x, y1, y2, label1, label2, title, save_name, smooth=True):
    plt.figure()
    plt.plot(x, (y1, smooth_curve(y1))[smooth], 'bo', label=label1)
    plt.plot(x, (y2, smooth_curve(y2))[smooth], 'b',  label=label2)
    plt.title(title)
    plt.legend()
    plt.savefig(save_name)
    #plt.show()
    plt.clf()
    plt.close()

def freeze_layers(model):
    base_model_name = model.layers[0].name
    base_model = model.get_layer(base_model_name)
    """
    To visualize layer names and indices to understand what to freeze:
    See https://ai.googleblog.com/2016/08/improving-inception-and-image.html
    for i, layer in enumerate(base_model.layers):
       print(i, layer.name)

    InceptionResNetV2:

    Inception Block   1st Layer Name    Layer Index
    ===============   ==============    ===========
    1                 conv2d_201        762
    2                 conv2d_197        746
    3                 conv2d_193        730 <-- Unfreeze up from here
    4                 conv2d_189        714
    5                 conv2d_185        698
    6                 conv2d_181        682
    7                 conv2d_177        666
    8                 conv2d_173        650
    9                 conv2d_169        634
    10                conv2d_165        618
    
    VGG16:

    Layer Name      Layer Index
    ==========      ===========
    input_1         0
    block1_conv1    1
    block1_conv2    2
    block1_pool     3
    block2_conv1    4
    block2_conv2    5
    block2_pool     6
    block3_conv1    7
    block3_conv2    8
    block3_conv3    9
    block3_pool     10
    block4_conv1    11
    block4_conv2    12
    block4_conv3    13
    block4_pool     14
    block5_conv1    15 <-- Unfreeze up from here
    block5_conv2    16
    block5_conv3    17
    block5_pool     18
    """

    if base_model_name == 'inception_resnet_v2':
        freeze = 730
    elif base_model_name == 'vgg16':
        freeze = 15
    else:
        logging.error('error: unknown base model name')
        exit()

    # Freeze up to 'freeze' layers and then unfreeze rest.
    for layer in base_model.layers[:freeze]:
        layer.trainable = False

    for layer in base_model.layers[freeze:]:
        layer.trainable = True

    return

def recall(y_true, y_pred):
    true_positives = K.sum(K.round(K.clip(y_true * y_pred, 0, 1)))
    possible_positives = K.sum(K.round(K.clip(y_true, 0, 1)))
    recall = true_positives / (possible_positives + K.epsilon())
    return recall

def precision(y_true, y_pred):
    true_positives = K.sum(K.round(K.clip(y_true * y_pred, 0, 1)))
    predicted_positives = K.sum(K.round(K.clip(y_pred, 0, 1)))
    precision = true_positives / (predicted_positives + K.epsilon())
    return precision

def keras_to_tensorflow(keras_model_path, tf_model_path):
    """
    Save a keras .h5 model as frozen TF .pb model for inference.
    """
    logging.info('Starting coversion of keras model to frozen TF model.')
    dirname = os.path.dirname(tf_model_path)
    fname = os.path.basename(tf_model_path)
    K.set_learning_phase(0)
    model = models.load_model(keras_model_path,
        custom_objects={'precision': precision, 'recall': recall})
    input_node_names = [node.op.name for node in model.inputs]
    logging.info('Input node name(s) are: {}'.format(input_node_names))
    output_node_names = [node.op.name for node in model.outputs]
    logging.info('Output node name(s) are: {}'.format(output_node_names))
    sess = K.get_session()
    constant_graph = graph_util.convert_variables_to_constants(
        sess,
        sess.graph.as_graph_def(),
        output_node_names)
    graph_io.write_graph(constant_graph, dirname, fname, as_text=False)
    logging.info('Saved the frozen graph at {}'.format(tf_model_path))
    return

class CreateModel(object):
    def __init__(self, base_model):
        if base_model == 'InceptionResNetV2':
            self.base_model = InceptionResNetV2(weights='imagenet',
                include_top=False,
                input_shape=(299,299,3))
            self.base_model.trainable = False
            self.preprocessor = inception_preprocess_input
        elif base_model == 'VGG16':
            self.base_model = VGG16(weights='imagenet',
                include_top=False,
                input_shape=(224, 224, 3))
            self.base_model.trainable = False
            self.preprocessor = vgg16_preprocess_input
    def l2(self):
        LEARNING_RATE = 1e-4
        model = models.Sequential()
        model.add(self.base_model)
        model.add(layers.GlobalAveragePooling2D())
        model.add(layers.Dense(DENSE1_UNITS, activation='relu',
            kernel_regularizer=l2(0.01)))
        model.add(layers.Dense(DENSE2_UNITS, activation='relu',
            kernel_regularizer=l2(0.01)))
        model.add(layers.Dense(5, activation='softmax'))
        model.compile(loss='categorical_crossentropy',
            optimizer=optimizers.Adam(lr=LEARNING_RATE),
            metrics=['acc', precision, recall])
        return model, LEARNING_RATE, self.preprocessor
    def dropout(self):
        # See http://jmlr.org/papers/volume15/srivastava14a/srivastava14a.pdf
        LEARNING_RATE = 1e-3
        DROPOUT = 0.3
        model = models.Sequential()
        model.add(self.base_model)
        model.add(layers.GlobalAveragePooling2D())
        model.add(layers.Dense(int(DENSE1_UNITS/(1-DROPOUT)), activation='relu',
            kernel_constraint=MaxNorm(max_value=3.)))
        model.add(layers.Dropout(DROPOUT))
        model.add(layers.Dense(int(DENSE2_UNITS/(1-DROPOUT)), activation='relu',
            kernel_constraint=MaxNorm(max_value=3.)))
        model.add(layers.Dropout(DROPOUT))
        model.add(layers.Dense(5, activation='softmax'))
        model.compile(loss='categorical_crossentropy',
            optimizer=optimizers.Adam(lr=LEARNING_RATE),
            metrics=['acc', precision, recall])
        return model, LEARNING_RATE, self.preprocessor

if REGULARIZER == 'dropout':
    model, learning_rate, preprocessor = CreateModel(CNN_BASE).dropout()
else:
    model, learning_rate, preprocessor = CreateModel(CNN_BASE).l2()

input_size = model.input_shape[1:3]

train_dir = os.path.join(DATA_DIR, 'train')
validation_dir = os.path.join(DATA_DIR, 'validation')

train_datagen = ImageDataGenerator(
    rescale=None,
    preprocessing_function=preprocessor,
    rotation_range=40,
    width_shift_range=0.2,
    height_shift_range=0.2,
    shear_range=0.2,
    zoom_range=0.2,
    horizontal_flip=True,
    fill_mode='nearest')

train_generator = train_datagen.flow_from_directory(
    train_dir,
    target_size=input_size,
    batch_size=BATCH_SIZE,
    shuffle=True,
    class_mode='categorical')

logging.info('train gen length: {}'.format(len(train_generator)))
logging.info('class dict: {}'.format(train_generator.class_indices))

test_datagen = ImageDataGenerator(
    rescale=None,
    preprocessing_function=preprocessor)

validation_generator = test_datagen.flow_from_directory(
    validation_dir,
    target_size=input_size,
    batch_size=BATCH_SIZE,
    shuffle=True,
    class_mode='categorical')

logging.info('validation gen length: {}'.format(len(validation_generator)))

# Training data is unbalanced so use class weighting.
# Ref: https://datascience.stackexchange.com/questions/13490/how-to-set-class-weights-for-imbalanced-classes-in-keras
# Ref: https://stackoverflow.com/questions/42586475/is-it-possible-to-automatically-infer-the-class-weight-from-flow-from-directory
counter = Counter(train_generator.classes)                          
max_val = float(max(counter.values()))       
class_weights = {class_id : max_val/num_images for class_id, num_images in counter.items()}
logging.info('class weights {}'.format(class_weights))

if RUN_PASS1:
    # Pass 1: train only the top layers (which were randomly initialized)
    logging.info('Starting pass 1.')
    # Define some useful callbacks. 
    early_stop = EarlyStopping(monitor='val_loss',
        mode='min',
        verbose=2,
        patience=10)
    csv_logger = CSVLogger(RESULTS_DIR+'/pass1-history-'+CNN_BASE+'.csv', append=False)
    model_ckpt = ModelCheckpoint(filepath=RESULTS_DIR+'/pass1-'+CNN_BASE+'.h5',
        monitor='val_loss',
        verbose=2,
        save_best_only=True)
    # Actual training. 
    history = model.fit_generator(
        train_generator,
        steps_per_epoch=len(train_generator),
        epochs=500,
        validation_data=validation_generator,
        validation_steps=len(validation_generator),
        class_weight=class_weights,
        verbose=2,
        workers=4,
        callbacks=[early_stop, model_ckpt, csv_logger])
    # Plot and save pass 1 results.
    acc = history.history['acc']
    val_acc = history.history['val_acc']
    loss = history.history['loss']
    val_loss = history.history['val_loss']
    epochs = range(len(acc))
    plot_two_and_save(epochs, acc, val_acc, 'Smoothed training acc', 'Smoothed validation acc',
        'Pass 1 Training and validation acc', RESULTS_DIR + '/pass1-acc-'+CNN_BASE+'.png')
    plot_two_and_save(epochs, loss, val_loss, 'Smoothed training loss', 'Smoothed validation loss',
        'Pass 1 Training and validation loss', RESULTS_DIR + '/pass1-loss-'+CNN_BASE+'.png')
    # Clear graph in prep for Pass 2.
    K.clear_session()
    logging.info('Finished pass 1.')

# Pass 2: fine-tune.
logging.info('Starting pass2.')
best_pass1_model = models.load_model(RESULTS_DIR+'/pass1-'+CNN_BASE+'.h5',
    custom_objects={'precision': precision, 'recall': recall})

# Selectively freeze layers to mitigate overfitting. 
freeze_layers(best_pass1_model)

best_pass1_model.compile(loss='categorical_crossentropy',
    optimizer=optimizers.Adam(lr=learning_rate/5),
    metrics=['acc', precision, recall])

early_stop = EarlyStopping(monitor='val_loss',
    mode='min',
    verbose=2,
    patience=10)

csv_logger = CSVLogger(RESULTS_DIR+'/pass2-history-'+CNN_BASE+'.csv', append=False)

model_ckpt = ModelCheckpoint(filepath=RESULTS_DIR+'/person-classifier-'+CNN_BASE+'.h5',
    monitor='val_loss',
    verbose=2,
    save_best_only=True)

history = best_pass1_model.fit_generator(
    train_generator,
    steps_per_epoch=len(train_generator),
    epochs=500,
    validation_data=validation_generator,
    validation_steps=len(validation_generator),
    class_weight=class_weights,
    verbose=2,
    workers=4,
    callbacks=[early_stop, model_ckpt, csv_logger])

# Plot and save pass 2 results.
acc = history.history['acc']
val_acc = history.history['val_acc']
loss = history.history['loss']
val_loss = history.history['val_loss']
epochs = range(len(acc))
plot_two_and_save(epochs, acc, val_acc, 'Smoothed training acc', 'Smoothed validation acc',
    'Pass 2 Training and validation acc', RESULTS_DIR + '/pass2-acc-'+CNN_BASE+'.png')
plot_two_and_save(epochs, loss, val_loss, 'Smoothed training loss', 'Smoothed validation loss',
    'Pass 2 Training and validation loss', RESULTS_DIR + '/pass2-loss-'+CNN_BASE+'.png')

# Clear graph in prep for next step.
K.clear_session()

# Evaluate best model on the test data.
if RUN_TEST:
    test_dir = os.path.join(DATA_DIR, 'test')
    test_generator = test_datagen.flow_from_directory(
        test_dir,
        target_size=input_size,
        batch_size=BATCH_SIZE,
        shuffle=True,
        class_mode='categorical')
    # Load the best model from disk that was the last saved checkpoint.
    best_model = models.load_model(RESULTS_DIR+'/person-classifier-'+CNN_BASE+'.h5',
        custom_objects={'precision': precision, 'recall': recall})
    test_loss, test_acc = best_model.evaluate_generator(test_generator, steps=len(test_generator))
    logging.info('test acc: {} test loss {}'.format(test_acc, test_loss))
    # Clear graph in prep for next step.
    K.clear_session()

# Save inference-optimized TF model.
if SAVE_TF:
    keras_to_tensorflow(RESULTS_DIR+'/person-classifier-'+CNN_BASE+'.h5',
        RESULTS_DIR+'/person-classifier-'+CNN_BASE+'.pb')