"""
Copy images from source directory and split into train/val/test.

Copyright (c) 2019 Lindo St. Angel
"""

import os
import shutil
import cv2
import logging
from random import shuffle

logging.basicConfig(level=logging.ERROR)

# Minimum height and width of image to copy (in pixels).
H_MIN = 0
W_MIN = 0

# Set True to clean up (remove) folder contents before moves.
CLEAN = True

def split_and_copy_files(src_dir=None, dst_dir=None):
    if src_dir is None or dst_dir is None:
        return

    def clean(dst_dir, name, dir_name):
        dst_path = dst_dir + '/' + dir_name +'/' + name
        files = os.listdir(dst_path)
        for item in files:
            try:
                os.remove(dst_path + '/' + item)
            except OSError as e:
                logging.debug('Debug: rm error {} - {}.'.format(e.filename, e.strerror))
        return

    def copy(src_dir, dst_dir, name, dir_name):
        src_path = src_dir + '/' + item
        dst_path = dst_dir + '/' + dir_name +'/' + name + '/' + item
        img = cv2.imread(src_path)
        if img.size == 0:
            logging.error('Error: cannot read {}'.format(src_path))
            return
        (h, w) = img.shape[:2]
        if h < H_MIN or w < W_MIN:
            return
        logging.info('Info: moving {} to {}'.format(src_path, dst_path))
        shutil.copy(src_path, dst_path)
        return

    # e.g., './dataset/lindo_st_angel/' => 'lindo_st_angel'
    name = os.path.basename(src_dir)
    logging.info('Info: working on name {}'.format(name))

    # Get files in source dir and shuffle.
    files = os.listdir(src_dir)
    shuffle(files)

    # Split files into train, validation and test sets.
    # Default is 80% of data is in train set and 10% in validation and test.
    num_samples = len(files)
    num_train_samples = int(0.8*num_samples)
    num_val_samples = int(0.1*num_samples)
    #num_test_samples = num_samples - num_train_samples - num_val_samples
    train = files[:num_train_samples]
    val = files[num_train_samples:(num_train_samples + num_val_samples)]
    test = files[(num_train_samples + num_val_samples):]

    # Remove all files in target directories if CLEAN True.
    if CLEAN:
        clean(dst_dir, name, 'train')
        clean(dst_dir, name, 'validation')
        clean(dst_dir, name, 'test')

    # Move files to target directories.
    for item in train:
        copy(src_dir, dst_dir, name, 'train')
    for item in val:
        copy(src_dir, dst_dir, name, 'validation')
    for item in test:
        copy(src_dir, dst_dir, name, 'test')

    return

split_and_copy_files('../face-det-rec/dataset/eva_st_angel', './dataset')
split_and_copy_files('../face-det-rec/dataset/lindo_st_angel', './dataset')
split_and_copy_files('../face-det-rec/dataset/nico_st_angel', './dataset')
split_and_copy_files('../face-det-rec/dataset/nikki_st_angel', './dataset')
split_and_copy_files('../face-det-rec/dataset/Unknown', './dataset')