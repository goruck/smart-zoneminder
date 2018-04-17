# gen-vid
gen-vid is a python script run in Apache's CGI on the local server that generates an MP4 video of a ZOneminder alarm event given its Event ID, starting Frame ID and ending Frame ID. The script is initiated via the CGI by the Alexa skill handler and the resulting video is played back on an Echo device with a screen upon a user's request.

URL format is https://HOST/cgi-bin/gen-vid.py?event=EVENT_ID&start_frame=SF&end_frame=EF

# Installation
1. Clone this git repo to your local machine running Zoneminder and cd to it.
2. Fetch dependencies.
```bash
$ pip install -r requirements.txt
```
3. Edit gen-vid.py and change path names to suit your configuration.
```python
# Define where to save generated video clip.
OUT_PATH = '/var/www/public/'

# Define where Zoneminder keeps event images.
IMAGE_BASE = '/media/lindo/NVR/zoneminder/events/
```
4. Create a text file called zm_user_pass.txt with the ZoneMinder MySql username and password to suit your configuration.
```bash
$  printf "username\npassword\n" > zm_user_pass.txt
``` 
5. Copy gen-vid.py and zm_user_pass.txt to your CGI bin directory and set permissions appropriately.
```bash
$ sudo cp gen-vid.py /usr/lib/cgi-bin/.
$ sudo chmod a+x /usr/lib/cgi-bin/gen-vid.py
$ sudo cp zm_user_pass.txt /usr/lib/cgi-bin/.
```