-- 交叉分析:一次任务驱动多个模型并行出报告,再综合成一份对外结论。
--
-- kind: single 单模型(默认) / cross 交叉分析的综合行 / member 交叉分析的
-- 成员行(某个模型的独立报告,留档供审计与追溯,不对外作为「最新分析」展示)。
-- member 行经 group_id 指向所属 cross 行。

ALTER TABLE wallet_analyses ADD COLUMN kind TEXT NOT NULL DEFAULT 'single';
ALTER TABLE wallet_analyses ADD COLUMN group_id BIGINT;
