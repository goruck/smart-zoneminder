# test the tpu-based detect servers.
# copyright (c) 2019 Lindo St. Angel

import zerorpc
import ast

obj_det = zerorpc.Client()
obj_det.connect("tcp://192.168.1.131:1234")
obj_ans = obj_det.detect_objects(["/nvr/zoneminder/events/PlayroomDoor/19/04/04/04/30/00/00506-capture.jpg"])
print('**** obj det ****')
print(obj_ans)
face_det = zerorpc.Client()
face_det.connect("tcp://192.168.1.131:1235")
face_ans = face_det.detect_faces([ast.literal_eval(obj_ans)[0]])
print('**** face det ****')
print(face_ans)
