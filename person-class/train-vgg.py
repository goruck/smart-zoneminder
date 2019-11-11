"""
Fine-tune vgg16 to classify persons in my family.

Needs to be run in the "keras" Python virtenv.

Copyright (c) 2019 Lindo St. Angel
"""

import os
import logging
import matplotlib.pyplot as plt
from collections import Counter
from keras import models, layers, optimizers
from keras.applications import VGG16
from keras.preprocessing.image import ImageDataGenerator
from keras.callbacks import EarlyStopping, ModelCheckpoint, CSVLogger
from keras.regularizers import l2

RESULTS_DIR = '/home/lindo/develop/smart-zoneminder/person-class/train-results-vgg'
DATA_DIR = '/home/lindo/develop/smart-zoneminder/person-class/dataset'

logging.basicConfig(filename=RESULTS_DIR + '/train.log',
    filemode='w',
    level=20)

def smooth_curve(points, factor=0.8):
    smoothed_points = []
    for point in points:
        if smoothed_points:
            previous = smoothed_points[-1]
            smoothed_points.append(previous * factor + point * (1 - factor))
        else:
            smoothed_points.append(point)
    return smoothed_points

train_dir = os.path.join(DATA_DIR, 'train')
validation_dir = os.path.join(DATA_DIR, 'validation')
test_dir = os.path.join(DATA_DIR, 'test')

train_datagen = ImageDataGenerator(
    rescale=1./255,
    rotation_range=40,
    width_shift_range=0.2,
    height_shift_range=0.2,
    shear_range=0.2,
    zoom_range=0.2,
    horizontal_flip=True,
    fill_mode='nearest')

train_generator = train_datagen.flow_from_directory(
    # This is the target directory
    train_dir,
    # All images will be resized to 224x224
    target_size=(224, 224),
    batch_size=20,
    shuffle=True,
    # Since we use categorical_crossentropy loss, we need categorical labels
    class_mode='categorical')

logging.info('train gen length: {}'.format(len(train_generator)))
logging.info('class dict: {}'.format(train_generator.class_indices))

test_datagen = ImageDataGenerator(rescale=1./255)

validation_generator = test_datagen.flow_from_directory(
    validation_dir,
    target_size=(224, 224),
    batch_size=20,
    shuffle=True,
    class_mode='categorical')

logging.info('validation gen length: {}'.format(len(validation_generator)))

# Pass 1: train only the top layers (which were randomly initialized)
# i.e. freeze all convolutional layers

conv_base = VGG16(weights='imagenet',
    include_top=False,
    input_shape=(224, 224, 3))

#conv_base.summary()

### train densly connected classifier on top of convnet
model = models.Sequential()
model.add(conv_base)
model.add(layers.Flatten())
model.add(layers.Dense(64, activation='relu', kernel_regularizer=l2(0.001)))
#model.add(layers.Dropout(0.5))
model.add(layers.Dense(64, activation='relu', kernel_regularizer=l2(0.001)))
#model.add(layers.Dropout(0.5))
model.add(layers.Dense(5, activation='softmax'))

conv_base.trainable = False

#model.summary()

model.compile(loss='categorical_crossentropy',
    #optimizer=optimizers.RMSprop(lr=2e-5),
    optimizer=optimizers.Adam(lr=0.5e-4),
    metrics=['acc'])

# Training data is unbalanced so use class weighting.
# Ref: https://datascience.stackexchange.com/questions/13490/how-to-set-class-weights-for-imbalanced-classes-in-keras
# Ref: https://stackoverflow.com/questions/42586475/is-it-possible-to-automatically-infer-the-class-weight-from-flow-from-directory
counter = Counter(train_generator.classes)
max_val = float(max(counter.values()))
class_weights = {class_id : max_val/num_images for class_id, num_images in counter.items()}
logging.info('class weights {}'.format(class_weights))

early_stop = EarlyStopping(monitor='val_loss',
    mode='min',
    verbose=2,
    patience=10)

csv_logger = CSVLogger(RESULTS_DIR + '/pass1-history.csv', append=False)

model_ckpt = ModelCheckpoint(filepath=RESULTS_DIR + '/person-classifier-pass1.h5',
    monitor='val_loss',
    verbose=2,
    save_best_only=True)

