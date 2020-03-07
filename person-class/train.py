"""
Fine-tune a CNN to classify persons in my family.

This is part of the smart-zoneminder project.
See https://github.com/goruck/smart-zoneminder

Copyright (c) 2019, 2020 Lindo St. Angel
"""

import os
import tempfile
import logging
import argparse
import pandas as pd
import matplotlib.pyplot as plt
import tensorflow as tf
import keras_to_frozen_tf
import keras_to_tflite_quant
import subprocess
import numpy as np
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.model_selection import train_test_split
from collections import Counter
from sys import exit
from glob import glob
from itertools import product

logger = logging.getLogger(__name__)

def plot_confusion_matrix(cm, class_names):
    """
    Returns a matplotlib figure containing the plotted confusion matrix.

    Parameters:
    cm (array, shape = [n, n]): a confusion matrix of integer classes
    class_names (array, shape = [n]): String names of the integer classes
    """
    figure = plt.figure(figsize=(8, 8))
    ax = plt.gca()
    im = ax.imshow(cm, interpolation='nearest', cmap=plt.cm.Blues)
    plt.title("Confusion matrix")
    plt.colorbar(im, fraction=0.046, pad=0.04)
    tick_marks = np.arange(len(class_names))
    plt.xticks(tick_marks, class_names, rotation=45)
    plt.yticks(tick_marks, class_names)

    # Normalize the confusion matrix.
    cm = np.around(cm.astype('float') / cm.sum(axis=1)[:, np.newaxis], decimals=2)

    # Use white text if squares are dark; otherwise black.
    threshold = cm.max() / 2.
    for i, j in product(range(cm.shape[0]), range(cm.shape[1])):
        color = "white" if cm[i, j] > threshold else "black"
        plt.text(j, i, cm[i, j], horizontalalignment="center", color=color)

    plt.tight_layout()
    plt.ylabel('True label')
    plt.xlabel('Predicted label')
    return figure

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
    return

def add_regularization(model, regularizer=tf.keras.regularizers.l2(0.0001)):
    # Ref: https://sthalles.github.io/keras-regularizer
    if not isinstance(regularizer, tf.keras.regularizers.Regularizer):
        logger.error('Regularizer must be a subclass of tf.keras.regularizers.Regularizer.')
        return model

    for layer in model.layers:
        for attr in ['kernel_regularizer']:
            if hasattr(layer, attr):
                setattr(layer, attr, regularizer)

    # When we change the layers attributes, the change only happens in the model config file
    model_json = model.to_json()

    # Save the weights before reloading the model.
    tmp_weights_path = os.path.join(tempfile.gettempdir(), 'tmp_weights.h5')
    model.save_weights(tmp_weights_path)

    # load the model from the config
    model = tf.keras.models.model_from_json(model_json)

    # Reload the model weights
    model.load_weights(tmp_weights_path, by_name=True)

    return model

def get_dataframe(dataset, seed=None, shuffle=True,
    alt_subfolder='no_faces', alt_label='Unknown', use_alt=False):
    """
    Generate a dataframe containing labeled image paths.
    Labels are extracted from folder names in dataset.
    Images in subfolders can be labled differently from parent.
    
    Parameters:
    dataset - (str) path to dataset contains images in named folders.
    seed - (int) seed for random operations.
    shuffle - (boolean) to randomly shuffle rows of dataframe.
    alt_subfolder - (str) subfolder with images that can have alternate labels.
    alt_label - (str) alternate label.
    use_alt - (boolean) to use alt images with an alt label.

    Returns:
    df - dataframe containing labeled image paths as rows.
    """
    logger.info(f'Getting dataframe with alt_label: {use_alt}.')
    imagePaths = glob(dataset + '**/*.*', recursive=True)
    filenames = []
    labels = []

    for imagePath in imagePaths:
        filename = os.path.abspath(imagePath)
        filenames.append(filename)
        label = imagePath.split(os.path.sep)[-2]
        # if alt subfolder name is found...
        if label == alt_subfolder:
            if use_alt: # ...label as alt
                label = alt_label
            else: # ...label as parent folder name
                label = imagePath.split(os.path.sep)[-3]
        labels.append(label)

    d = {'filename': filenames, 'class': labels}
    df = pd.DataFrame(data=d)

    if shuffle:
        df = df.sample(frac=1, random_state=seed).reset_index(drop=True)

    return df

