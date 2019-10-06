import os
import shutil
from random import shuffle

def split_and_move_files(src_dir=None, tgt_dir=None):
    if src_dir is None or tgt_dir is None:
        return

    # e.g., './dataset/lindo_st_angel/' => 'lindo_st_angel'
    name = os.path.basename(src_dir)
    print('name {}'.format(name))

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

    # Move files to target directories.
    for item in train:
        shutil.copy(src_dir + '/' + item, tgt_dir + '/train/' + name + "/" + item)
    for item in val:
        shutil.copy(src_dir + '/' + item, tgt_dir + '/validation/' + name + "/" + item)
    for item in test:
        shutil.copy(src_dir + '/' + item, tgt_dir + '/test/' + name + "/" + item)

    return

split_and_move_files('./dataset/eva_st_angel', './dataset')
split_and_move_files('./dataset/lindo_st_angel', './dataset')
split_and_move_files('./dataset/nico_st_angel', './dataset')
split_and_move_files('./dataset/nikki_st_angel', './dataset')
split_and_move_files('./dataset/Unknown', './dataset')