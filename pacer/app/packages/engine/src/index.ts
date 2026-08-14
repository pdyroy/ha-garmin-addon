// @acme/engine — Evidence-Based Sport Science Engine
//
// All algorithms cite peer-reviewed research.
// See docs/sport-science-reference.md for full citations.

export type {
  DailyMetricInput,
  ActivityInput,
  Baselines,
  ReadinessZone,
  ReadinessComponents,
  ReadinessResult,
  SportType,
  GoalType,
  UserProfile,
  WorkoutStructureBlock,
  WorkoutRecommendation,
  RecoveryContext,
  AnomalyAlert,
  // New types
  TrainingLoadMetrics,
  TrainingStatusType,
  TrainingStatusResult,
  VO2maxEstimateResult,
  RacePredictionResult,
  RecoveryEstimate,
  SleepCoachResult,
  TrendDirection,
  TrendAnalysis,
  CorrelationPair,
  RunningFormScore,
  JournalEntryInput,
} from "./types";

export {
  calculateReadiness,
  scoreSleepQuantity,
  scoreSleepQuality,
  scoreHRV,
  scoreRestingHR,
  scoreTrainingLoad,
  scoreStressAndBattery,
  getReadinessZone,
  getZoneColor,
} from "./readiness";

export {
  computeTRIMP,
  computeStrainScore,
  computeACWR,
  computeACWR_EWMA,
  computeTrainingLoads,
  computeDailyPMCSeries,
  classifyLoadFocus,
  countConsecutiveHardDays,
} from "./strain";
export type { ACWRResult } from "./strain";

export {
  computeBaselines,
  computeEMA,
  computeSD,
  computeZScore,
  zScoreToScore,
  getPopulationDefaults,
  getSleepNeedMinutes,
} from "./baselines";

export { detectAnomalies } from "./anomalies";

export {
  projectPMC,
  buildScenarioLoads,
  linearForecast,
  findRaceReadinessWindow,
  buildWhatIfOptions,
  simulateWhatIf,
} from "./forecasting";
export type {
  LoadScenario,
  ProjectedPMCDay,
  PMCForecast,
  LinearForecastPoint,
  LinearForecast,
  RaceReadinessWindow,
  WhatIfOption,
  WhatIfOutcome,
} from "./forecasting";

export {
  generateDailyWorkout,
  modulateWorkout,
  selectWeeklyTemplate,
  adjustDifficulty,
} from "./coaching";

export { computeTargetStrain } from "./coaching/target-strain";
export type { TargetStrainBand } from "./coaching/target-strain";

// New modules
export {
  estimateVO2maxFromRunning,
  estimateVO2maxUth,
  estimateVO2maxCooper,
  predictRaceTimes,
  predictRaceTimesFromVO2max,
  computeVO2maxTrend,
  fitIndividualPowerLaw,
  predictRaceTimesAdaptive,
} from "./vo2max";
export type {
  RaceEffortInput,
  PowerLawFitResult,
  RaceModelInfo,
  FittedRacePrediction,
  RacePredictionFitResult,
} from "./vo2max";

export {
  classifyTrainingStatus,
  estimateRecoveryTime,
} from "./training-status";

export {
  calculateSleepNeed,
  calculateSleepDebt,
  generateSleepCoachResult,
} from "./sleep-coach";

export {
  analyzeTrend,
  computeRollingAverage,
  findNotableChanges,
} from "./trends";

export {
  computePearsonR,
  analyzeCorrelation,
  computeStandardCorrelations,
} from "./correlations";

export { analyzeRunningForm } from "./running-form";

export {
  recommendDay,
  type Recommendation,
  type RecommendationAction,
  type RecommendationIntensity,
  type RuleTrace,
  type DailyRecommendationInput,
} from "./daily-recommendation";

export {
  reconcilePlanVsActual,
  type ReconcileInput,
  type ReconcileResult,
  type ReconcileStatus,
  type ReconcileDeviation,
} from "./planned-vs-actual";

export {
  attributeOutcomes,
  summarizeRuleEffectiveness,
  DECISION_RULE_ID,
  type DecisionInput,
  type MetricPoint,
  type Attribution,
  type RuleEffectiveness,
} from "./learning";

// NightSignal — overnight RHR state machine (Alavi et al. Nat Med 2022)
export {
  computeNightSignalSeries,
  getLatestNightSignal,
} from "./night-signal";
export type { NightSignalState, NightSignalResult } from "./night-signal";

// HRV baseline — log-space M7/SWC band + HRV x RHR quadrants (Plews et al.
// 2013; Buchheit 2014)
export {
  computeHrvM7,
  computeHrvBaselineBand,
  computeHrvBaselineStatus,
  classifyHrvRhrQuadrant,
} from "./hrv-baseline";
export type {
  HrvRhrDailyPoint,
  QuorumResult,
  HrvBaselineBand,
  HrvBandPosition,
  HrvBaselineStatus,
  HrvRhrQuadrant,
  HrvRhrQuadrantResult,
} from "./hrv-baseline";

// Sleep regularity & chronotype (Phillips et al. 2017; Wittmann 2006;
// Roenneberg 2012)
export {
  computeSleepRegularityIndex,
  computeBedtimeVariability,
  computeSleepMidpointVariability,
  computeChronotype,
  defaultIsFreeDay,
} from "./sleep-regularity";
export type {
  MetricResult,
  SleepRegularityIndexOutput,
  SleepRegularityIndexResult,
  SleepTimingVariabilityOutput,
  SleepTimingVariabilityResult,
  ChronotypeOutput,
  ChronotypeResult,
} from "./sleep-regularity";
