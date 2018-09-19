#!/usr/bin/python3

'''
CGI script to generate a video given a Zoneminder Event ID, Start Frame and End Frame.
URL format is http://HOST/cgi/gen-vid.py?event=EVENT_ID&start_frame=SF&end_frame=EF

Copyright 2018 Lindo St. Angel
'''

import cgi, cgitb, os, datetime, json
import mysql.connector as mysqldb
from subprocess import check_call, CalledProcessError

# Define where to save generated video clip.
OUT_PATH = '/var/www/lsacam.com/private/'

# Define where Zoneminder keeps event images.
IMAGE_BASE = '/nvr/zoneminder/events/'

def print_json( success, message ):
   'This prints json to the requestor'
   print ('Content-Type: application/json\n\n')
   result = {'success':success,'message':message}
   print (json.dumps(result))
   return

# Create instance of FieldStorage for cgi handling.
form = cgi.FieldStorage() 

# Get data from fields passed to uri. 
event = form.getvalue('event')
start_frame  = form.getvalue('start_frame')
end_frame = form.getvalue('end_frame')
total_frames = str(int(end_frame) - int(start_frame))

# Get username and password for zoneminder mysql database.
zm_user_pass = open('./zm_user_pass.txt', 'r')
lines = zm_user_pass.readlines()
username = lines[0].rstrip()
password = lines[1].rstrip()
zm_user_pass.close()

# Connect to zm mysql db.
db = mysqldb.connect(host = 'localhost',
                     user = username,
                     passwd = password,
                     db = 'zm')

# Create cursor object to perform queries. 
cur = db.cursor()

# Query to get zonminder monitor id and timestamp for a given event.
# Only one result is needed since we just need starting timestamp of event.
query = ('SELECT Events.MonitorId,Frames.TimeStamp FROM Events' +
         ' JOIN Frames ON Frames.EventId=Events.Id WHERE Events.Id=%s LIMIT 1')

# Perform query with event id passed to script.
cur.execute(query, (event, ))

# data contains results from query.
# Note this will be a single tuple with two members. 
data = cur.fetchone()

# All done with mysql.
db.close()

if data:
    # Form path name to event images.
    monitor_id = str(data[0])
    # time_stamp is a datetime object.
    time_stamp = data[1].strftime('%y %m %d %H %M %S')
    year, month, day, hour, minute, second = time_stamp.split(' ')
    image_path = (IMAGE_BASE + monitor_id + '/' + year + '/' + month + '/' + day +
                  '/' + hour + '/' + minute + '/' + second + '/%05d-capture.jpg')
else:
    print_json(False, 'Event data not found!')
    quit()

FNULL = open(os.devnull, 'w')

# ffmpeg command line to generate MP4.
FFMPEG_MP4 = (['/usr/bin/ffmpeg', '-r', '10', '-s', '640x480',
               '-start_number', start_frame,
               '-i', image_path, '-frames', total_frames, '-vcodec', 'libx264', '-preset', 'veryfast',
               '-crf', '35', '-y', (OUT_PATH + 'alarm-video.mp4')])

# ffmpeg command to generate MP4 with Nvidia GPU HW acceleration.
FFMPEG_MP4_HW = (['/usr/bin/ffmpeg', '-hwaccel', 'cuvid', '-r', '10', '-s', '640x480',
                  '-start_number', start_frame,
                  '-i', image_path, '-frames', total_frames, '-vcodec', 'h264_nvenc', '-preset', 'fast',
                  '-crf', '35', '-y', (OUT_PATH + 'alarm-video.mp4')])

# ffmpeg command line to generate MJPEG.
FFMPEG_MJPEG = (['/usr/bin/ffmpeg', '-f', 'image2', '-r', '10', '-s', '640x480',
                 '-start_number', start_frame, '-i', image_path, '-frames', total_frames,
                 '-y', (OUT_PATH + 'alarm-video.ts')])

try:
    check_call(FFMPEG_MP4_HW, stdout=FNULL, stderr=FNULL, shell=False)
except CalledProcessError as e:
    print_json(False, 'CalledPrcessError! %s' % e)
    quit()
except OSError as e:
    print_json(False, 'OSError! %s' % e)
    quit()

print_json(True, 'The Command Completed Successfully')