history = model.fit_generator(
    train_generator,
    steps_per_epoch=len(train_generator),
    epochs=100,
    validation_data=validation_generator,
    validation_steps=len(validation_generator),
    class_weight=class_weights,
    verbose=2,
    workers=4,
    callbacks=[early_stop, model_ckpt, csv_logger])

# Plot pass 1 results.
acc = history.history['acc']
val_acc = history.history['val_acc']
loss = history.history['loss']
val_loss = history.history['val_loss']

epochs = range(len(acc))

plt.figure()

plt.plot(epochs,
    smooth_curve(acc), 'bo', label='Smoothed training acc')
plt.plot(epochs,
    smooth_curve(val_acc), 'b', label='Smoothed validation acc')
plt.title('Pass 1 Training and validation accuracy')
plt.legend()
plt.savefig(RESULTS_DIR + '/pass1-acc.png')
#plt.show()

plt.clf()

plt.plot(epochs,
    smooth_curve(loss), 'bo', label='Smoothed training loss')
plt.plot(epochs,
    smooth_curve(val_loss), 'b', label='Smoothed validation loss')
plt.title('Pass 1 Training and validation loss')
plt.legend()
plt.savefig(RESULTS_DIR + '/pass1-loss.png')
#plt.show()

plt.close()

### fine tuning
best_pass1_model = models.load_model(RESULTS_DIR + '/person-classifier-pass1.h5')

conv_base = best_pass1_model.get_layer('vgg16')

conv_base.trainable = True

set_trainable = False
for layer in conv_base.layers:
    if layer.name == 'block5_conv1':
        set_trainable = True
    if set_trainable:
        layer.trainable = True
    else:
        layer.trainable = False

#best_pass1_model.summary()

# proceed with fine-tuning
best_pass1_model.compile(loss='categorical_crossentropy',
    #optimizer=optimizers.RMSprop(lr=1e-5),
    optimizer=optimizers.Adam(lr=0.25e-4),
    metrics=['acc'])

early_stop = EarlyStopping(monitor='val_loss',
    mode='min',
    verbose=2,
    patience=10)

csv_logger = CSVLogger(RESULTS_DIR + '/pass2-history.csv', append=False)

model_ckpt = ModelCheckpoint(filepath=RESULTS_DIR + '/person-classifier.h5',
    monitor='val_loss',
    verbose=2,
    save_best_only=True)

history = best_pass1_model.fit_generator(
    train_generator,
    steps_per_epoch=len(train_generator),
    epochs=100,
    validation_data=validation_generator,
    validation_steps=len(validation_generator),
    class_weight=class_weights,
    verbose=2,
    workers=4,
    callbacks=[early_stop, model_ckpt, csv_logger])

# Plot pass 2 results.
acc = history.history['acc']
val_acc = history.history['val_acc']
loss = history.history['loss']
val_loss = history.history['val_loss']

epochs = range(len(acc))

plt.figure()

plt.plot(epochs,
    smooth_curve(acc), 'bo', label='Smoothed training acc')
plt.plot(epochs,
    smooth_curve(val_acc), 'b', label='Smoothed validation acc')
plt.title('Pass 2 Training and validation accuracy')
plt.legend()
plt.savefig(RESULTS_DIR + '/pass2-acc.png')
#plt.show()

plt.clf()

plt.plot(epochs,
    smooth_curve(loss), 'bo', label='Smoothed training loss')
plt.plot(epochs,
    smooth_curve(val_loss), 'b', label='Smoothed validation loss')
plt.title('Pass 2 Training and validation loss')
plt.legend()
plt.savefig(RESULTS_DIR + '/pass2-loss.png')
#plt.show()

plt.close()

# evaluate this model on the test data:
test_generator = test_datagen.flow_from_directory(
    test_dir,
    target_size=(224, 224),
    batch_size=20,
    shuffle=True,
    class_mode='categorical')

# Load the best model from disk that was the last saved checkpoint.
best_model = models.load_model(RESULTS_DIR + '/person-classifier.h5')

test_loss, test_acc = best_model.evaluate_generator(test_generator, steps=len(test_generator))
logging.info('test acc: {}'.format(test_acc))