-- Normalize legend position values to the new 9-position abbreviation system.
-- Hybrid positions that used the old "POS1-POS2" or "POS2-POS1" format are
-- mapped to their short equivalents. Slash-separated and reverse-order variants
-- are all handled.
UPDATE legends SET position = 'G'  WHERE position IN ('PG-SG', 'SG-PG', 'PG/SG', 'SG/PG');
UPDATE legends SET position = 'GF' WHERE position IN ('SG-SF', 'SF-SG', 'G-F', 'F-G', 'SG/SF', 'SF/SG', 'G/F', 'F/G');
UPDATE legends SET position = 'F'  WHERE position IN ('SF-PF', 'PF-SF', 'SF/PF', 'PF/SF');
UPDATE legends SET position = 'FC' WHERE position IN ('PF-C', 'C-PF', 'F-C', 'C-F', 'PF/C', 'C/PF', 'F/C', 'C/F');