def create_model(base, num_classes):
    """
    NB: Do not use "max" pooling in any model. It has an op (REDUCE_MAX) than cannot be quantized.

    dropout ref: # http://jmlr.org/papers/volume15/srivastava14a/srivastava14a.pdf
    """
    logger.info('Creating model with cnn base: {}'.format(base))
    if base == 'InceptionResNetV2': 
        # Setup hyperparamters.
        BATCH_SIZE = 32
        DENSE_UNITS = 128
        DROPOUT = 0.2
        LEARNING_RATE = 1e-4
        L2_PENALTY = 1e-4
        FREEZE = 200 # Freeze all layers less than this (InceptionResNetV2 has 780 layers).

        logger.info('batch size: {}, dense units {}, dropout: {}'
            .format(BATCH_SIZE, DENSE_UNITS, DROPOUT))
        logger.info('learning rate: {}, l2 penalty: {}, freeze {}'
            .format(LEARNING_RATE, L2_PENALTY, FREEZE))

        base_model = tf.keras.applications.inception_resnet_v2.InceptionResNetV2(weights='imagenet',
            include_top=False,
            pooling='avg',
            input_shape=(299,299,3))

        # Uncomment below to modify base model kernel regularizers for fine-tuning.
        # This may improve accuracy in some cases at expense of training time. 
        #add_regularization(base_model, tf.keras.regularizers.l2(L2_PENALTY))

        base_model.trainable = False

        model = tf.keras.models.Sequential()
        model.add(base_model)
        model.add(tf.keras.layers.Dense(DENSE_UNITS, activation='relu',
            kernel_regularizer=tf.keras.regularizers.l2(L2_PENALTY)))
        model.add(tf.keras.layers.Dropout(rate=DROPOUT))
        model.add(tf.keras.layers.Dense(num_classes, activation='softmax',
            kernel_regularizer=tf.keras.regularizers.l2(L2_PENALTY)))

        model.compile(loss=tf.keras.losses.CategoricalCrossentropy(label_smoothing=0.1),
            optimizer=tf.keras.optimizers.Adam(lr=LEARNING_RATE),
            metrics=['accuracy', tf.keras.metrics.Precision(),
                tf.keras.metrics.Recall()])

        pass2_lr = LEARNING_RATE/10
        preprocessor = tf.keras.applications.inception_resnet_v2.preprocess_input
    elif base == 'NASNetLarge': 
        # Setup hyperparamters.
        BATCH_SIZE = 16 # use caution increasing as this will cause OOM
        DENSE_UNITS = 128
        DROPOUT = 0.2
        LEARNING_RATE = 1e-4
        L2_PENALTY = 1e-4
        FREEZE = 266 # Freeze all layers less than this (NASNetLarge has 1039 layers).

        logger.info('batch size: {}, dense units {}, dropout: {}'
            .format(BATCH_SIZE, DENSE_UNITS, DROPOUT))
        logger.info('learning rate: {}, l2 penalty: {}, freeze {}'
            .format(LEARNING_RATE, L2_PENALTY, FREEZE))

        base_model = tf.keras.applications.nasnet.NASNetLarge(weights='imagenet',
            include_top=False,
            pooling='max', # won't complie on the edge tpu anyhow...
            input_shape=(331,331,3))

        base_model.trainable = False

        model = tf.keras.models.Sequential()
        model.add(base_model)
        model.add(tf.keras.layers.Dense(DENSE_UNITS, activation='relu',
            kernel_regularizer=tf.keras.regularizers.l2(L2_PENALTY)))
        model.add(tf.keras.layers.Dropout(rate=DROPOUT))
        model.add(tf.keras.layers.Dense(num_classes, activation='softmax',
            kernel_regularizer=tf.keras.regularizers.l2(L2_PENALTY)))

        model.compile(loss=tf.keras.losses.CategoricalCrossentropy(label_smoothing=0.1),
            optimizer=tf.keras.optimizers.Adam(lr=LEARNING_RATE),
            metrics=['accuracy', tf.keras.metrics.Precision(),
                tf.keras.metrics.Recall()])

        pass2_lr = LEARNING_RATE/10
        preprocessor = tf.keras.applications.nasnet.preprocess_input
    elif base == 'NASNetMobile': 
        # Setup hyperparamters.
        BATCH_SIZE = 32
        DENSE_UNITS = 128
        DROPOUT = 0.2
        LEARNING_RATE = 1e-4
        L2_PENALTY = 1e-4
        FREEZE = 200 # Freeze all layers less than this (NASNetMobile has 769 layers).

        logger.info('batch size: {}, dense units {}, dropout: {}'
            .format(BATCH_SIZE, DENSE_UNITS, DROPOUT))
        logger.info('learning rate: {}, l2 penalty: {}, freeze {}'
            .format(LEARNING_RATE, L2_PENALTY, FREEZE))

        base_model = tf.keras.applications.nasnet.NASNetMobile(weights='imagenet',
            include_top=False,
            pooling='avg',
            input_shape=(224,224,3))

        base_model.trainable = False

        model = tf.keras.models.Sequential()
        model.add(base_model)
        model.add(tf.keras.layers.Dense(DENSE_UNITS, activation='relu',
            kernel_regularizer=tf.keras.regularizers.l2(L2_PENALTY)))
        model.add(tf.keras.layers.Dropout(rate=DROPOUT))
        model.add(tf.keras.layers.Dense(num_classes, activation='softmax',
            kernel_regularizer=tf.keras.regularizers.l2(L2_PENALTY)))

        model.compile(loss=tf.keras.losses.CategoricalCrossentropy(label_smoothing=0.1),
            optimizer=tf.keras.optimizers.Adam(lr=LEARNING_RATE),
            metrics=['accuracy', tf.keras.metrics.Precision(),
                tf.keras.metrics.Recall()])

        pass2_lr = LEARNING_RATE/10
        preprocessor = tf.keras.applications.nasnet.preprocess_input
    elif base == 'MobileNetV2': 
        # Setup hyperparamters.
        BATCH_SIZE = 32
        DENSE_UNITS = 128
        DROPOUT = 0.2
        LEARNING_RATE = 5e-4
        L2_PENALTY = 1e-4
        FREEZE = 75 # Freeze all layers less than this (MobileNetV2 has 155 layers).

        logger.info('batch size: {}, dense units {}, dropout: {}'
            .format(BATCH_SIZE, DENSE_UNITS, DROPOUT))
        logger.info('learning rate: {}, l2 penalty: {}, freeze {}'
            .format(LEARNING_RATE, L2_PENALTY, FREEZE))

        base_model = tf.keras.applications.mobilenet_v2.MobileNetV2(weights='imagenet',
            include_top=False,
            pooling='avg',
            input_shape=(224,224,3))

        # Uncomment below to modify base model kernel regularizers for fine-tuning.
        # This may improve accuracy in some cases at expense of training time. 
        #add_regularization(base_model, tf.keras.regularizers.l2(L2_PENALTY))

        base_model.trainable = False

        model = tf.keras.models.Sequential()
        model.add(base_model)
        model.add(tf.keras.layers.Dense(DENSE_UNITS, activation='relu',
            kernel_regularizer=tf.keras.regularizers.l2(L2_PENALTY)))
        model.add(tf.keras.layers.Dropout(rate=DROPOUT))
        model.add(tf.keras.layers.Dense(num_classes, activation='softmax',
            kernel_regularizer=tf.keras.regularizers.l2(L2_PENALTY)))

        model.compile(loss=tf.keras.losses.CategoricalCrossentropy(label_smoothing=0.1),
            optimizer=tf.keras.optimizers.Adam(lr=LEARNING_RATE),
            metrics=['accuracy', tf.keras.metrics.Precision(),
                tf.keras.metrics.Recall()])

        pass2_lr = LEARNING_RATE/10
        preprocessor = tf.keras.applications.mobilenet_v2.preprocess_input
    elif base == 'ResNet50': 
        # Setup hyperparamters.
        BATCH_SIZE = 32
        DENSE_UNITS = 128
        DROPOUT = 0.2
        LEARNING_RATE = 1e-4
        L2_PENALTY = 1e-4
        FREEZE = 40 # Freeze all layers less than this (ResNet50 has 175 layers).

        logger.info('batch size: {}, dense units {}, dropout: {}'
            .format(BATCH_SIZE, DENSE_UNITS, DROPOUT))
        logger.info('learning rate: {}, l2 penalty: {}, freeze {}'
            .format(LEARNING_RATE, L2_PENALTY, FREEZE))

        base_model = tf.keras.applications.resnet50.ResNet50(weights='imagenet',
            include_top=False,
            pooling='avg',
            input_shape=(224,224,3))

        # Uncomment below to modify base model kernel regularizers for fine-tuning.
        # This may improve accuracy in some cases at expense of training time. 
        #add_regularization(base_model, tf.keras.regularizers.l2(L2_PENALTY))

        base_model.trainable = False

        model = tf.keras.models.Sequential()
        model.add(base_model)
        model.add(tf.keras.layers.Dense(DENSE_UNITS, activation='relu',
            kernel_regularizer=tf.keras.regularizers.l2(L2_PENALTY)))
        model.add(tf.keras.layers.Dropout(rate=DROPOUT))
        model.add(tf.keras.layers.Dense(num_classes, activation='softmax',
            kernel_regularizer=tf.keras.regularizers.l2(L2_PENALTY)))

        model.compile(loss=tf.keras.losses.CategoricalCrossentropy(label_smoothing=0.1),
            optimizer=tf.keras.optimizers.Adam(lr=LEARNING_RATE),
            metrics=['accuracy', tf.keras.metrics.Precision(),
                tf.keras.metrics.Recall()])

        pass2_lr = LEARNING_RATE/10
        preprocessor = tf.keras.applications.resnet50.preprocess_input
    else: #'VGG16'
        # Setup hyperparamters.
        BATCH_SIZE = 32
        DENSE_UNITS = 128
        DROPOUT = 0.2
        LEARNING_RATE = 1e-4
        L2_PENALTY = 1e-4
        FREEZE = 10 # Freeze all layers less than this (VGG16 has 19 layers).

        logger.info('batch size: {}, dense units {}, dropout: {}'
            .format(BATCH_SIZE, DENSE_UNITS, DROPOUT))
        logger.info('learning rate: {}, l2 penalty: {}, freeze {}'
            .format(LEARNING_RATE, L2_PENALTY, FREEZE))

        base_model = tf.keras.applications.vgg16.VGG16(weights='imagenet',
            include_top=False,
            pooling='avg',
            input_shape=(224,224,3))

        # Uncomment below to modify base model kernel regularizers for fine-tuning.
        # This may improve accuracy in some cases at expense of training time. 
        #add_regularization(base_model, tf.keras.regularizers.l2(L2_PENALTY))

        base_model.trainable = False

        model = tf.keras.models.Sequential()
        model.add(base_model)
        model.add(tf.keras.layers.Dense(DENSE_UNITS, activation='relu',
            kernel_regularizer=tf.keras.regularizers.l2(L2_PENALTY)))
        model.add(tf.keras.layers.Dropout(rate=DROPOUT))
        model.add(tf.keras.layers.Dense(num_classes, activation='softmax',
            kernel_regularizer=tf.keras.regularizers.l2(L2_PENALTY)))

        model.compile(loss=tf.keras.losses.CategoricalCrossentropy(label_smoothing=0.1),
            optimizer=tf.keras.optimizers.Adam(lr=LEARNING_RATE),
            metrics=['accuracy', tf.keras.metrics.Precision(),
                tf.keras.metrics.Recall()])

        pass2_lr = LEARNING_RATE/10
        preprocessor = tf.keras.applications.vgg16.preprocess_input

    return model, pass2_lr, preprocessor, BATCH_SIZE, FREEZE

