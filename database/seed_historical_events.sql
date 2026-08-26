-- Seed historical event reactions (Stage 1 demo dataset)
-- Numbers are illustrative reference data for the historical comparison engine,
-- not live market data. Replace with a real historical dataset in Stage 2.

INSERT INTO historical_event_reactions
  (event_type, economic_variable, direction, event_label, event_date, sector, nifty_return_1d, nifty_return_3d, nifty_return_5d, nifty_return_20d, sector_return_1d, sector_return_3d, sector_return_5d, sector_return_20d)
VALUES
('MONETARY_POLICY', 'INTEREST_RATE', 'NEGATIVE', 'RBI repo rate hike 25bps', '2023-02-08', 'Banking', -0.6, -1.1, -1.4, -2.8, -1.2, -2.1, -2.6, -4.5),
('MONETARY_POLICY', 'INTEREST_RATE', 'NEGATIVE', 'RBI repo rate hike 25bps', '2023-04-06', 'NBFC', -0.5, -0.9, -1.6, -3.1, -1.5, -2.4, -3.2, -5.6),
('MONETARY_POLICY', 'INTEREST_RATE', 'NEGATIVE', 'RBI repo rate hike 50bps', '2022-09-30', 'Banking', -0.9, -1.8, -2.3, -3.9, -1.9, -3.0, -3.8, -6.1),
('MONETARY_POLICY', 'INTEREST_RATE', 'NEGATIVE', 'RBI repo rate hike 25bps', '2022-12-07', 'Realty', -0.7, -1.4, -2.0, -3.4, -2.1, -3.3, -4.1, -6.8),
('MONETARY_POLICY', 'INTEREST_RATE', 'POSITIVE', 'RBI repo rate cut 25bps', '2025-02-07', 'Banking', 0.8, 1.5, 2.1, 3.6, 1.6, 2.6, 3.4, 5.5),
('MONETARY_POLICY', 'INTEREST_RATE', 'POSITIVE', 'RBI repo rate cut 25bps', '2025-04-09', 'NBFC', 0.7, 1.3, 1.9, 3.2, 1.8, 2.9, 3.6, 5.9),
('MONETARY_POLICY', 'INTEREST_RATE', 'POSITIVE', 'RBI repo rate cut 25bps', '2025-06-06', 'Realty', 0.6, 1.2, 1.8, 3.0, 2.0, 3.1, 3.9, 6.2),
('COMMODITY_SHOCK', 'OIL_PRICE', 'NEGATIVE', 'Crude oil price surge 15%', '2022-03-07', 'Energy', -1.5, -2.2, -2.8, -3.5, 2.5, 3.8, 4.2, 5.1),
('COMMODITY_SHOCK', 'OIL_PRICE', 'NEGATIVE', 'Crude oil price surge 10%', '2023-10-09', 'Auto', -0.8, -1.3, -1.9, -2.6, -1.9, -2.8, -3.3, -4.4),
('COMMODITY_SHOCK', 'OIL_PRICE', 'POSITIVE', 'Crude oil price drop 12%', '2024-08-05', 'Auto', 0.9, 1.6, 2.2, 3.1, 1.8, 2.7, 3.5, 4.8),
('EARNINGS', 'CORPORATE', 'POSITIVE', 'Large-cap IT earnings beat', '2024-07-11', 'IT', 1.1, 1.9, 2.4, 3.8, 2.8, 4.1, 5.0, 7.2),
('EARNINGS', 'CORPORATE', 'NEGATIVE', 'Large-cap IT earnings miss', '2024-01-11', 'IT', -1.3, -2.1, -2.7, -3.9, -3.4, -4.8, -5.6, -7.5),
('GEOPOLITICAL', 'OTHER', 'NEGATIVE', 'Middle East conflict escalation', '2023-10-08', 'Energy', -1.0, -1.6, -1.9, -1.2, 1.9, 2.6, 2.9, 1.5),
('GLOBAL_MARKET_SHOCK', 'OTHER', 'NEGATIVE', 'US Fed rate hike surprise', '2022-06-15', 'IT', -2.1, -3.0, -3.8, -5.2, -2.9, -4.0, -4.9, -6.7),
('GOVERNMENT_POLICY', 'OTHER', 'POSITIVE', 'Union Budget capex boost', '2024-02-01', 'Engineering', 0.9, 1.6, 2.3, 4.1, 2.4, 3.6, 4.5, 7.0),
('GOVERNMENT_POLICY', 'OTHER', 'NEGATIVE', 'Union Budget tax hike on capital gains', '2024-07-23', 'Financials', -1.2, -1.8, -2.0, -2.5, -1.9, -2.6, -2.9, -3.4),
('CURRENCY', 'CURRENCY', 'NEGATIVE', 'INR depreciates sharply vs USD', '2023-10-20', 'IT', 0.5, 0.9, 1.2, 1.8, 1.4, 2.1, 2.6, 3.5),
('INFLATION', 'INFLATION', 'NEGATIVE', 'CPI inflation print above estimate', '2023-06-12', 'FMCG', -0.6, -1.0, -1.3, -2.0, -0.9, -1.5, -1.9, -2.8),
('REGULATORY', 'OTHER', 'NEGATIVE', 'Regulatory crackdown on NBFC lending norms', '2023-11-16', 'NBFC', -1.4, -2.3, -2.9, -4.2, -3.1, -4.6, -5.4, -7.3),
('CREDIT_RATING', 'OTHER', 'POSITIVE', 'India sovereign rating outlook upgraded', '2024-05-29', 'Banking', 0.7, 1.2, 1.6, 2.4, 1.3, 2.0, 2.5, 3.6);
