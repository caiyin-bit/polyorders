-- 列表页「列表分析」要在每行展示综合评级与理由。
-- 这两个字段由服务端从报告末尾的固定格式行解析而来,解析失败时为 NULL
-- (行内不显示,完整报告仍在 content 里)。

ALTER TABLE wallet_analyses ADD COLUMN rating TEXT;
ALTER TABLE wallet_analyses ADD COLUMN rating_reason TEXT;