def main():
    # Construct the argument parser and parse the arguments.
    ap = argparse.ArgumentParser()
    ap.add_argument('--cnn_base',
        default='MobileNetV2',
        help='keras CNN base model name')
    ap.add_argument('--no_pass1',
        action='store_true',
        default=False,
        help='do not run pass 1 training')
    ap.add_argument('--do_not_use_pass1_model',
        action='store_true',
        default=False,
        help='do not init pass2 with last pass1 model (ignored unless no_pass1 set)')
    ap.add_argument('--dataset',
        default='/home/lindo/develop/smart-zoneminder/face-det-rec/dataset/',
        help='location of input dataset')
    ap.add_argument('--output',
        default='/home/lindo/develop/smart-zoneminder/person-class/train-results/',
        help='location of output folder')
    ap.add_argument('--no_test',
        action='store_true',
        default=False,
        help='do not make predictions on final model from test set')
    ap.add_argument('--save_tf',
        action='store_true',
        default=False,
        help='save frozen TF model to output folder')
    ap.add_argument('--no_saved_model',
        action='store_true',
        default=False,
        help='do not export best pass 2 model to SavedModel format')
    ap.add_argument('--no_data_augment',
        action='store_true',
        default=False,
        help='do not augment training data')
    ap.add_argument('--no_save_tflite',
        action='store_true',
        default=False,
        help='do not save quantized tflite model')
    ap.add_argument('--no_save_edge_tpu',
        action='store_true',
        default=False,
        help='do not save edge tpu model')
    ap.add_argument('--epochs',
        type=int,
        default=500,
        help='max number of fit epochs')
    args = vars(ap.parse_args())

    cnn_base = args['cnn_base']
    assert cnn_base in {'VGG16','InceptionResNetV2', 'MobileNetV2',
        'ResNet50', 'NASNetLarge', 'NASNetMobile'},'Unknown base'

    run_pass1 = not args['no_pass1']
    use_pass1_model = not args['do_not_use_pass1_model']
    data_dir = os.path.join(args['dataset'], '')
    run_test = not args['no_test']
    save_tf = args['save_tf']
    saved_model = not args['no_saved_model']
    data_augment = not args['no_data_augment']
    save_tflite = not args['no_save_tflite']
    save_edge_tpu = not args['no_save_edge_tpu']
    fit_epochs = args['epochs']
    save_path = args['output']+cnn_base

    SEED = 1

    logging.basicConfig(filename=save_path+'.log',
        filemode='w',
        format='%(asctime)s %(name)-12s %(levelname)-8s %(message)s',
        level=logging.INFO)

    # Get dataframe of samples, split into train (and val) and (if enabled) test sets.
    df = get_dataframe(dataset=data_dir, seed=SEED)
    if run_test:
        logger.info('Running with test enabled.')
        train_df, test_df = train_test_split(df, test_size=.20, random_state=SEED)
    else:
        train_df = df

    # Get number of classes from data set.
    num_classes = train_df['class'].nunique()
    logger.info(f'Found {num_classes} classes in data set.')

    (model, pass2_lr, preprocessor, batch_size, freeze_layers) = create_model(cnn_base, num_classes)

    input_size = model.input_shape[1:3]

    test_datagen = tf.keras.preprocessing.image.ImageDataGenerator(
        validation_split=.20,
        preprocessing_function=preprocessor)

    validation_generator = test_datagen.flow_from_dataframe(
        train_df,
        subset='validation',
        shuffle=False,
        target_size=input_size,
        batch_size=batch_size,
        seed=SEED)

    if data_augment:
        train_datagen = tf.keras.preprocessing.image.ImageDataGenerator(
            validation_split=.20,
            preprocessing_function=preprocessor,
            rotation_range=40,
            width_shift_range=0.2,
            height_shift_range=0.2,
            shear_range=0.2,
            zoom_range=0.2,
            horizontal_flip=True,
            fill_mode='nearest')
    else:
        train_datagen = test_datagen

    train_generator = train_datagen.flow_from_dataframe(
        train_df,
        subset='training',
        shuffle=True,
        target_size=input_size,
        batch_size=batch_size,
        seed=SEED)

    logger.info('Generating validation dataset.')
    validation_dataset = tf.data.Dataset.from_generator(
        generator=lambda: validation_generator,
        output_types=(tf.float32, tf.float32),
        output_shapes=(tf.TensorShape([None, input_size[0], input_size[1], 3]),
            tf.TensorShape([None, len(train_generator.class_indices)])))

    logger.info('Generating train dataset.')
    train_dataset = tf.data.Dataset.from_generator(
        generator=lambda: train_generator,
        output_types=(tf.float32, tf.float32),
        output_shapes=(tf.TensorShape([None, input_size[0], input_size[1], 3]),
            tf.TensorShape([None, len(train_generator.class_indices)])))

    logger.info('Class dict: {}'.format(train_generator.class_indices))
    logger.info('Number of training samples: {}'.format(train_generator.samples))
    logger.info('Number of validation samples: {}'.format(validation_generator.samples))

    # Training data is unbalanced so use class weighting.
    # Ref: https://datascience.stackexchange.com/questions/13490/how-to-set-class-weights-for-imbalanced-classes-in-keras
    # Ref: https://stackoverflow.com/questions/42586475/is-it-possible-to-automatically-infer-the-class-weight-from-flow-from-directory
    counter = Counter(train_generator.classes)                          
    max_val = float(max(counter.values()))       
    class_weights = {class_id : max_val/num_images for class_id, num_images in counter.items()}
    logger.info('Class weights: {}'.format(class_weights))

    steps_per_epoch = train_generator.samples // train_generator.batch_size
    validation_steps = validation_generator.samples // validation_generator.batch_size
    logger.info('Steps per epoch: {}'.format(steps_per_epoch))
    logger.info('Validation steps: {}'.format(validation_steps))

    if run_pass1:
        # Pass 1: train only the top layers (which were randomly initialized)
        logger.info('Starting pass 1.')

        # Define some useful callbacks. 
        early_stop = tf.keras.callbacks.EarlyStopping(monitor='val_loss',
            mode='min',
            verbose=1,
            patience=10)
        csv_logger = tf.keras.callbacks.CSVLogger(save_path+'-pass1.csv', append=False)
        model_ckpt = tf.keras.callbacks.ModelCheckpoint(filepath=save_path+'-pass1.h5',
            monitor='val_loss',
            verbose=1,
            save_best_only=True)

        # Actual training. 
        history = model.fit(
            x=train_dataset,
            steps_per_epoch=steps_per_epoch,
            epochs=fit_epochs,
            validation_data=validation_dataset,
            validation_steps=validation_steps,
            class_weight=class_weights,
            verbose=1,
            workers=4,
            use_multiprocessing=True,
            callbacks=[early_stop, model_ckpt, csv_logger])

        # Plot and save pass 1 results.
        acc = history.history['accuracy']
        val_acc = history.history['val_accuracy']
        loss = history.history['loss']
        val_loss = history.history['val_loss']
        epochs = range(len(acc))
        plot_two_and_save(epochs, acc, val_acc, 'Smoothed training acc', 'Smoothed validation acc',
            'Pass 1 Training and validation acc', save_path+'-pass1-acc.png')
        plot_two_and_save(epochs, loss, val_loss, 'Smoothed training loss', 'Smoothed validation loss',
            'Pass 1 Training and validation loss', save_path+'-pass1-loss.png')

        # Clear graph in prep for Pass 2.
        tf.keras.backend.clear_session()

        logger.info('Finished pass 1.')

        # Load best pass 1 model to start pass 2. 
        model = tf.keras.models.load_model(save_path+'-pass1.h5', compile=False)
    else:
        # Initiate pass 2 training with existing pass 1 (default) or pass 2 checkpoint.
        path = save_path+'-pass1.h5' if use_pass1_model else save_path+'-person-classifier.h5'

        try:
            model = tf.keras.models.load_model(path, compile=False)
        except IOError as err:
            logger.error(f'Error loading model {err}')
            exit()
        else:
            logger.info(f'Skipping pass 1 and initiating pass 2 with {path}.')

    # Pass 2: fine-tune.
    logger.info('Starting pass 2 with learning rate: {}'.format(pass2_lr))

    # Freeze layers of base model to mitigate overfitting during fine-tuning.
    # Ref: https://ai.googleblog.com/2016/08/improving-inception-and-image.html
    #
    # An input layer is always the first layer (0).
    # A pooling layer (if included) is alaways the last layer.
    #
    # To visualize layer names and indices to understand what to freeze:
    #   for i, layer in enumerate(base_model.layers):
    #       print(i, layer.name)
    base_model_name = model.layers[0].name
    base_model = model.get_layer(base_model_name)
    # Freeze up to 'freeze_layers' layers...
    for layer in base_model.layers[:freeze_layers]:
        layer.trainable = False
    # ...then unfreeze the rest. 
    for layer in base_model.layers[freeze_layers:]:
        layer.trainable = True

    # Compile.
    model.compile(loss=tf.keras.losses.CategoricalCrossentropy(label_smoothing=0.1),
        optimizer=tf.keras.optimizers.Adam(lr=pass2_lr),
        metrics=['accuracy', tf.keras.metrics.Precision(),
                tf.keras.metrics.Recall()])

    # Callbacks.
    early_stop = tf.keras.callbacks.EarlyStopping(monitor='val_loss',
        mode='min',
        verbose=1,
        patience=10)
    csv_logger = tf.keras.callbacks.CSVLogger(save_path+'-person-classifier.csv', append=False)
    model_ckpt = tf.keras.callbacks.ModelCheckpoint(filepath=save_path+'-person-classifier.h5',
        monitor='val_loss',
        verbose=1,
        save_best_only=True)

    # Fit.
    history = model.fit(
        x=train_dataset,
        steps_per_epoch=steps_per_epoch,
        epochs=fit_epochs,
        validation_data=validation_dataset,
        validation_steps=validation_steps,
        class_weight=class_weights,
        verbose=1,
        workers=4,
        use_multiprocessing=True,
        callbacks=[early_stop, model_ckpt, csv_logger])

    # Plot and save pass 2 (final) results.
    acc = history.history['accuracy']
    val_acc = history.history['val_accuracy']
    loss = history.history['loss']
    val_loss = history.history['val_loss']
    epochs = range(len(acc))
    plot_two_and_save(epochs, acc, val_acc, 'Smoothed training acc', 'Smoothed validation acc',
        'Person classifier training and validation accuracy', save_path+'-person-classifier-acc.png')
    plot_two_and_save(epochs, loss, val_loss, 'Smoothed training loss', 'Smoothed validation loss',
        'Person classifier training and validation loss', save_path+'-person-classifier-loss.png')

    logger.info('Finished pass 2.')

    # Export best pass 2 model to SavedModel.
    if saved_model:
        VERSION = 1
        export_path = os.path.join(save_path, str(VERSION))
        best_model = tf.keras.models.load_model(save_path+'-person-classifier.h5',
            compile=False)
        best_model.save(export_path, save_format='tf')
        logger.info('Exported SavedModel to {}'.format(save_path))

    # Evaluate best model on test data.
    if run_test:
        logger.info(f'Evaluating model on {len(test_df.index)} test samples.')

        # Load the best model from disk that was the last saved checkpoint.
        best_model = tf.keras.models.load_model(save_path+'-person-classifier.h5',
            compile=False)

        test_generator = test_datagen.flow_from_dataframe(
            test_df,
            target_size=input_size,
            batch_size=batch_size,
            shuffle=False,
            seed=SEED)

        test_steps = np.math.ceil(
            test_generator.samples / test_generator.batch_size)

        predictions = best_model.predict(
            test_generator,
            steps=test_steps,
            verbose=1,
            workers=4)

        predicted_classes = np.argmax(predictions, axis=1)
        true_classes = test_generator.classes
        class_labels = list(test_generator.class_indices.keys())

        # Generate classification report.
        class_report = classification_report(true_classes,
            predicted_classes, target_names=class_labels)
        logger.info('Classification report:\n{}'.format(class_report))

        # Generate confusion matrix.
        cm = confusion_matrix(true_classes, predicted_classes)
        logger.info(f'Confusion matrix:\n{cm}')
        cm_figure = plot_confusion_matrix(cm, class_names=class_labels)
        cm_figure.savefig(save_path+'-person-classifier-cm.png')
        cm_figure.clf()

        # Clear graph in prep for next step.
        tf.keras.backend.clear_session()

    # Save frozen TF model.
    if save_tf:
        keras_to_frozen_tf.convert(save_path+'-person-classifier.h5',
            save_path+'-person-classifier.pb')
        # Clear graph in prep for next step.
        tf.keras.backend.clear_session()

    # Save quantized tflite model.
    # Model is quantized to 8-bits (uint8) for use on edge tpu. 
    if save_tflite:
        # Load best keras model from disk.
        best_model = tf.keras.models.load_model(save_path+'-person-classifier.h5',
            compile=False)
        # Reference dataset for quantization calibration.
        REF_FOLDER = 'Unknown/'
        ref_dataset = os.path.join(data_dir, REF_FOLDER)
        # Number of calibration images to use from ref dataset.
        NUM_CAL = 100

        try:
            tflite_quant_model = keras_to_tflite_quant.convert(
                keras_model=best_model,
                ref_dataset=ref_dataset, num_cal=NUM_CAL,
                input_size=input_size, preprocessor=preprocessor)
        except RuntimeError as err:
            save_edge_tpu = False # inhibit edge tpu model compilation
            logger.error(f'Error quantizing model:\n{err}')
        else:
            output = save_path+'-person-classifier-quant.tflite'
            with open(output, 'wb') as file:
                file.write(tflite_quant_model)
            logger.info(f'Quantized tflite model saved to: {output}')

        # Clear graph in prep for next step.
        tf.keras.backend.clear_session()

    # Save quantized tflite model for Coral edge tpu.
    if save_edge_tpu:
        cmd = ['edgetpu_compiler',
            save_path+'-person-classifier-quant.tflite', '-o', args['output']]

        try:
            res = subprocess.run(cmd, stdout=subprocess.PIPE)
        except FileNotFoundError as err:
            logger.error('The edge tpu complier is not installed:\n{}.'.format(err))
            exit()

        logger.info('Edge TPU model compilation results:\n{}'.format(res.stdout.decode('utf-8')))

if __name__ == "__main__":
    main()