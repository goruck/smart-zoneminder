"""
Renumber file names in sequential order, i.e., 00000010.jpg
Useful to prepare images for encode_faces.py.

This is part of the smart-zoneminder project.
See https://github.com/goruck/smart-zoneminder

Copyright (c) 2019 Lindo St. Angel
"""

import os
import argparse

ap = argparse.ArgumentParser()
ap.add_argument('-d', '--directory', required=True,
    help='path to input directory of faces')
args = vars(ap.parse_args())

# Length of file name, pad with up to 7 zeros.
ZERO_FILL = 8

# Add the trailing slash if it's not already there.
path = os.path.join(args['directory'], '', '')

# List of file types to process.
suffixes = ['jpg', 'jpeg', 'png']

counter = 0
for f in sorted(os.listdir(path)):
    suffix = f.split('.')[-1]
    if suffix in suffixes:
        str_cntr = str(counter)
        new = '{}.{}'.format(str_cntr.zfill(ZERO_FILL), suffix)
        if not os.path.isfile(path+new): # skip if file exists
            print('renaming {} to {}'.format(path+f, path+new))
            os.rename(path+f, path+new)
        counter += 1