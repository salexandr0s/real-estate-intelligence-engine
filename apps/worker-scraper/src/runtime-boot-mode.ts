import type { RuntimeBootMode } from '@immoradar/config';

export interface SchedulerModeConfigLike {
  runtime: {
    bootMode: RuntimeBootMode;
  };
  scheduler: {
    enabled: boolean;
  };
}

export function shouldRegisterAutomatedSchedules(config: SchedulerModeConfigLike): boolean {
  return config.runtime.bootMode === 'active' && config.scheduler.enabled;
}

export function shouldClearAutomatedSchedules(config: SchedulerModeConfigLike): boolean {
  return config.runtime.bootMode === 'setup';
}
