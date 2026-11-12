-- Colour per person, used in the "Chi cho / Thu từ" donut chart
ALTER TABLE people ADD COLUMN color TEXT NOT NULL DEFAULT '#64748B';
UPDATE people SET color = '#2a78d6' WHERE name = 'Bố';
UPDATE people SET color = '#e87ba4' WHERE name = 'Mẹ';
UPDATE people SET color = '#e34948' WHERE name = 'Vợ/Chồng';
UPDATE people SET color = '#eda100' WHERE name = 'Con';
UPDATE people SET color = '#008300' WHERE name = 'Anh';
UPDATE people SET color = '#eb6834' WHERE name = 'Chị';
UPDATE people SET color = '#1baf7a' WHERE name = 'Em';
UPDATE people SET color = '#A16207' WHERE name = 'Ông bà';
UPDATE people SET color = '#6250d6' WHERE name = 'Bạn bè';
