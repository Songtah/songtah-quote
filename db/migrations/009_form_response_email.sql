-- 2026-11-14：問卷基本資料加「信箱」（使用者指示；選填，只新增欄位）
alter table event_form_responses add column if not exists email text;
