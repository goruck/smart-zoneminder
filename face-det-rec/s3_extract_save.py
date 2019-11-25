"""
Fetch alarm images and metadata from an S3 bucket, extract person roi
and save to local directories by name. Local directory names must
match Face name in alarm image metadata.

This is ordinarily used to gather labled person images for training the
face and person classifiers.

Part of the smart-zoneminder project.
See https://github.com/goruck/smart-zoneminder.

Copyright (c) 2019 Lindo St. Angel
"""

import boto3
import botocore
import json
from PIL import Image

BUCKET_NAME = 'smart-zoneminder'
DATA_DIR = './s3-dataset/'

s3 = boto3.resource('s3')
bucket = s3.Bucket(BUCKET_NAME)

num_images = 0
num_objects = 0
for object in bucket.objects.all():
    try:
        response = object.get()
        file_stream = response['Body']
        img = Image.open(file_stream)
        labels = json.loads(response['Metadata']['labels'])
        for label in labels:
            if label['Name'] == 'person':
                y2 = int(label['Box']['ymin'])
                x1 = int(label['Box']['xmin'])
                y1 = int(label['Box']['ymax'])
                x2 = int(label['Box']['xmax'])
                img = img.crop(box=(x1, y2, x2, y1))
                face = label['Face']
                if face is not None:
                    path = DATA_DIR+face+'/'
                    img.save(path+object.key)
                    print('Saved {} to {}'.format(object.key, path))
                    num_images+=1
        num_objects+=1
    except botocore.exceptions.ClientError as e:
        if e.response['Error']['Code'] == '404':
            print("The object does not exist.")
        else:
            print('Unexpected error: {}.'.format(e))

print('Processed {} images in {} objects.'.format(num_images, num_objects))