-- 区分「请求金额」与「实际支出」。
-- amount_usd 是下单时的名义金额(界面展示用);spend_usd 是计入手续费的保守
-- 估计,日累计限额按它累加——实测 $2 的市价买单实际支出 $2.06,按名义金额
-- 累计会让日上限被系统性低估。
-- 历史行为 NULL,统计时回退到 amount_usd。

ALTER TABLE orders ADD COLUMN spend_usd DOUBLE PRECISION;
