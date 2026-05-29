export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface RiskFactor {
  name: string;
  weight: number;
  contribution: number;
}

export interface RiskScore {
  value: number;
  level: RiskLevel;
  factors: RiskFactor[];
  calculatedAt: string;
}
