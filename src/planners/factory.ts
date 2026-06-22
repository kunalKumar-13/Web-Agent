/**
 * Planner factory — selects the "brain" from config. Swapping engines (and, for
 * AI mode, the LLM provider) is this single decision; the agent loop never changes.
 */
import { Planner } from './planner';
import { HeuristicPlanner } from './heuristic';
import { AiPlanner } from './ai';
import { createLlmClient } from './llm';
import { AgentConfig } from '../config';

export function createPlanner(config: AgentConfig): Planner {
  if (config.mode === 'ai') {
    // createLlmClient throws a clear error if the chosen provider's key is missing.
    return new AiPlanner(createLlmClient(config));
  }
  return new HeuristicPlanner();
}
