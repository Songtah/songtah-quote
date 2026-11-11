-- 活動問卷基本資料（使用者 2026-11-11 指定）：姓名、技所、技所地區、電話、職稱
alter table event_form_responses add column if not exists city text;
alter table event_form_responses add column if not exists district text;
alter table event_form_responses add column if not exists job_title text;
