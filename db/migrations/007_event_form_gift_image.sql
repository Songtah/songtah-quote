-- 活動問卷贈品照片（2026-11-11）：只加欄位，既有資料不受影響
alter table event_forms add column if not exists gift_image text not null default '';
