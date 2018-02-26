CREATE TABLE IF NOT EXISTS `alarm_uploaded` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `frameid` int(10) DEFAULT NULL,
  `upload_timestamp` timestamp NULL DEFAULT NULL,
  `eventid` int(10) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_event_frame` (`eventid`,`frameid`),
  KEY `idx_frame` (`frameid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
