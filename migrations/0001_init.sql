CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL,
  color TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('expense','income')),
  sort INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('expense','income')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  category_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);

INSERT OR IGNORE INTO categories (id,name,icon,color,type,sort) VALUES
 ('an-uong','Ăn uống','🍜','#F97316','expense',1),
 ('cafe','Cà phê','☕','#A16207','expense',2),
 ('di-chuyen','Di chuyển','🛵','#0EA5E9','expense',3),
 ('mua-sam','Mua sắm','🛍️','#EC4899','expense',4),
 ('hoa-don','Hoá đơn','🧾','#6366F1','expense',5),
 ('nha-cua','Nhà cửa','🏠','#14B8A6','expense',6),
 ('suc-khoe','Sức khoẻ','💊','#EF4444','expense',7),
 ('giai-tri','Giải trí','🎬','#8B5CF6','expense',8),
 ('giao-duc','Giáo dục','📚','#2563EB','expense',9),
 ('gia-dinh','Gia đình','👨‍👩‍👧','#F59E0B','expense',10),
 ('qua-tang','Quà tặng','🎁','#DB2777','expense',11),
 ('khac-chi','Khác','📦','#64748B','expense',12),
 ('luong','Lương','💼','#16A34A','income',1),
 ('thuong','Thưởng','🏆','#22C55E','income',2),
 ('kinh-doanh','Kinh doanh','📈','#0D9488','income',3),
 ('dau-tu','Đầu tư','💹','#059669','income',4),
 ('duoc-cho','Được cho','🧧','#E11D48','income',5),
 ('khac-thu','Khác','💰','#65A30D','income',6);
